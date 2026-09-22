// Centre Ennajd educational taxonomy — "The Shield".
//
// Every routing rule from the business blueprint lives here as pure data and
// pure functions. No React, no Zustand. Every feature (Registration,
// Attendance, Pricing, PDF exports) must read subject/track/group-type rules
// from this module instead of re-deriving them inline.

import type { GroupType, Level, Session, SessionKind, Student, Subject, Track } from "@/types/ennajd";

export const LEVELS: Level[] = ["T.C", "1Bac", "2Bac", "1Col", "2Col", "3Col"];

export const TRACKS: Track[] = ["s.x", "s.m"];

export const GROUP_TYPES: GroupType[] = ["Large", "Small"];

export const ALL_SUBJECTS: Subject[] = [
  "Math",
  "PC",
  "SVT",
  "French",
  "Arabic",
  "SocialStudies",
  "IslamicStudies",
  "Philosophy",
  "English",
];

/** Collège (1Col/2Col/3Col) subject list — track-less. One-line edit later. */
const COLLEGE_SUBJECTS: Subject[] = ["Math", "PC", "SVT", "French", "Arabic"];

const TC_SUBJECTS: Subject[] = ["Math", "PC", "SVT"];

const BAC1_SUBJECTS: Subject[] = [
  "Math",
  "PC",
  "French",
  "Arabic",
  "SocialStudies",
  "IslamicStudies",
];

/** Subjects that support the Small/Large group split (2Bac only). */
const SMALL_GROUP_ELIGIBLE_SUBJECTS: Subject[] = ["Math", "PC", "SVT"];

/** Levels that require the user to pick a track (s.x / s.m). */
export function isTrackRequired(level: Level): boolean {
  return level === "1Bac" || level === "2Bac";
}

/** Levels that support the Large/Small group-type selector at all. */
export function isGroupTypeSelectableForLevel(level: Level): boolean {
  return level === "2Bac";
}

/**
 * Returns the subjects a student can enroll in for a given Level + Track.
 * If the level requires a track and none is provided yet, returns [] so the
 * UI can prompt for the track first instead of guessing.
 */
export function getSubjectsFor(level: Level, track: Track | null): Subject[] {
  if (isTrackRequired(level) && !track) return [];

  switch (level) {
    case "T.C":
      return TC_SUBJECTS;
    case "1Col":
    case "2Col":
    case "3Col":
      return COLLEGE_SUBJECTS;
    case "1Bac":
      // Tracks are fully separated (different sessions) but share the same
      // subject list.
      return BAC1_SUBJECTS;
    case "2Bac":
      if (track === "s.x") {
        return ["Math", "PC", "SVT", "Philosophy", "English"];
      }
      // s.m: no SVT.
      return ["Math", "PC", "Philosophy", "English"];
    default:
      return [];
  }
}

/** Union of subjects across both tracks — used for level-wide views (Pricing). */
function getAllSubjectsForLevel(level: Level): Subject[] {
  if (!isTrackRequired(level)) return getSubjectsFor(level, null);
  const set = new Set<Subject>();
  for (const track of TRACKS) {
    for (const subject of getSubjectsFor(level, track)) set.add(subject);
  }
  return Array.from(set);
}

/**
 * Whether the Large/Small group-type choice *applies* to this level+subject
 * at all — i.e. the subject has a group-type dimension. Only 2Bac Math/PC/SVT
 * carry a group type. 1Bac (and every other level) is always a combined
 * class — Philosophy and English (2Bac only) too.
 *
 * This function only answers "does this subject have a group type?". Whether
 * the *Small* option is actually offered depends on the track — see
 * `canSubjectBeSmallGroup`.
 */
export function isGroupTypeApplicable(level: Level, subject: Subject): boolean {
  return isGroupTypeSelectableForLevel(level) && SMALL_GROUP_ELIGIBLE_SUBJECTS.includes(subject);
}

/**
 * Whether Small groups are allowed for this Level + Track + Subject.
 * Only the S.X track may offer Small groups (on the group-type-eligible
 * subjects); the S.M track is Large-only in every subject. Subjects without
 * a group type (or non-2Bac levels) never allow Small.
 */
