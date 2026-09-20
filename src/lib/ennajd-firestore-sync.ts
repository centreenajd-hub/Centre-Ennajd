// Runs the real-time listeners once a staff member is signed in,
// and pushes every remote change into the Zustand store via the
// `hydrate*` actions. This is what makes changes made on another
// device/tab appear instantly everywhere.
//
// Note: Renamed conceptually to supabase-sync.ts but keeping filename
// for minimal import changes. The subscription mechanism uses Supabase
// realtime channels now, but the external API is identical.
//
// INITIAL LOAD — the five billing-critical tables (students, sessions,
// attendance, prices, payments) are subscribed with `initialFetch: false`
// and loaded ONCE through the store's atomic `hydrateInitialData()`
// (Promise.allSettled) instead of each subscription firing its own
// independent fetch. That unified barrier is what stops the refresh race:
// `isDataReady` flips only after every dataset has settled, so no report
// or ledger calculation ever observes a half-empty store. The channels are
// attached FIRST (so no remote change is missed) and the atomic fetch runs
// immediately after.

import { useEffect } from "react";
import {
  subscribeToAttendance,
  subscribeToMessages,
  subscribeToPayments,
  subscribeToPrices,
  subscribeToSessions,
  subscribeToStudents,
} from "@/lib/dbServices";
import { useEnnajdState } from "@/hooks/use-ennajd-state";

export function useFirestoreSync(): void {
  useEffect(() => {
    // Attach the realtime channels first so remote changes during the
    // initial fetch are still captured. Their per-table initial fetch is
    // disabled — the atomic `hydrateInitialData` call below is the single
    // initial-load path for these datasets.
    const unsubscribers = [
      subscribeToStudents(
        (students) => useEnnajdState.getState().hydrateStudents(students),
        { initialFetch: false },
      ),
      subscribeToSessions(
        (sessions) => useEnnajdState.getState().hydrateSessions(sessions),
        { initialFetch: false },
      ),
      subscribeToPrices(
        (prices) => useEnnajdState.getState().hydratePrices(prices),
        { initialFetch: false },
      ),
      subscribeToAttendance(
        (records) => useEnnajdState.getState().hydrateAttendance(records),
        { initialFetch: false },
      ),
      subscribeToPayments(
        (payments) => useEnnajdState.getState().hydratePayments(payments),
        { initialFetch: false },
      ),
      // Messages are not part of the billing barrier — keep their own
      // initial fetch (independent of every report calculation).
      subscribeToMessages((messages) =>
        useEnnajdState.getState().hydrateMessages(messages),
      ),
    ];

    // THE ATOMIC HYDRATION BARRIER — one Promise.allSettled for all
    // billing-critical datasets, then `isDataReady: true`.
    void useEnnajdState.getState().hydrateInitialData();

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);
}
