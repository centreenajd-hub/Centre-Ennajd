// Core domain types for Centre Ennajd ERP.
// This module has zero React/Zustand dependencies — pure data shapes.

export type Level = "T.C" | "1Bac" | "2Bac" | "1Col" | "2Col" | "3Col";

export type Track = "s.x" | "s.m";

export type GroupType = "Large" | "Small";

export type Subject =
  | "Math"
  | "PC"
  | "SVT"
  | "French"
  | "Arabic"
  | "SocialStudies"
  | "IslamicStudies"
  | "Philosophy"
  | "English";

export type SessionKind = "recurring" | "one_off";

export interface Session {
  id: string;
  subject: Subject;
  level: Level;
  track: Track | null;
  groupType: GroupType | null;
  dayOfWeek: number; // 0 (Sunday) .. 6 (Saturday)
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  teacherName?: string;
  /** "recurring" = weekly Fix, "one_off" = Zaida single date. undefined = recurring (backward compat). */
  kind?: SessionKind;
  /** "YYYY-MM-DD" — only for kind==="one_off". */
  date?: string | null;
}

export interface PriceEntry {
  id: string;
  level: Level;
  subject: Subject;
  track: Track | null; // null for track-less levels and combined classes
  groupType: GroupType | null;
  price: number; // MAD per month
}

/**
 * A subject enrollment identifies a "class" the student belongs to by
 * combo (Level [from Student] + Track + GroupType + Subject) — not by a
 * foreign key to a specific scheduled Session row. Any Session whose
 * level/subject/track/groupType matches this combo dynamically includes
 * this student in its roster.
 */
export interface SubjectEnrollment {
  subject: Subject;
  track: Track | null; // inherited from the student's track; null for combined classes
  groupType: GroupType | null; // only meaningful where the level/subject supports it
  customPrice?: number; // overrides the base PriceEntry for this student+subject
  enrolledAt?: string; // ISO date — when this subject was added; defaults to student.createdAt
  /** Free-text payment note at the student+subject level (pencil dialog). */
  paymentNote?: string;
  /** Manual subscription length for small-group s.x billing (1/3/6/12) — purely informative / synced to ledger. */
  subscriptionMonths?: number;
}

/**
 * One-time registration fee (رسوم التسجيل / frais d'inscription — 100 DH by
 * default), tracked COMPLETELY separately from the monthly Rule A/B
 * installment engine. `undefined` on a student = legacy = implicitly PAID
 * (hidden everywhere); the admin can materialize/adjust it via the pencil
 * dialog. Eligibility: ≥1 enrollment whose groupType !== "Small".
 */
export interface RegistrationFee {
  amountDue: number; // default 100 — editable (exemption/discount, 0 = exempt)
  amountPaid: number; // 0..amountDue — supports partial payments
  note?: string; // free-text note shown wherever the fee is shown
  settledAt?: string; // ISO when fully paid
  updatedAt?: string;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  whatsappPhone: string;
  parentPhone: string;
  level: Level;
  track: Track | null;
  enrollments: SubjectEnrollment[];
  createdAt: string; // ISO date string — join date, used later for billing rules
  /** Absent on legacy students = implicitly paid; see RegistrationFee. */
  registrationFee?: RegistrationFee;
  /** Cross-subject advance credit (MAD) carried over from over-payments. */
  advanceBalance?: number;
}

/**
 * A saved per-level WhatsApp message ("Missa4at" page). Picking one and
 * tapping "Irsal" opens wa.me with the body pre-filled for the default
 * number (see `ennajd-whatsapp.ts`).
 */
export interface LevelMessage {
  id: string;
  level: Level;
  title: string;
  body: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export type AttendanceStatus = "present" | "absent";

export interface AttendanceRecord {
  id: string;
  studentId: string;
  sessionId: string;
  date: string; // "YYYY-MM-DD" — the calendar occurrence
  status: AttendanceStatus;
  markedAt: string; // ISO timestamp
  timestamp: string; // "HH:mm" — exact time attendance was registered, drives the PDF's time-tracking cell
  isGuest?: boolean; // true if student is enrolled elsewhere but cross-attending a Small group
}

/** Which billing engine governs a given enrollment — see `ennajd-billing.ts`. */
export type PaymentRule = "A" | "B";

/**
 * A single dated installment in a student+subject's payment ledger.
 * `amountDue` is frozen at generation time — later price changes never
 * retroactively alter already-generated rows. Keyed by
 * studentId + subject + dueDate (not just `month`, since Rule B doesn't
 * align to calendar months).
 */
export interface Payment {
  id: string;
  studentId: string;
  subject: Subject;
  dueDate: string; // "YYYY-MM-DD"
  month: string; // "YYYY-MM" — calendar month of dueDate, for display/filtering
  isPaid: boolean;
  amountDue: number; // MAD, frozen at generation time
  amountPaid: number; // MAD, accumulated partial payment (default 0)
  isHalfMonth: boolean;
  rule: PaymentRule;
  updatedAt: string; // ISO timestamp
}
