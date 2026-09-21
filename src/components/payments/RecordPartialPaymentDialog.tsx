// Partial-payment ("pen") dialog — lets staff record an amount a person
// actually handed over (installment / advance) without settling the whole
// installment. The credit accumulates on the earliest due installment of
// this student+subject (dueDate ascending) and any surplus rolls over to
// the next one — all handled atomically by the store's
// `recordPartialPayment`.

import { Banknote, Plus } from "lucide-react";
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
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { formatDateKey } from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Student, Subject } from "@/types/ennajd";

interface RecordPartialPaymentDialogProps {
  student: Student;
  subject: Subject;
  /** Visually disable the pen when nothing is due for this student+subject. */
  disabled?: boolean;
  /** Button size — matches the surrounding row actions. */
  size?: "sm" | "icon";
}

const QUICK_AMOUNTS = [100, 200, 500];

export function RecordPartialPaymentDialog({
  student,
  subject,
  disabled,
  size = "icon",
}: RecordPartialPaymentDialogProps) {
  const { t } = useI18n();
  const payments = useEnnajdState((s) => s.payments);
  const recordPartialPayment = useEnnajdState((s) => s.recordPartialPayment);

  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  // When the entered amount exceeds the total remaining, we ask for an
  // explicit confirmation before committing (surplus rolls to next
  // installment). Confirmed once per open.
  const [exceedsConfirmed, setExceedsConfirmed] = useState(false);

  const todayKey = formatDateKey(new Date());

  // Same "due" definition as the rest of the app: unpaid, dueDate <= today,
  // and a real remaining gap (credit that already covers the month means
  // nothing is there to collect).
  const due = useMemo(() => {
    return payments
      .filter(
        (p) =>
          p.studentId === student.id &&
          p.subject === subject &&
          !p.isPaid &&
          p.dueDate <= todayKey &&
          getPaymentRemaining(p) > 0,
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [payments, student.id, subject, todayKey]);

  const first = due[0];
  const dueCount = due.length;
  const totalRemaining = due.reduce(
    (sum, p) => sum + Math.max(0, p.amountDue - (p.amountPaid ?? 0)),
    0,
  );
  const firstPreviouslyPaid = first?.amountPaid ?? 0;
  const firstRemaining = first
    ? Math.max(0, first.amountDue - firstPreviouslyPaid)
    : 0;

  const amount = Number(amountText);
  const isValidAmount = amount > 0 && Number.isFinite(amount);
  const exceedsRemaining = isValidAmount && amount > totalRemaining;
  const blockedByExceeds = exceedsRemaining && !exceedsConfirmed;
  const canSubmit = isValidAmount && !blockedByExceeds;
  // Surplus = amount paid beyond current-month dues (carries to next month).
  const carryOver =
    isValidAmount && amount > totalRemaining
      ? Math.round(amount - totalRemaining)
      : 0;

  // Reset the input + confirmation state on every (re)open.
  useEffect(() => {
    if (open) {
      setAmountText("");
      setExceedsConfirmed(false);
    }
  }, [open]);

  function handleSubmit() {
    if (!canSubmit) return;
    recordPartialPayment(student.id, subject, Math.round(amount), new Date());
    toast.success(t("partialPaymentRecorded"));
    setOpen(false);
  }

  const buttonIsDisabled = !!disabled || !first;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          className={cn(
            size === "icon"
              ? "h-8 w-8 rounded-lg text-accent-foreground"
              : "rounded-lg",
          )}
          disabled={buttonIsDisabled}
          onClick={(e) => e.stopPropagation()}
          title={t("partialPayment")}
          aria-label={t("partialPayment")}
        >
          <Banknote className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-accent-foreground" />
            {t("partialPaymentTitle")}
          </DialogTitle>
          <DialogDescription>
            {student.firstName} {student.lastName} · {subject}
            {first ? ` · ${t("dueDate")} ${first.dueDate}` : ""}
          </DialogDescription>
        </DialogHeader>

        {dueCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            {t("partialPaymentNoDue")}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t("partialPaymentHint")}
            </p>

            {/* Earliest due installment summary */}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  {t("installmentAmount")}
                </p>
                <p className="mt-1 text-sm font-bold">
                  {first?.amountDue} MAD
                </p>
              </div>
              <div className="rounded-xl bg-success/10 p-3">
                <p className="text-xs font-medium text-success/80">
                  {t("previouslyPaid")}
                </p>
                <p className="mt-1 text-sm font-bold text-success">
                  {firstPreviouslyPaid} MAD
                </p>
              </div>
              <div className="rounded-xl bg-accent/15 p-3">
                <p className="text-xs font-medium text-accent-foreground/80">
                  {t("remainingForThisInstallment")}
                </p>
                <p className="mt-1 text-sm font-bold text-accent-foreground">
                  {firstRemaining} MAD
                </p>
              </div>
            </div>

            {dueCount > 1 && (
              <div className="flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
                <span className="font-medium text-accent-foreground/90">
                  {t("remainingTotal")} ({dueCount} {t("installments")})
                </span>
                <span className="font-bold text-accent-foreground">
                  {totalRemaining} MAD
                </span>
              </div>
            )}

            {/* Amount input */}
            <div className="space-y-2">
              <Label htmlFor="partial-amount" className="text-sm">
                {t("partialAmountLabel")}
              </Label>
              <Input
                id="partial-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className="rounded-lg"
                placeholder={t("partialAmountPlaceholder")}
                value={amountText}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  setExceedsConfirmed(false);
                }}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t("quickAdd")} :
                </span>
                {QUICK_AMOUNTS.map((quick) => (
                  <Button
                    key={quick}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-xs"
                    onClick={() => {
                      setAmountText(String((Number(amountText) || 0) + quick));
                      setExceedsConfirmed(false);
                    }}
                  >
                    <Plus className="me-0.5 h-3 w-3" />
                    {quick}
                  </Button>
                ))}
              </div>
            </div>

            {/* Validation / exceeds warning */}
            {amountText !== "" && !isValidAmount && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                {t("invalidPartialAmount")}
              </p>
            )}
            {blockedByExceeds && (
              <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5">
                <p className="text-xs font-medium text-accent-foreground">
                  {t("partialPaymentExceeds")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-lg bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={() => setExceedsConfirmed(true)}
                >
                  {t("partialPaymentExceedsConfirm")}
                </Button>
              </div>
            )}

            {/* Carry-over preview — shown when the entered amount exceeds
                current-month dues and confirmation is given. */}
            {carryOver > 0 && exceedsConfirmed && (
              <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5">
                <p className="text-xs font-medium text-success/80">
                  {t("advanceCredit")}
                </p>
                <p className="mt-1 text-sm text-success/90">
                  {t("advanceCreditCarryOver").replace("{amount}", String(carryOver))}
                </p>
              </div>
            )}

            {/* Advance balance already on record — always visible. */}
            {student.advanceBalance > 0 && (
              <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5">
                <p className="text-xs font-medium text-accent-foreground/80">
                  {t("advanceBalanceLabel")}
                </p>
                <p className="mt-1 text-sm font-bold text-accent-foreground">
                  {student.advanceBalance} MAD
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            className="rounded-lg"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            <Banknote className="me-1.5 h-4 w-4" />
            {t("partialPayment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
