// Isolated live-clock hook for the Attendance engine. Components that need
// to react to real time (session visibility windows, auto-absence trigger)
// should subscribe here instead of calling `new Date()` inline, so only the
// components that actually need live time re-render every tick.

import { useEffect, useRef, useState } from "react";

const TICK_INTERVAL_MS = 60_000; // Reduced from 30s to 60s

export function useNowTick(): Date {
  const [now, setNow] = useState(() => new Date());
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    const updateNow = () => setNow(new Date());

    // Start ticking
    tickRef.current = setInterval(updateNow, TICK_INTERVAL_MS);

    // Pause when page is not visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        updateNow(); // Update immediately when tab becomes visible
        tickRef.current = setInterval(updateNow, TICK_INTERVAL_MS);
      } else {
        clearInterval(tickRef.current);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(tickRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return now;
}
