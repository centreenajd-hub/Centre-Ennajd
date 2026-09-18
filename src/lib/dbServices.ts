// Supabase access layer for Centre Ennajd — one clean function per
// write/read/subscribe operation. Mirrors the original Firestore dbServices
// API surface so use-ennajd-state.ts needs no call-site changes.
//
// Key differences from Firestore:
// - upsert({ ...data, id }) replaces setDoc(doc(collection, id), data)
// - supabase.from('table').delete().eq('id', id) replaces deleteDoc()
// - Real-time subscriptions use realtime channels with .on('postgres_changes')
//   + .subscribe() instead of onSnapshot()
// - Batch operations use upsert with arrays (no 500-op limit like Firestore)

import { supabase } from "@/lib/supabase";
import {
  attendanceToRow,
  messageToRow,
  paymentToRow,
  priceToRow,
  rowToAttendance,
  rowToMessage,
  rowToPayment,
  rowToPrice,
  rowToSession,
  rowToStudent,
  sessionToRow,
  studentToRow,
} from "@/lib/field-mapping";
import type { RealtimeChannel, PostgrestError } from "@supabase/supabase-js";
import type {
  AttendanceRecord,
  LevelMessage,
  Payment,
  PriceEntry,
  Session,
  Student,
} from "@/types/ennajd";
import type {
  AttendanceRecordsRow,
  MessagesRow,
  PaymentsRow,
  PricesRow,
  SessionsRow,
  StudentsRow,
} from "@/types/supabase";

// Chunk size for bulk upserts — Supabase handles arrays natively but
// we chunk to keep payloads reasonable and match original batching semantics.
const BATCH_CHUNK_SIZE = 450;

// Helper to assert no error from a Supabase operation
function assertNoError(error: PostgrestError | null): void {
  if (error) throw error;
}

// Helper to wrap Supabase operations in proper Promise
function wrapSupabase<T>(
  promise: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<T> {
  return Promise.resolve(promise).then(({ data, error }) => {
    assertNoError(error);
    return data as T;
  });
}

// Helper for void-returning Supabase operations
function wrapSupabaseVoid(
  promise: PromiseLike<{ error: PostgrestError | null }>,
): Promise<void> {
  return Promise.resolve(promise).then(({ error }) => {
    assertNoError(error);
  });
}

// --- Students ----------------------------------------------------------

export function addStudentDoc(student: Student): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("students").upsert(studentToRow(student) as never),
  );
}

export function updateStudentDoc(
  id: string,
  patch: Partial<Student>,
): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    id,
    first_name: patch.firstName,
    last_name: patch.lastName,
    whatsapp_phone: patch.whatsappPhone,
    parent_phone: patch.parentPhone,
    level: patch.level,
    track: patch.track ?? null,
    enrollments: patch.enrollments,
    created_at: patch.createdAt,
    updated_at: now,
    registration_fee: patch.registrationFee ?? null,
  };
  // Strip undefined so we don't overwrite with nulls inadvertently
  const cleanUpdate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) {
      cleanUpdate[key] = value;
    }
  }
  if (patch.advanceBalance !== undefined) {
    cleanUpdate.advance_balance = patch.advanceBalance;
  }

  return wrapSupabaseVoid(
    supabase.from("students").upsert(cleanUpdate as never),
  );
}

export async function updateStudentAdvanceBalanceDoc(
  id: string,
  advanceBalance: number,
): Promise<void> {
  try {
    await wrapSupabaseVoid(
      supabase
        .from("students")
        .update({ advance_balance: Math.max(0, Math.round(advanceBalance)) } as never)
        .eq("id", id),
    );
  } catch (error) {
    // A missing `advance_balance` column (database not yet migrated) makes
    // this write fail with PGRST204. The credit balance is optional across
    // the app, so log instead of propagating — payment distribution flows
    // (applyInitialTuitionPayment, recordPartialPayment, syncPayments) must
    // never break because of it.
    console.error(
      "updateStudentAdvanceBalanceDoc: could not persist advance_balance",
      error,
    );
  }
}

export function deleteStudentDoc(id: string): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("students").delete().eq("id", id),
  );
}