export function canSubjectBeSmallGroup(
  level: Level,
  track: Track | null,
  subject: Subject,
): boolean {
  return track === "s.x" && isGroupTypeApplicable(level, subject);
}

/**
 * The 2Bac S.X subjects that can carry a Small group — the fixed roster of
 * the "Petits groupes (s.x)" payment view (Payments page). Derived from the
 * 2Bac s.x subject list, so it can never drift from
 * `getSubjectsFor`/`canSubjectBeSmallGroup`.
 */
export const SMALL_GROUP_SUBJECTS: Subject[] = getSubjectsFor("2Bac", "s.x").filter(
  (subject) => canSubjectBeSmallGroup("2Bac", "s.x", subject),
);

/**
 * 2Bac Philosophy & English are combined classes: s.x and s.m students share
 * the same physical session, so the session itself has no track.
 */
export function isCombinedClass(level: Level, subject: Subject): boolean {
  return level === "2Bac" && (subject === "Philosophy" || subject === "English");
}

/** A Level/Subject/Track/GroupType combo — the unit a report scope is defined by. */
export interface EnrollmentCombo {
  level: Level;
  subject: Subject;
  track: Track | null;
  groupType: GroupType | null;
}

/**
 * The single canonical roster matcher: a student belongs to a combo's
 * roster when their Level and one of their enrollments' Subject/Track/
 * GroupType combo exactly matches. No FK involved — any Session sharing the
 * same combo (e.g. a second teacher) dynamically pulls in the same students.
 */
export function getEnrolledStudentsForCombo(
  students: Student[],
  combo: EnrollmentCombo,
): Student[] {
  return students.filter(
    (student) =>
      student.level === combo.level &&
      student.enrollments.some(
        (enrollment) =>
          enrollment.subject === combo.subject &&
          normalizeNull(enrollment.track) === normalizeNull(combo.track) &&
          normalizeNull(enrollment.groupType) === normalizeNull(combo.groupType),
      ),
  );
}

/** Convenience wrapper for the common case of matching a single concrete Session. */
export function getEnrolledStudentsForSession(
  students: Student[],
  session: Session,
): Student[] {
  return getEnrolledStudentsForCombo(students, {
    level: session.level,
    subject: session.subject,
    track: session.track,
    groupType: session.groupType,
  });
}

// Normalizes `undefined` (legacy Firestore docs where the field was
// deleted) to `null` (current schema) so strict `===` comparisons and
// combo-key lookups don't fail silently (e.g. track: undefined vs null).
function normalizeNull<T extends string | null | undefined>(value: T): string | null {
  return (value ?? null) as string | null;
}

function buildComboKey(
  level: Level,
  subject: Subject,
  track: Track | null | undefined,
  groupType: GroupType | null | undefined,
): string {
  return `${level}__${subject}__${normalizeNull(track)}__${normalizeNull(groupType)}`;
}

/**
 * True when at least one of the student's enrollments matches an existing
 * Session's Level/Subject/Track/GroupType combo. Students with no
 * enrollments, or whose enrollments don't correspond to any defined session
 * yet, return false.
 */
export function hasMatchingSession(student: Student, sessions: Session[]): boolean {
  return student.enrollments.some((enrollment) =>
    sessions.some(
      (session) =>
        session.level === student.level &&
        session.subject === enrollment.subject &&
        normalizeNull(session.track) === normalizeNull(enrollment.track) &&
        normalizeNull(session.groupType) === normalizeNull(enrollment.groupType),
    ),
  );
}

/** Convenience wrapper: filters a student list down to those with a matching session. */
export function filterStudentsWithMatchingSession(
  students: Student[],
  sessions: Session[],
): Student[] {
  // Build the session combo set once so each enrollment check is an O(1)
  // lookup instead of re-scanning the whole sessions array.
  const sessionComboKeys = new Set(
    sessions.map((session) =>
      buildComboKey(session.level, session.subject, session.track, session.groupType),
    ),
  );
  return students.filter((student) =>
    student.enrollments.some((enrollment) =>
      sessionComboKeys.has(
        buildComboKey(student.level, enrollment.subject, enrollment.track, enrollment.groupType),
      ),
    ),
  );
}

