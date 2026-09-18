// Runs `fn` after the current render has committed and the browser is idle,
// so heavy but non-urgent work (like syncPayments' full students ×
// enrollments scan) never blocks first paint. Falls back to setTimeout in
// environments without requestIdleCallback (e.g. Safari).
export function runWhenIdle(fn: () => void): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn);
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}
