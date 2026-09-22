import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SmallGroupInlineEdit } from "@/components/payments/SmallGroupInlineEdit";
import { SmallGroupPaymentHistoryDialog } from "@/components/payments/SmallGroupPaymentHistoryDialog";
import { SmallGroupPeriodsTable } from "@/components/payments/SmallGroupPeriodsTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKey, getDueBalanceForStudentSubject } from "@/lib/ennajd-billing";
import { buildWhatsAppLink } from "@/lib/ennajd-whatsapp";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Student, Subject } from "@/types/ennajd";

function formatDisplayDateShort(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

interface SmallGroupStudentCardProps {
  student: Student;
  subject: Subject;
  todayKey: string;
  searchQuery?: string;
}

export function SmallGroupStudentCard({ student, subject, todayKey }: SmallGroupStudentCardProps) {
  const { t, lang } = useI18n();
  const payments = useEnnajdState((s) => s.payments);
  const setPaymentPaid = useEnnajdState((s) => s.setPaymentPaid);
  const setSmallGroupFirstSessionDate = useEnnajdState((s) => s.setSmallGroupFirstSessionDate);

  const enrollment = useMemo(
    () => student.enrollments.find((e) => e.subject === subject) ?? null,
    [student.enrollments, subject]
  );

  const enrolledAtIso = enrollment?.enrolledAt ?? student.createdAt;

  const balance = useMemo(
    () => getDueBalanceForStudentSubject(payments, student.id, subject, todayKey),
    [payments, student.id, subject, todayKey]
  );

  // PROCHAINE ÉCHÉANCE: earliest due unpaid, else next upcoming, else the
  // student's own first-session date.
  const prochaineIso = balance.earliestDueDate ?? balance.nextUpcoming?.dueDate ?? null;
  const prochaineDisplay = useMemo(() => {
    return formatDisplayDateShort(prochaineIso ?? enrolledAtIso);
  }, [prochaineIso, enrolledAtIso]);

  const isOverdue = balance.isOverdue;
  const isPaidUp = !balance.hasInstallments ? false : balance.dueUnpaid.length === 0 && !isOverdue;
  const canSettle = balance.dueUnpaid.length > 0;
  const canUndo = balance.lastPaidDue !== null;

  const [editing, setEditing] = useState(false);
  const [showPeriods, setShowPeriods] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  function handleWhatsApp() {
    const name = `${student.firstName} ${student.lastName}`;
    const langKey = lang === "ar" ? "whatsappReminderAr" : "whatsappReminderFr";
    const tmpl = t(langKey as never) as unknown as string;
    // Fallbacks if key missing
    const fallback =
      lang === "ar"
        ? `مرحبا ${name}، تذكير: استحقاقك القادم لمادة ${subject} هو ${prochaineDisplay}. — مركز النجد`
        : `Bonjour ${name}, rappel : votre prochaine échéance ${subject} est le ${prochaineDisplay}. — Centre Ennajd`;
    const text = (tmpl && tmpl.includes("{name}") ? tmpl : fallback)
      .replace("{name}", name)
      .replace("{subject}", subject)
      .replace("{date}", prochaineDisplay);
    const link = buildWhatsAppLink(text, student.whatsappPhone);
    window.open(link, "_blank");
  }

  function handleSettle() {
    const first = balance.dueUnpaid[0];
    if (!first) return;
    setPaymentPaid(first.id, true);
    toast.success(t("installmentSettled"));
  }

  function handleUndo() {
    const last = balance.lastPaidDue;
    if (!last) return;
    setPaymentPaid(last.id, false);
    toast.success(t("installmentUnpaid"));
  }

  async function handleSaveEdit(p: { dateIso: string; phone: string }) {
    // Confirm when the first-session day actually moves — the whole rolling
    // schedule re-dates onto the new day-of-month.
    const newKey = formatDateKey(new Date(p.dateIso));
    const oldKey = formatDateKey(new Date(enrolledAtIso));
    if (newKey !== oldKey) {
      const ok = window.confirm(t("confirmDateChange"));
      if (!ok) return;
    }
    const ok = await setSmallGroupFirstSessionDate(
      student.id,
      subject,
      p.dateIso,
      p.phone,
    );
    if (ok) {
      setEditing(false);
      toast.success(t("saveEdit"));
    }
  }

  const topBorderClass = isOverdue
    ? "border-t-destructive"
    : isPaidUp
      ? "border-t-success"
      : "border-t-muted-foreground/30";

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-sm", "border-t-4", topBorderClass)}>
      <div className="space-y-3 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-tight">
              {student.firstName} {student.lastName}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge className="rounded-full bg-primary/10 text-primary" variant="secondary">
                {subject === "Math" ? "Maths" : subject === "PC" ? "Physique" : subject}
              </Badge>
              {student.whatsappPhone && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <span>📞</span> {student.whatsappPhone}
                </span>
              )}
              {isOverdue ? (
                <Badge variant="destructive" className="rounded-full">
                  RETARD
                </Badge>
              ) : isPaidUp && balance.hasInstallments ? (
                <Badge className="rounded-full bg-success text-white">{t("upToDate")}</Badge>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            onClick={() => setEditing((v) => !v)}
            title={t("edit")}
          >
            ✏️
          </Button>
        </div>

        {editing ? (
          <SmallGroupInlineEdit
            initialDateIso={enrolledAtIso}
            initialPhone={student.whatsappPhone}
            onSave={handleSaveEdit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            {/* PROCHAINE ÉCHÉANCE block */}
            <button
              type="button"
              onClick={() => setShowPeriods((v) => !v)}
              className={cn(
                "w-full rounded-xl border px-3 py-3 text-left transition",
                isOverdue
                  ? "border-destructive/20 bg-destructive/5 hover:bg-destructive/10"
                  : isPaidUp
                    ? "border-success/20 bg-success/5 hover:bg-success/10"
                    : "border-border bg-muted/20 hover:bg-muted/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  PROCHAINE ÉCHÉANCE
                </p>
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white",
                    isOverdue ? "bg-destructive" : isPaidUp ? "bg-success" : "bg-muted-foreground",
                  )}
                >
                  {isOverdue ? "!" : isPaidUp ? "✓" : "·"}
                </span>
              </div>
              <p
                className={cn(
                  "mt-1 text-lg font-extrabold tabular-nums",
                  isOverdue ? "text-destructive" : isPaidUp ? "text-success" : "text-foreground",
                )}
              >
                {prochaineDisplay}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">ℹ️ {t("periodsTitle")}</p>
            </button>

            {showPeriods && (
              <SmallGroupPeriodsTable enrolledAt={enrolledAtIso} todayKey={todayKey} monthsToShow={12} />
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleWhatsApp}
            disabled={!student.whatsappPhone}
          >
            {t("sendWhatsApp")}
          </Button>
          <Button
            className="w-full rounded-full bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50"
            onClick={handleSettle}
            disabled={!canSettle}
          >
            {t("updateShipment")} →
          </Button>
          <Button
            variant="outline"
            className="w-full rounded-full"
            onClick={handleUndo}
            disabled={!canUndo}
          >
            ↻ {t("correctCancel")}
          </Button>
          <Button
            variant="ghost"
            className="w-full rounded-full text-muted-foreground"
            onClick={() => setShowHistory(true)}
          >
            📋 {t("paymentHistoryButton")}
          </Button>
        </div>

        {/* Footer */}
        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            📅 {t("firstSessionDate")}: <span className="font-medium text-foreground">{formatDisplayDateShort(enrolledAtIso)}</span>
          </p>
          {enrollment?.paymentNote && (
            <p className="italic text-foreground/70">„{enrollment.paymentNote}“</p>
          )}
          {balance.dueTotal > 0 && (
            <p className="font-semibold text-destructive">
              {t("remainingAmount")}: {balance.dueTotal} MAD · {balance.dueUnpaid.length} {t("installments")}
            </p>
          )}
        </div>
      </div>

      <SmallGroupPaymentHistoryDialog
        open={showHistory}
        onOpenChange={setShowHistory}
        student={student}
        subject={subject}
        todayKey={todayKey}
      />
    </div>
  );
}
