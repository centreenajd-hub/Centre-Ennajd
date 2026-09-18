// Field mapping utilities to convert between the app's internal types
// (camelCase) and Supabase's database columns (snake_case).
// This is the single translation layer — all row<->type conversions go through here.

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

// --- Student conversion ------------------------------------------------

export function studentToRow(student: Student): StudentsRow {
  const row: StudentsRow = {
    id: student.id,
    first_name: student.firstName,
    last_name: student.lastName,
    whatsapp_phone: student.whatsappPhone,
    parent_phone: student.parentPhone,
    level: student.level,
    track: student.track,
    enrollments:
      ((student.enrollments as unknown) as StudentsRow["enrollments"]) ?? [],
    created_at: student.createdAt,
    updated_at: new Date().toISOString(),
    registration_fee:
      ((student.registrationFee as unknown) as StudentsRow["registration_fee"]) ??
      null,
  };
  // Only persist advance_balance when it is non-zero: the column defaults to
  // 0, so omitting it is behaviourally identical, and it keeps student
  // inserts working even on databases where the column is not migrated yet.
  if (student.advanceBalance) {
    row.advance_balance = student.advanceBalance;
  }
  return row;
}

export function rowToStudent(row: StudentsRow): Student {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    whatsappPhone: row.whatsapp_phone,
    parentPhone: row.parent_phone,
    level: row.level,
    track: row.track,
    enrollments:
      ((row.enrollments as unknown) as Student["enrollments"]) ?? [],
    createdAt: row.created_at,
    registrationFee:
      ((row.registration_fee as unknown) as Student["registrationFee"]) ??
      undefined,
    advanceBalance: row.advance_balance ?? 0,
  };
}

// --- Session conversion -----------------------------------------------

export function sessionToRow(session: Session): SessionsRow {
  return {
    id: session.id,
    subject: session.subject,
    level: session.level,
    track: session.track,
    group_type: session.groupType,
    day_of_week: session.dayOfWeek,
    start_time: session.startTime,
    end_time: session.endTime,
    teacher_name: session.teacherName ?? null,
    kind: session.kind ?? "recurring",
    date: session.date ?? null,
  };
}

export function rowToSession(row: SessionsRow): Session {
  return {
    id: row.id,
    subject: row.subject,
    level: row.level,
    track: row.track,
    groupType: row.group_type,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    teacherName: row.teacher_name ?? undefined,
    kind: row.kind ?? "recurring",
    date: row.date,
  };
}

// --- Price conversion --------------------------------------------------

export function priceToRow(entry: PriceEntry): PricesRow {
  return {
    id: entry.id,
    level: entry.level,
    subject: entry.subject,
    track: entry.track,
    group_type: entry.groupType,
    price: entry.price,
    created_at: new Date().toISOString(),
  };
}

export function rowToPrice(row: PricesRow): PriceEntry {
  return {
    id: row.id,
    level: row.level,
    subject: row.subject,
    track: row.track,
    groupType: row.group_type,
    price: row.price,
  };
}

// --- Attendance conversion ---------------------------------------------

export function attendanceToRow(
  record: AttendanceRecord,
): AttendanceRecordsRow {
  return {
    id: record.id,
    student_id: record.studentId,
    session_id: record.sessionId,
    date: record.date,
    status: record.status,
    marked_at: record.markedAt,
    timestamp: record.timestamp,
    is_guest: record.isGuest ?? false,
  };
}

export function rowToAttendance(row: AttendanceRecordsRow): AttendanceRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    sessionId: row.session_id,
    date: row.date,
    status: row.status,
    markedAt: row.marked_at,
    timestamp: row.timestamp,
    isGuest: row.is_guest ?? false,
  };
}

// --- Payment conversion ------------------------------------------------

export function paymentToRow(payment: Payment): PaymentsRow {
  return {
    id: payment.id,
    student_id: payment.studentId,
    subject: payment.subject,
    due_date: payment.dueDate,
    month: payment.month,
    is_paid: payment.isPaid,
    amount_due: payment.amountDue,
    amount_paid: payment.amountPaid ?? 0,
    is_half_month: payment.isHalfMonth,
    rule: payment.rule,
    updated_at: payment.updatedAt,
  };
}

export function rowToPayment(row: PaymentsRow): Payment {
  // Backward compat: legacy docs have no amount_paid → default 0
  const amountPaid = row.amount_paid ?? 0;
  return {
    id: row.id,
    studentId: row.student_id,
    subject: row.subject,
    dueDate: row.due_date,
    month: row.month,
    isPaid: row.is_paid,
    amountDue: row.amount_due,
    amountPaid: amountPaid,
    isHalfMonth: row.is_half_month,
    rule: row.rule,
    updatedAt: row.updated_at,
  };
}

// --- Message conversion ------------------------------------------------

export function messageToRow(message: LevelMessage): MessagesRow {
  return {
    id: message.id,
    level: message.level,
    title: message.title,
    body: message.body,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  };
}

export function rowToMessage(row: MessagesRow): LevelMessage {
  return {
    id: row.id,
    level: row.level,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}