/** All (subject, groupType) combinations a level needs a base price for. */
export function getPricableCombosForLevel(
  level: Level,
): { subject: Subject; groupType: GroupType | null }[] {
  const subjects = getAllSubjectsForLevel(level);
  const combos: { subject: Subject; groupType: GroupType | null }[] = [];
  for (const subject of subjects) {
    if (isGroupTypeApplicable(level, subject)) {
      combos.push({ subject, groupType: "Large" });
      combos.push({ subject, groupType: "Small" });
    } else {
      combos.push({ subject, groupType: null });
    }
  }
  return combos;
}

/**
 * All (subject, track, groupType) combinations a level+track needs a base
 * price for — used by levels that require a track (1Bac/2Bac). Combined
 * classes (Philosophy/English in 2Bac) always resolve to track: null since
 * they share a single price across both tracks.
 */
export function getPricableCombosForLevelTrack(
  level: Level,
  track: Track,
): { subject: Subject; track: Track | null; groupType: GroupType | null }[] {
  const subjects = getSubjectsFor(level, track);
  const combos: { subject: Subject; track: Track | null; groupType: GroupType | null }[] = [];
  for (const subject of subjects) {
      const effectiveTrack = isCombinedClass(level, subject) ? null : track;
      // The S.M track is Large-only; only the S.X track can also offer Small.
      if (isGroupTypeApplicable(level, subject)) {
        combos.push({ subject, track: effectiveTrack, groupType: "Large" });
        if (canSubjectBeSmallGroup(level, track, subject)) {
          combos.push({ subject, track: effectiveTrack, groupType: "Small" });
        }
      } else {
        combos.push({ subject, track: effectiveTrack, groupType: null });
      }
    }
    return combos;
  }

// --- Session kind helpers (Fix vs Zaida) ---------------------------------

/** Local YYYY-MM-DD — avoids UTC shift, mirrors ennajd-billing formatDateKey. */
export function formatDateKeyLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getSessionKind(session: Session): SessionKind {
  return (session.kind as SessionKind) ?? "recurring";
}

export function isOneOffSession(session: Session): boolean {
  return getSessionKind(session) === "one_off";
}

export function normalizeSessionKind(kind: string | undefined): SessionKind {
  return kind === "one_off" ? "one_off" : "recurring";
}

export function getSessionDisplayDate(session: Session): string | null {
  if (isOneOffSession(session) && session.date) return session.date;
  return null;
}

export const SESSION_KIND_LABELS: Record<SessionKind, { fr: string; ar: string }> = {
  recurring: { fr: "Fixe", ar: "ثابتة" },
  one_off: { fr: "Extra", ar: "إضافية" },
};

// --- Attendance engine (Phase 2) — pure time math, fed by an explicit `now`. ---

/** A session becomes visible this many minutes before its startTime. */
const VISIBILITY_BEFORE_MIN = 40;

/** Auto-absence fires this many minutes after startTime. */
const AUTO_ABSENCE_AFTER_MIN = 32;

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Session Visibility Engine: a session appears on the dashboard
 * VISIBILITY_BEFORE_MIN before its startTime on its own day of week, and
 * STAYS visible for the rest of that day — the app never hides a live
 * session on its own. The only automatic removal is the day rollover; the
 * admin dismisses finished sessions manually via the card's ⋮ menu.
 */
export function isSessionVisible(session: Session, now: Date): boolean {
  if (now.getDay() !== session.dayOfWeek) return false;
  const startMinutes = parseTimeToMinutes(session.startTime);
  const nowMinutes = minutesSinceMidnight(now);
  return nowMinutes >= startMinutes - VISIBILITY_BEFORE_MIN;
}

/** One-off visibility: visible only on its exact date, from its start onward. */
export function isOneOffSessionVisible(session: Session, now: Date): boolean {
  if (!isOneOffSession(session)) return false;
  if (!session.date) return false;
  const todayKey = formatDateKeyLocal(now);
  if (session.date !== todayKey) return false;
  const startMinutes = parseTimeToMinutes(session.startTime);
  const nowMinutes = minutesSinceMidnight(now);
  return nowMinutes >= startMinutes - VISIBILITY_BEFORE_MIN;
}

