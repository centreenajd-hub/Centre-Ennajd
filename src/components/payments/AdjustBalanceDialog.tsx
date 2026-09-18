// Pencil dialog — lets the admin land the student+subject's DUE remaining on
// a custom target (e.g. "he owes 50 MAD, not 200") and/or attach a free-text
// payment note at the student+subject level. Only already-due installments
// (dueDate <= today, Reste guard) are ever adjusted; future auto-generated
// rows stay untouched. Store actions: adjustStudentSubjectBalance +
// setSubjectPaymentNote.

import { Minus, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKey, getPaymentRemaining } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Student, Subject } from "@/types/ennajd";

interface AdjustBalanceDialogProps {
  student: Student;
  subject: Subject;
  /** Button size — matches the surrounding row actions. */
  size?: "sm" | "icon";
}

const QUICK_DELTAS = [-100, -50, 50];

export function AdjustBalanceDialog({
  student,
  subject,
  size = "icon",
}: AdjustBalanceDialogProps) {
  const { t } = useI18n();
  const payments = useEnnajdState((s) => s.payments);
  const adjustStudentSubjectBalance = useEnnajdState(
    (s) => s.adjustStudentSubjectBalance,
  );
  const setSubjectPaymentNote = useEnnajdState((s) => s.setSubjectPaymentNote);

  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [noteText, setNoteText] = useState("");

  const todayKey = formatDateKey(new Date());
  const enrollmentNote =
    student.enrollments.find((e) => e.subject === subject)?.paymentNote ?? "";

  // Due installments (Reste guard): only these can be adjusted.
  const due = useMemo(
    () =>
      payments
        .filter(
          (p) =>
            p.studentId === student.id &&
            p.subject === subject &&
            p.dueDate <= todayKey,
        )
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [payments, student.id, subject, todayKey],
  );

  // App-wide "remaining" semantics: unpaid = neither isPaid flag nor
  // amountPaid covering amountDue (matches getPaymentRemaining consumers).
  const isSettled = (p: (typeof due)[number]) =>
    p.isPaid || (p.amountPaid ?? 0) >= p.amountDue;

  const currentRemaining = due.reduce(
    (sum, p) => sum + (isSettled(p) ? 0 : getPaymentRemaining(p)),
    0,
  );
  const totalDueAmounts = due.reduce((sum, p) => sum + p.amountDue, 0);
  const hasDue = due.length > 0;

  const amount = Number(amountText);
  const isValidAmount =
    amountText !== "" && Number.isFinite(amount) && amount >= 0;
  // Validation: a target may never exceed the Σ due installment amounts.
  const exceedsDue = isValidAmount && amount > totalDueAmounts;

  const amountChanged =
    isValidAmount && hasDue && Math.round(amount) !== currentRemaining;
  const noteChanged = (noteText.trim() || "") !== (enrollmentNote.trim() || "");
  // Note-only mode: when nothing is due the amount input is locked at 0,
  // so only the note can make the save button meaningful.
  const canSubmit =
    !exceedsDue && isValidAmount && (amountChanged || noteChanged);

  // (Re)seed the form on every open — amount defaults to the current
  // remaining, note to whatever is already on the enrollment.
  useEffect(() => {
    if (open) {
      setAmountText(hasDue ? String(currentRemaining) : "0");
      setNoteText(enrollmentNote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit() {
    if (!canSubmit) return;
    if (hasDue) {
      adjustStudentSubjectBalance(
        student.id,
        subject,
        Math.round(amount),
        new Date(),
      );
    }
    if (noteChanged) {
      setSubjectPaymentNote(student.id, subject, noteText);
    }
    toast.success(t("balanceNoteUpdated"));
    setOpen(false);
  }

  function applyDelta(delta: number) {
    const base = Number(amountText);
    const current = Number.isFinite(base) && amountText !== "" ? base : 0;
    const next = Math.max(0, Math.min(totalDueAmounts, current + delta));
    setAmountText(String(next));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          className={cn(
            size === "icon"
              ? "h-8 w-8 rounded-lg text-muted-foreground hover:text-primary"
              : "rounded-lg",
          )}
          onClick={(e) => e.stopPropagation()}
          title={t("adjustBalanceTrigger")}
          aria-label={t("adjustBalanceTrigger")}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            {t("adjustBalanceTitle")}
          </DialogTitle>
          <DialogDescription>
            {student.firstName} {student.lastName} · {subject}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current remaining summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                {t("currentRemaining")}
              </p>
              <p className="mt-1 text-sm font-bold text-accent-foreground">
                {currentRemaining} MAD
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                {t("installments")}
              </p>
              <p className="mt-1 text-sm font-bold">{due.length}</p>
            </div>
          </div>

          {/* New remaining target */}
          <div className="space-y-2">
            <Label htmlFor="adjust-remaining" className="text-sm">
              {t("newRemainingLabel")}
            </Label>
            <Input
              id="adjust-remaining"
              type="number"
              inputMode="numeric"
              min={0}
              max={hasDue ? totalDueAmounts : 0}
              step={1}
              disabled={!hasDue}
              className="rounded-lg"
              placeholder={t("newRemainingPlaceholder")}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {hasDue ? t("adjustBalanceHint") : t("nothingDueNoteOnly")}
            </p>
            {hasDue && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t("quickDelta")} :
                </span>
                {QUICK_DELTAS.map((delta) => (
                  <Button
                    key={delta}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-xs"
                    onClick={() => applyDelta(delta)}
                  >
                    {delta < 0 ? (
                      <Minus className="me-0.5 h-3 w-3" />
                    ) : (
                      <Plus className="me-0.5 h-3 w-3" />
                    )}
                    {Math.abs(delta)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Validation */}
          {exceedsDue && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              {t("targetExceedsDue")}
            </p>
          )}
          {amountText !== "" && !isValidAmount && hasDue && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              {t("invalidAdjustAmount")}
            </p>
          )}

          {/* Payment note */}
          <div className="space-y-2">
            <Label htmlFor="payment-note" className="text-sm">
              {t("paymentNoteLabel")}
            </Label>
            <Textarea
              id="payment-note"
              className="min-h-[70px] rounded-lg"
              placeholder={t("paymentNotePlaceholder")}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            className="rounded-lg"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            <Pencil className="me-1.5 h-4 w-4" />
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
