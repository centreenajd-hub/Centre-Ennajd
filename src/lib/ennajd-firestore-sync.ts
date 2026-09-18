// Runs the real-time listeners once a staff member is signed in,
// and pushes every remote change into the Zustand store via the
// `hydrate*` actions. This is what makes changes made on another
// device/tab appear instantly everywhere.
//
// Note: Renamed conceptually to supabase-sync.ts but keeping filename
// for minimal import changes. The subscription mechanism uses Supabase
// realtime channels now, but the external API is identical.

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
    const unsubscribers = [
      subscribeToStudents((students) =>
        useEnnajdState.getState().hydrateStudents(students),
      ),
      subscribeToSessions((sessions) =>
        useEnnajdState.getState().hydrateSessions(sessions),
      ),
      subscribeToPrices((prices) =>
        useEnnajdState.getState().hydratePrices(prices),
      ),
      subscribeToAttendance((records) =>
        useEnnajdState.getState().hydrateAttendance(records),
      ),
      subscribeToPayments((payments) =>
        useEnnajdState.getState().hydratePayments(payments),
      ),
      subscribeToMessages((messages) =>
        useEnnajdState.getState().hydrateMessages(messages),
      ),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);
}