/** Unified dispatcher — handles both Fix and Zaida. */
export function isSessionVisibleUnified(session: Session, now: Date): boolean {
  return isOneOffSession(session) ? isOneOffSessionVisible(session, now) : isSessionVisible(session, now);
}

/**
 * "Active now" — the session has gone live (its visibility window has
 * opened) and it has not passed its endTime yet. Drives the green badge;
 * the card itself outlives this (see isSessionVisibleUnified).
 */
export function isSessionInProgress(session: Session, now: Date): boolean {
  if (isOneOffSession(session)) {
    if (!session.date) return false;
    if (session.date !== formatDateKeyLocal(now)) return false;
  } else if (now.getDay() !== session.dayOfWeek) {
    return false;
  }
  const startMinutes = parseTimeToMinutes(session.startTime);
  const endMinutes = parseTimeToMinutes(session.endTime);
  const nowMinutes = minutesSinceMidnight(now);
  return (
    nowMinutes >= startMinutes - VISIBILITY_BEFORE_MIN && nowMinutes <= endMinutes
  );
}

/**
 * Auto-Absence Trigger: once true, any enrolled student without a manual
 * attendance record for today's occurrence of this session should be
 * flagged absent.
 */
export function shouldAutoMarkAbsent(session: Session, now: Date): boolean {
  if (now.getDay() !== session.dayOfWeek) return false;
  const startMinutes = parseTimeToMinutes(session.startTime);
  const nowMinutes = minutesSinceMidnight(now);
  return nowMinutes >= startMinutes + AUTO_ABSENCE_AFTER_MIN;
}

export function shouldAutoMarkAbsentOneOff(session: Session, now: Date): boolean {
  if (!isOneOffSession(session)) return false;
  if (!session.date) return false;
  const todayKey = formatDateKeyLocal(now);
  if (session.date !== todayKey) return false;
  const startMinutes = parseTimeToMinutes(session.startTime);
  const nowMinutes = minutesSinceMidnight(now);
  return nowMinutes >= startMinutes + AUTO_ABSENCE_AFTER_MIN;
}

/** Minutes from `now` until the next occurrence of this session. */
export function getMinutesUntilNextOccurrence(session: Session, now: Date): number {
  // One-off: single future occurrence or Infinity if already passed
  if (isOneOffSession(session) && session.date) {
    const [y, m, d] = session.date.split("-").map(Number);
    const startMinutes = parseTimeToMinutes(session.startTime);
    const h = Math.floor(startMinutes / 60);
    const min = startMinutes % 60;
    const sessionStart = new Date(y, m - 1, d, h, min, 0, 0);
    const diff = Math.floor((sessionStart.getTime() - now.getTime()) / 60000);
    if (diff < 0) return Infinity;
    return diff;
  }
  const startMinutes = parseTimeToMinutes(session.startTime);
  const nowMinutes = minutesSinceMidnight(now);
  let dayDiff = session.dayOfWeek - now.getDay();
  if (dayDiff < 0) dayDiff += 7;
  let minutesUntil = dayDiff * 24 * 60 + (startMinutes - nowMinutes);
  if (minutesUntil < 0) minutesUntil += 7 * 24 * 60;
  return minutesUntil;
}

/**
 * Small/Large cross-attendance rule made actionable: a Small-group student
 * enrolled in the same subject+level but a *different* track's Small-group
 * class may attend this Small session as a guest (their own track's class
 * covers the same combo, so if it were the same track they'd already be a
 * regular enrollee here). Large-group students are never eligible.
 */
export function getEligibleGuestStudents(
  session: Session,
  students: Student[],
): Student[] {
  if (session.groupType !== "Small") return [];
  return students.filter((student) => {
    if (student.level !== session.level) return false;

    const alreadyEnrolledInThisCombo = student.enrollments.some(
      (enrollment) =>
        enrollment.subject === session.subject &&
        enrollment.track === session.track &&
        enrollment.groupType === session.groupType,
    );
    if (alreadyEnrolledInThisCombo) return false;

    return student.enrollments.some(
      (enrollment) =>
        enrollment.subject === session.subject &&
        enrollment.groupType === "Small" &&
        enrollment.track !== session.track,
    );
  });
}
