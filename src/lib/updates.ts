import { useCallback, useEffect, useState } from "react";
import { call, subscribeUpdates, type UpdateStatus } from "./bridge";

const initial: UpdateStatus = {
  revision: -1, phase: "idle", version: null, kind: "installed",
  downloaded: 0, total: null, error: null, buildMarker: "",
};

/** Subscribe first, then read the current snapshot; revision guards races. */
export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>(initial);
  const accept = useCallback((next: UpdateStatus) => {
    setStatus((old) => next.revision >= old.revision ? next : old);
  }, []);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void (async () => {
      try {
        const unlisten = await subscribeUpdates((next) => { if (!disposed) accept(next); });
        if (disposed) { unlisten(); return; }
        off = unlisten;
        const current = await call<UpdateStatus>("update_status");
        if (!disposed) accept(current);
      } catch {
        if (!disposed) setStatus((old) => ({ ...old, phase: "error", error: "connection" }));
      }
    })();
    return () => { disposed = true; off?.(); };
  }, [accept]);

  const check = useCallback(async () => {
    try { accept(await call<UpdateStatus>("check_for_updates")); }
    catch { setStatus((old) => ({ ...old, phase: "error", error: "connection" })); }
  }, [accept]);

  return { status, check };
}
