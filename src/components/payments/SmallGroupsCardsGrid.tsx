import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { SmallGroupStudentCard } from "@/components/payments/SmallGroupStudentCard";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKey, getDueBalanceForStudentSubject } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { getPageNumbers } from "@/lib/pagination";
import { buildWhatsAppLink } from "@/lib/ennajd-whatsapp";
import { normalizeText } from "@/lib/text-normalize";
import { cn } from "@/lib/utils";
import type { Subject } from "@/types/ennajd";

interface SmallGroupsCardsGridProps {
  subject: Subject;
  todayKey: string;
  search: string;
}

const PAGE_SIZE = 24;

export function SmallGroupsCardsGrid({ subject, todayKey, search }: SmallGroupsCardsGridProps) {
  const { t, lang } = useI18n();
  const students = useEnnajdState((s) => s.students);
  const payments = useEnnajdState((s) => s.payments);

  const [retardsOnly, setRetardsOnly] = useState(false);
  const [page, setPage] = useState(1);

  // Group send — builds wa.me links for the *visible* (paginated) roster's
  // students who have a phone number, opens the first in a new tab so the
  // user can fire off the reminders manually (WhatsApp cannot auto-send).
  function handleSendReminders() {
    const withPhones = paged.filter((s) => s.whatsappPhone);
    if (withPhones.length === 0) return;
    const first = withPhones[0];
    const name = `${first.firstName} ${first.lastName}`;
    const text =
      lang === "ar"
        ? `مرحبا ${name}، تذكير: استحقاقك القادم لمادة ${subject} (مجموعة صغيرة 2Bac s.x) هو ${formatDateKey(new Date())}. المرجو التسوية. — مركز النجد`
        : `Bonjour ${name}, rappel : votre prochaine échéance ${subject} (Petit groupe 2Bac s.x). Merci de régulariser. — Centre Ennajd`;
    window.open(buildWhatsAppLink(text, first.whatsappPhone), "_blank");
  }

  useEffect(() => {
    setPage(1);
  }, [subject, search, retardsOnly]);

  const rosterFiltered = useMemo(() => {
    const q = normalizeText(search);
    const base = students.filter(
      (s) => s.level === "2Bac" && s.enrollments.some((e) => e.subject === subject && e.groupType === "Small" && e.track === "s.x")
    );
    let list = base;
    if (q) list = list.filter((s) => normalizeText(`${s.firstName} ${s.lastName}`).includes(q));
    if (retardsOnly) {
      list = list.filter((s) => getDueBalanceForStudentSubject(payments, s.id, subject, todayKey).isOverdue);
    }
    // Stable A→Z
    list = [...list].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
    return list;
  }, [students, subject, search, payments, todayKey, retardsOnly]);

  const totalPages = Math.max(1, Math.ceil(rosterFiltered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = rosterFiltered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const retardsCount = useMemo(() => {
    const base = students.filter(
      (s) => s.level === "2Bac" && s.enrollments.some((e) => e.subject === subject && e.groupType === "Small" && e.track === "s.x")
    );
    return base.filter((s) => getDueBalanceForStudentSubject(payments, s.id, subject, todayKey).isOverdue).length;
  }, [students, subject, payments, todayKey]);

  if (rosterFiltered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">{search.trim() ? t("noResults") : t("noSmallGroupCards")}</p>
        {retardsOnly && (
          <Button variant="ghost" size="sm" className="mt-2 rounded-full" onClick={() => setRetardsOnly(false)}>
            {t("clearFilters")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={retardsOnly ? "default" : "outline"}
          size="sm"
          className={cn("rounded-full", retardsOnly && "bg-destructive text-white hover:bg-destructive/90")}
          onClick={() => setRetardsOnly((v) => !v)}
        >
          {t("retardsFilter")} ({retardsCount})
        </Button>
        <span className="text-xs text-muted-foreground">
          {retardsCount} {t("studentsCount")} en retard
        </span>
        <Button
          size="sm"
          className="rounded-full bg-teal-600 text-white hover:bg-teal-700"
          onClick={handleSendReminders}
          disabled={paged.filter((s) => s.whatsappPhone).length === 0}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paged.map((student) => (
          <SmallGroupStudentCard key={student.id} student={student} subject={subject} todayKey={todayKey} />
        ))}
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.max(1, p - 1));
                }}
                className={cn(currentPage === 1 && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
            {getPageNumbers(currentPage, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <PaginationItem key={`e-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === currentPage}
                    onClick={(e) => {
                      e.preventDefault();
                      setPage(p);
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.min(totalPages, p + 1));
                }}
                className={cn(currentPage === totalPages && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