export function subscribeToStudents(
  callback: (students: Student[]) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel("students-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "students" },
      () => {
        // Fetch full dataset on any change so hydration stays consistent
        // (mirrors Firestore's onSnapshot full-dataset behavior)
        fetchAllStudents().then(callback).catch(console.error);
      },
    )
    .subscribe();

  // Initial load
  fetchAllStudents().then(callback).catch(console.error);

  return () => {
    supabase.removeChannel(channel);
  };
}

async function fetchAllStudents(): Promise<Student[]> {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .order("created_at", { ascending: false });
  assertNoError(error);
  return (data ?? []).map(rowToStudent);
}

// --- Sessions ----------------------------------------------------------

export function addSessionDoc(session: Session): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("sessions").upsert(sessionToRow(session) as never),
  );
}

export function updateSessionDoc(
  id: string,
  patch: Partial<Session>,
): Promise<void> {
  const update: Record<string, unknown> = {
    id,
    subject: patch.subject,
    level: patch.level,
    track: patch.track ?? null,
    group_type: patch.groupType ?? null,
    day_of_week: patch.dayOfWeek,
    start_time: patch.startTime,
    end_time: patch.endTime,
    teacher_name: patch.teacherName ?? null,
    kind: patch.kind ?? "recurring",
    date: patch.date ?? null,
  };
  const cleanUpdate: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) {
      cleanUpdate[key] = value;
    }
  }

  return wrapSupabaseVoid(
    supabase.from("sessions").upsert(cleanUpdate as never),
  );
}

export function deleteSessionDoc(id: string): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("sessions").delete().eq("id", id),
  );
}

export function subscribeToSessions(
  callback: (sessions: Session[]) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel("sessions-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sessions" },
      () => {
        fetchAllSessions().then(callback).catch(console.error);
      },
    )
    .subscribe();

  fetchAllSessions().then(callback).catch(console.error);

  return () => {
    supabase.removeChannel(channel);
  };
}

async function fetchAllSessions(): Promise<Session[]> {
  const { data, error } = await supabase.from("sessions").select("*");
  assertNoError(error);
  return (data ?? []).map(rowToSession);
}

// --- Prices ------------------------------------------------------------

export function setPriceDoc(entry: PriceEntry): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("prices").upsert(priceToRow(entry) as never),
  );
}

export function subscribeToPrices(
  callback: (prices: PriceEntry[]) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel("prices-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "prices" },
      () => {
        fetchAllPrices().then(callback).catch(console.error);
      },
    )
    .subscribe();

  fetchAllPrices().then(callback).catch(console.error);

  return () => {
    supabase.removeChannel(channel);
  };
}

async function fetchAllPrices(): Promise<PriceEntry[]> {
  const { data, error } = await supabase.from("prices").select("*");
  assertNoError(error);
  return (data ?? []).map(rowToPrice);
}

// --- Attendance --------------------------------------------------------

export function markAttendanceDoc(record: AttendanceRecord): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("attendance_records").upsert(attendanceToRow(record) as never),
  );
}

// Batched variant used by the auto-absence sweep
export async function upsertAttendanceBatchDoc(
  records: AttendanceRecord[],
): Promise<void> {
  for (let i = 0; i < records.length; i += BATCH_CHUNK_SIZE) {
    const chunk = records.slice(i, i + BATCH_CHUNK_SIZE);
    const rows = chunk.map(attendanceToRow);
    const { error } = await supabase
      .from("attendance_records")
      .upsert(rows as never[]);
    assertNoError(error);
  }
}

export function subscribeToAttendance(
  callback: (records: AttendanceRecord[]) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel("attendance-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "attendance_records" },
      () => {
        fetchAllAttendance().then(callback).catch(console.error);
      },
    )
    .subscribe();

  fetchAllAttendance().then(callback).catch(console.error);

  return () => {
    supabase.removeChannel(channel);
  };
}

async function fetchAllAttendance(): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("*");
  assertNoError(error);
  return (data ?? []).map(rowToAttendance);
}

// --- Payments (monthly billing / isPaid status) ------------------------

export function upsertPaymentDoc(payment: Payment): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("payments").upsert(paymentToRow(payment) as never),
  );
}

// Batched variant — Supabase supports array upsert natively
export async function upsertPaymentsBatchDoc(payments: Payment[]): Promise<void> {
  for (let i = 0; i < payments.length; i += BATCH_CHUNK_SIZE) {
    const chunk = payments.slice(i, i + BATCH_CHUNK_SIZE);
    const rows = chunk.map(paymentToRow);
    const { error } = await supabase.from("payments").upsert(rows as never[]);
    assertNoError(error);
  }
}

