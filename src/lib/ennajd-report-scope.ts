// Cascading scope resolution for the Report Generator — pins a Level +
// Track/GroupType + Subject combination down to all matching Sessions and
// derives the aggregated student roster for that scope. Zero React/Zustand
// — same pattern as ennajd-taxonomy.ts.

import { getEnrolledStudentsForCombo } from "@/lib/ennajd-taxonomy";
import type {
  AttendanceRecord,
  GroupType,
  Level,
  Session,
  Student,
  Subject,
  Track,
} from "@/types/ennajd";

export interface SessionScope {
  level: Level;
  track: Track | null;
  groupType: GroupType | null;
  subject: Subject;
}

/** All sessions matching an exact scope — normally 0 or 1, occasionally 2+ (multiple teachers). */
export function resolveMatchingSessions(sessions: Session[], scope: SessionScope): Session[] {
  return sessions.filter(
    (s) =>
      s.level === scope.level &&
      s.subject === scope.subject &&
      s.track === scope.track &&
      s.groupType === scope.groupType,
  );
}

/**
 * The exact roster for a resolved scope: students whose Level/Track/
 * GroupType/Subject combo matches `scope` (via `getEnrolledStudentsForCombo`),
 * plus any guest who has at least one attendance record marked `isGuest`
 * for one of `matchingSessions` (Small-group cross-attendance). Works fine
 * with an empty `matchingSessions` array — the scope no longer needs to be
 * derived from an actual Session.
 */
export function getRosterForScope(
  students: Student[],
  scope: SessionScope,
  matchingSessions: Session[] = [],
  attendanceRecords: AttendanceRecord[] = [],
): Student[] {
  const enrolledStudents = getEnrolledStudentsForCombo(students, {
    level: scope.level,
    subject: scope.subject,
    track: scope.track,
    groupType: scope.groupType,
  });
  const enrolledIds = new Set(enrolledStudents.map((s) => s.id));
  const sessionIds = new Set(matchingSessions.map((s) => s.id));
  const guestIds = new Set(
    attendanceRecords
      .filter((r) => sessionIds.has(r.sessionId) && r.isGuest && !enrolledIds.has(r.studentId))
      .map((r) => r.studentId),
  );
  const guestStudents = students.filter((s) => guestIds.has(s.id));
  return [...enrolledStudents, ...guestStudents];
}
