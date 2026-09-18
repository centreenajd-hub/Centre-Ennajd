import { Receipt, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import {
  formatDateKey,
  getPaymentRemaining,
  getRegistrationFeeRemaining,
  isRegistrationFeeUnpaid,
} from "@/lib/ennajd-billing";
import { matchedIndices, rankStudentsByQuery } from "@/lib/fuzzy-search";
import { getEligibleGuestStudents, getEnrolledStudentsForSession } from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Payment, Session, Student, Subject } from "@/types/ennajd";

interface GlobalAttendanceSearchProps {
  now: Date;
  date: string;
  liveSessions: Session[];
}

interface LiveMatch {
  session: Session;
  isGuest: boolean;
}

/** Per-subject overdue summary for the ⚠ pill and the warning toast. */
interface OverdueInfo {
  /** Number of subjects with ≥1 due-unpaid installment. */
  subjectCount: number;
  /** "Math 200 MAD · PC 150 MAD" breakdown, subjects ordered by name. */
  breakdown: string;
}

function resolveLiveMatchesFor(student: Student, liveSessions: Session[]): LiveMatch[] {
  const matches: LiveMatch[] = [];
  for (const session of liveSessions) {
    if (getEnrolledStudentsForSession([student], session).length > 0) {
      matches.push({ session, isGuest: false });
      continue;
    }
    if (getEligibleGuestStudents(session, [student]).length > 0) {
      matches.push({ session, isGuest: true });
    }
  }
  return matches;
}

function renderHighlightedName(name: string, query: string) {
  const indices = matchedIndices(query, name);
  if (indices.size === 0) return name;
  return name
    .split("")
    .map((char, index) =>
      indices.has(index) ? (
        <span key={index} className="font-bold text-foreground">
          {char}
        </span>
      ) : (
        <span key={index}>{char}</span>
      ),
    );
}

/**
 * Single O(payments) pass → studentId → { subjectCount, breakdown } for every
 * student with ≥1 due-unpaid installment in ANY subject (same "due" semantics
 * as hasOutstandingBalance: unpaid AND dueDate <= today, remaining-aware).
 */
function buildOverdueMap(
  payments: Payment[],
  todayKey: string,
): Map<string, OverdueInfo> {
  // subject totals per student, accumulated first
  const totals = new Map<string, Map<Subject, number>>();
  for (const p of payments) {
    if (p.isPaid || p.dueDate > todayKey) continue;
    const remaining = getPaymentRemaining(p);
    if (remaining <= 0) continue;
    let bySubject = totals.get(p.studentId);
    if (!bySubject) {
      bySubject = new Map<Subject, number>();
      totals.set(p.studentId, bySubject);
    }
    bySubject.set(p.subject, (bySubject.get(p.subject) ?? 0) + remaining);
  }

  const result = new Map<string, OverdueInfo>();
  for (const [studentId, bySubject] of totals) {
    const parts = [...bySubject.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([subject, amount]) => `${subject} ${amount} MAD`);
    result.set(studentId, { subjectCount: bySubject.size, breakdown: parts.join(" · ") });
  }
  return result;
}