export function setPaymentPaidDoc(
  id: string,
  isPaid: boolean,
  updatedAt: string,
): Promise<void> {
  return wrapSupabaseVoid(
    supabase
      .from("payments")
      .update({ is_paid: isPaid, updated_at: updatedAt } as never)
      .eq("id", id),
  );
}

/**
 * Batch patch for amountPaid/isPaid — used by recordPartialPayment which
 * may spill over into the next installment in a single atomic commit.
 *
 * Uses an explicit per-id `update(...).eq("id", id)` per row rather than
 * `upsert`, so a patch can never silently INSERT a partial row (which would
 * trip the NOT NULL / check constraints on amount_due). Each row is patched
 * only by primary key, preserving amount_due / due_date / rule untouched.
 * Chunks at BATCH_CHUNK_SIZE (450) to keep payloads reasonable.
 */
export async function updatePaymentsBatchDoc(
  patches: Array<Pick<Payment, "id"> & Partial<Payment>>,
): Promise<void> {
  for (let i = 0; i < patches.length; i += BATCH_CHUNK_SIZE) {
    const chunk = patches.slice(i, i + BATCH_CHUNK_SIZE);
    for (const patch of chunk) {
      const { id, ...fields } = patch;
      const updates: Record<string, unknown> = { updated_at: fields.updatedAt };
      if (fields.isPaid !== undefined) updates.is_paid = fields.isPaid;
      if (fields.amountPaid !== undefined) {
        updates.amount_paid = Math.max(0, Math.round(fields.amountPaid));
      }
      if (Object.keys(updates).length <= 1) continue; // nothing to patch besides ts
      const { error, count } = await supabase
        .from("payments")
        .update(updates as never, { count: "exact" })
        .eq("id", id);
      assertNoError(error);
      // A 0-row update means the store holds a row the DB no longer has (a
      // silent no-op that used to be invisible). Surface it as a warning so a
      // store/DB drift never goes undetected.
      if (count === 0) {
        console.warn(
          "[dbServices] updatePaymentsBatchDoc: 0 rows matched id",
          id,
          "(store/DB drift — the installment no longer exists remotely)",
        );
      }
    }
  }
}

/**
 * Batched delete for surplus duplicate installments — used when the
 * hydration self-heal detects more than one row sharing a logical key
 * (`studentId__subject__dueDate`). Mirrors the batch helpers above.
 */
export async function deletePaymentsBatchDoc(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += BATCH_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + BATCH_CHUNK_SIZE);
    // Supabase supports .in() filter for batch deletes
    const { error } = await supabase
      .from("payments")
      .delete()
      .in("id", chunk);
    assertNoError(error);
  }
}

export function subscribeToPayments(
  callback: (payments: Payment[]) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel("payments-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "payments" },
      () => {
        fetchAllPayments().then(callback).catch(console.error);
      },
    )
    .subscribe();

  fetchAllPayments().then(callback).catch(console.error);

  return () => {
    supabase.removeChannel(channel);
  };
}

async function fetchAllPayments(): Promise<Payment[]> {
  const { data, error } = await supabase.from("payments").select("*");
  assertNoError(error);
  return (data ?? []).map(rowToPayment);
}

// --- Messages (per-level WhatsApp message library) ---------------------

export function upsertMessageDoc(message: LevelMessage): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("messages").upsert(messageToRow(message) as never),
  );
}

export function deleteMessageDoc(id: string): Promise<void> {
  return wrapSupabaseVoid(
    supabase.from("messages").delete().eq("id", id),
  );
}

export function subscribeToMessages(
  callback: (messages: LevelMessage[]) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel("messages-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      () => {
        fetchAllMessages().then(callback).catch(console.error);
      },
    )
    .subscribe();

  fetchAllMessages().then(callback).catch(console.error);

  return () => {
    supabase.removeChannel(channel);
  };
}

async function fetchAllMessages(): Promise<LevelMessage[]> {
  const { data, error } = await supabase.from("messages").select("*");
  assertNoError(error);
  return (data ?? []).map(rowToMessage);
}