//! A single-consumer, event-driven signal for coalesced background writes.
//! `Thread::unpark` retains a permit even when the consumer is not parked yet,
//! so changes cannot be lost between the dirty check and parking.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread::{self, Thread};
use std::time::{Duration, Instant};

pub struct CoalescedSignal {
    dirty: AtomicBool,
    worker: OnceLock<Thread>,
}

impl CoalescedSignal {
    pub const fn new() -> Self {
        Self { dirty: AtomicBool::new(false), worker: OnceLock::new() }
    }

    /// May run before the worker has registered; the dirty flag is durable.
    pub fn mark(&self) {
        if !self.dirty.swap(true, Ordering::AcqRel) {
            if let Some(worker) = self.worker.get() { worker.unpark(); }
        }
    }

    /// Called only by the unique consumer thread. Returns once per coalesced
    /// batch, after at most one delay from seeing the first outstanding change.
    pub fn wait_batch(&self, delay: Duration) {
        let _ = self.worker.set(thread::current());
        loop {
            while !self.dirty.load(Ordering::Acquire) { thread::park(); }
            let deadline = Instant::now() + delay;
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() { break; }
                // Spurious or already-pending unparks must not cause early flushes.
                thread::park_timeout(remaining);
            }
            if self.dirty.swap(false, Ordering::AcqRel) { return; }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, mpsc};

    #[test]
    fn mark_before_worker_exists_and_bursts_are_not_lost() {
        let signal = Arc::new(CoalescedSignal::new());
        signal.mark();
        let copy = signal.clone();
        let (tx, rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            for _ in 0..2 {
                copy.wait_batch(Duration::from_millis(35));
                tx.send(()).unwrap();
            }
        });
        for _ in 0..1000 { signal.mark(); }
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_ok());
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err(), "burst should be one batch");
        signal.mark();
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_ok());
        worker.join().unwrap();
    }

    #[test]
    fn marks_racing_the_park_transition_are_delivered() {
        let signal = Arc::new(CoalescedSignal::new());
        let copy = signal.clone();
        let (ready_tx, ready_rx) = mpsc::channel();
        let (ack_tx, ack_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            for _ in 0..200 {
                ready_tx.send(()).unwrap();
                copy.wait_batch(Duration::ZERO);
                ack_tx.send(()).unwrap();
            }
        });
        for _ in 0..200 {
            ready_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            signal.mark();
            ack_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        }
        worker.join().unwrap();
    }
}