export function GlobalAttendanceSearch({ now, date, liveSessions }: GlobalAttendanceSearchProps) {
  const { t } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const payments = useEnnajdState((s) => s.payments);
  const markAttendance = useEnnajdState((s) => s.markAttendance);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const todayKey = formatDateKey(now);

  const suggestions = useMemo(
    () => rankStudentsByQuery(students, query, 8),
    [students, query],
  );

  // Overdue map memoized per render pass — one O(payments) pass shared by
  // every suggestion row badge and the post-commit warning toast.
  const overdueByStudent = useMemo(
    () => buildOverdueMap(payments, todayKey),
    [payments, todayKey],
  );

  const suggestionsWithLiveInfo = useMemo(
    () =>
      suggestions.map((student) => ({
        student,
        hasLiveSessionNow: resolveLiveMatchesFor(student, liveSessions).length > 0,
        overdue: overdueByStudent.get(student.id) ?? null,
        feeRemaining: isRegistrationFeeUnpaid(student)
          ? getRegistrationFeeRemaining(student)
          : null,
      })),
    [suggestions, liveSessions, overdueByStudent],
  );

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  async function commitSelection(student: Student) {
    const matches = resolveLiveMatchesFor(student, liveSessions);
    const fullName = `${student.firstName} ${student.lastName}`;

    if (matches.length === 0) {
      toast.error(`${fullName} — ${t("noLiveSessionForStudent")}`, { duration: 2000 });
      return;
    }

    // Subject isolation: mark attendance for only ONE session — the first match.
    // Previously the loop wrote to all matching sessions, so a student enrolled
    // in multiple subjects (e.g. Math + PC) whose sessions were both live would
    // get attendance recorded for every subject simultaneously.
    const match = matches[0];
    // Optimistic write: the chip flips instantly; the success toast waits for
    // the confirmed write. On failure the store reverts + toasts the error.
    const ok = await markAttendance(student.id, match.session.id, date, "present", {
      isManualOverride: true,
      isGuest: match.isGuest,
    });
    if (ok) {
      toast.success(`${fullName} — ${t("present")} ✓`, { duration: 2000 });
    }

    // Unpaid warning right after the success toast: list every subject this
    // student still owes money for, computed from due-unpaid installments.
    // The registration fee is appended as a separate segment (or a standalone
    // warning when there is no subject debt but the fee is still unpaid).
    const overdue = overdueByStudent.get(student.id);
    const feeRemaining = isRegistrationFeeUnpaid(student)
      ? getRegistrationFeeRemaining(student)
      : 0;
    if (overdue) {
      const feeSegment =
        feeRemaining > 0
          ? ` · ${t("registrationFee")}: ${feeRemaining} MAD`
          : "";
      toast.warning(
        `${fullName} — ${t("unpaidWarningFull")} : ${overdue.breakdown}${feeSegment}`,
        { duration: 4000 },
      );
    } else if (feeRemaining > 0) {
      toast.warning(
        `${fullName} — ${t("registrationFeeWarningToast")} : ${feeRemaining} MAD`,
        { duration: 4000 },
      );
    }

    setQuery("");
    setActiveIndex(-1);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = suggestions[activeIndex >= 0 ? activeIndex : 0];
      if (target) commitSelection(target);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
            setOpen(e.target.value.trim().length > 0);
          }}
          onFocus={() => {
            if (query.trim().length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("smartSearchPlaceholder")}
          className="h-14 rounded-2xl border-2 border-border ps-12 pe-4 text-base shadow-sm transition-all focus-visible:border-primary focus-visible:shadow-md focus-visible:ring-4 focus-visible:ring-primary/20"
        />
      </div>
      <p className="mt-1.5 ps-1 text-xs text-muted-foreground">{t("smartSearchHint")}</p>

      {open && (
        <div className="absolute top-full z-20 mt-2 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          {suggestionsWithLiveInfo.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {suggestionsWithLiveInfo.map(({ student, hasLiveSessionNow, overdue, feeRemaining }, index) => (
                <li key={student.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commitSelection(student)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors",
                      index === activeIndex
                        ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {student.firstName[0]?.toUpperCase() ?? ""}
                      {student.lastName[0]?.toUpperCase() ?? ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {renderHighlightedName(`${student.firstName} ${student.lastName}`, query)}
                      <span className="text-muted-foreground"> — {student.level}</span>
                    </span>
                    {overdue && (
                      <span
                        title={overdue.breakdown}
                        className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 text-xs font-bold text-destructive"
                      >
                        <TriangleAlert className="h-3 w-3" />
                        {overdue.subjectCount}
                      </span>
                    )}
                    {feeRemaining !== null && (
                      <span
                        title={t("registrationFee")}
                        className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 text-xs font-bold text-destructive"
                      >
                        <Receipt className="h-3 w-3" />
                        {feeRemaining}
                      </span>
                    )}
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        hasLiveSessionNow ? "animate-pulse bg-success" : "bg-muted-foreground/40",
                      )}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
