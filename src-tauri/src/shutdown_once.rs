//! Serialize normal shutdown requests and run cleanup once, including when
//! Quit, ExitRequested and Exit arrive from different threads. A panicking
//! cleanup is not marked complete, so a later request may try again. An
//! explicitly unconfirmed restoration is likewise retryable.
use std::sync::Mutex;

pub struct ShutdownOnce { completed: Mutex<bool> }
impl ShutdownOnce {
    pub const fn new() -> Self { Self { completed: Mutex::new(false) } }
    /// Returns whether this invocation ran cleanup (not whether it succeeded).
    pub fn run(&self, cleanup: impl FnOnce() -> bool) -> bool {
        let mut done = self.completed.lock().unwrap_or_else(|poison| poison.into_inner());
        if *done { return false; }
        *done = cleanup();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}, mpsc};
    use std::time::Duration;

    #[test]
    fn repeat_and_concurrent_exit_events_only_run_one_cleanup() {
        let once = Arc::new(ShutdownOnce::new());
        let count = Arc::new(AtomicUsize::new(0));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let a = Arc::clone(&once); let ac = Arc::clone(&count);
        let first = std::thread::spawn(move || a.run(|| {
            ac.fetch_add(1, Ordering::SeqCst);
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            true
        }));
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let b = Arc::clone(&once); let bc = Arc::clone(&count);
        let second = std::thread::spawn(move || {
            let result = b.run(|| { bc.fetch_add(1, Ordering::SeqCst); true });
            finished_tx.send(result).unwrap();
        });
        assert!(finished_rx.recv_timeout(Duration::from_millis(50)).is_err(), "another exit must wait for cleanup");
        release_tx.send(()).unwrap();
        assert!(first.join().unwrap());
        assert!(!finished_rx.recv_timeout(Duration::from_secs(1)).unwrap());
        second.join().unwrap();
        assert!(!once.run(|| { count.fetch_add(1, Ordering::SeqCst); true }));
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_panicking_cleanup_does_not_claim_success() {
        let once = ShutdownOnce::new();
        assert!(std::panic::catch_unwind(|| once.run(|| panic!("injected cleanup panic"))).is_err());
        let mut retried = false;
        assert!(once.run(|| { retried = true; true }));
        assert!(retried);
        assert!(!once.run(|| panic!("must not run twice")));
    }

    #[test]
    fn a_failed_restore_can_be_retried() {
        let once = ShutdownOnce::new();
        assert!(once.run(|| false));
        assert!(once.run(|| true));
        assert!(!once.run(|| true));
    }
}
