// Persisted "I'm done with this session" dismissals for the dashboard's live
// session list.
//
// A dismissal is scoped to a specific OCCURRENCE — key `sessionId__date` — so
// removing today's Math slot never hides it next week: the session reappears
// by itself when its next scheduled time arrives (the whole point of the
// feature: the app shows sessions at their time and only the admin removes
// them).
//
// State lives in localStorage (client-side, per admin device) — no backend
// write is needed for a purely cosmetic dashboard-listing choice, and the
// store stays untouched.

import { useEffect, useState } from "react";

import { formatDateKeyLocal } from "@/lib/ennajd-taxonomy";

const STORAGE_KEY = "ennajd:dismissed-live-sessions";

/** Stable key for one occurrence of one session. */
export function dismissalKey(sessionId: string, date: string): string {
  return `${sessionId}__${date}`;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): Record<string, true> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

/** Drops keys for days already past — a dismissal from last week is dead. */
function pruneStale(map: Record<string, true>): void {
  const today = formatDateKeyLocal(new Date());
  for (const key of Object.keys(map)) {
    const date = key.slice(key.indexOf("__") + 2);
    if (date && date < today) delete map[key];
  }
}

function write(map: Record<string, true>): void {
  pruneStale(map);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Storage full / disabled — the in-memory copy below still holds.
    }
  }
  for (const listener of listeners) listener();
}

export function isSessionDismissed(sessionId: string, date: string): boolean {
  return read()[dismissalKey(sessionId, date)] === true;
}

/** Removes a session occurrence from the dashboard live list. */
export function dismissSession(sessionId: string, date: string): void {
  const map = read();
  map[dismissalKey(sessionId, date)] = true;
  write(map);
}

/** Restores a session occurrence (undo). */
export function undismissSession(sessionId: string, date: string): void {
  const map = read();
  delete map[dismissalKey(sessionId, date)];
  write(map);
}

/**
 * Reactive view of the current dismissal set. Components using this
 * re-render immediately after dismiss/undismiss, without any prop drilling.
 */
export function useDismissedSessions(): ReadonlySet<string> {
  const [keys, setKeys] = useState<ReadonlySet<string>>(
    () => new Set(Object.keys(read())),
  );

  useEffect(() => {
    const sync = () => setKeys(new Set(Object.keys(read())));
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  return keys;
}
