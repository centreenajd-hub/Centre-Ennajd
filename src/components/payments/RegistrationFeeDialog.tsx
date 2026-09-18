// Pencil dialog for the one-time registration fee (رسوم التسجيل — 100 DH),
// tracked COMPLETELY separately from the Rule A/B installment engine. Lets
// the admin edit the due amount (exemption/discount), land the remaining on
// any partial value, and attach a free-text note. The form seeds from the
// EFFECTIVE remaining (0 for legacy students with no stored fee), so a
// note-only save can never accidentally flip a legacy student to unpaid.
// Store action: updateRegistrationFee (clamps paid to [0, due]).

import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
  REGISTRATION_FEE_DEFAULT,
  getRegistrationFeeRemaining,
} from "@/lib/ennajd-billing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Student } from "@/types/ennajd";

interface RegistrationFeeDialogProps {
  student: Student;
  /** Button size — matches the surrounding row actions. */
  size?: "sm" | "icon";
  /** Trigger tooltip — defaults to the edit title; the wallet's paid line
   *  passes the legacy hint instead (manual entry point for legacy students). */
  tooltip?: string;
}

export function RegistrationFeeDialog({
  student,
  size = "icon",
  tooltip,
}: RegistrationFeeDialogProps) {
  const { t } = useI18n();
  const updateRegistrationFee = useEnnajdState(
    (s) => s.updateRegistrationFee,
  );

  const [open, setOpen] = useState(false);
  const [dueText, setDueText] = useState("");
  const [remainingText, setRemainingText] = useState("");
  const [noteText, setNoteText] = useState("");

  const fee = student.registrationFee;
  // Legacy students (no stored fee) are paid by default → effective
  // remaining 0, due 100. This is what the form seeds from.
  const effectiveDue = fee?.amountDue ?? REGISTRATION_FEE_DEFAULT;
  const effectiveRemaining = getRegistrationFeeRemaining(student);

  const due = Number(dueText);
  const remaining = Number(remainingText);
  const validDue = dueText !== "" && Number.isFinite(due) && due >= 0;
  const validRemaining =
    remainingText !== "" && Number.isFinite(remaining) && remaining >= 0;

  // Clamped target — the store double-clamps, so the saved value can never
  // exceed the due amount (e.g. lowering due below paid auto-settles).
  const clampedRemaining = validDue && validRemaining
    ? Math.max(0, Math.min(due, remaining))
    : 0;

  const dueChanged = validDue && Math.round(due) !== effectiveDue;
  const remainingChanged =
    validRemaining && Math.round(clampedRemaining) !== effectiveRemaining;
  const noteChanged =
    (noteText.trim() || "") !== ((fee?.note ?? "").trim() || "");
  const canSubmit = validDue && validRemaining && (dueChanged || remainingChanged || noteChanged);

  // (Re)seed the form on every open — remaining defaults to the EFFECTIVE
  // remaining (0 for legacy), note to the stored fee note.
  useEffect(() => {
    if (open) {
      setDueText(String(effectiveDue));
      setRemainingText(String(effectiveRemaining));
      setNoteText(fee?.note ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit() {
    if (!canSubmit) return;
    updateRegistrationFee(student.id, {
      amountDue: Math.round(due),
      amountPaid: Math.round(due - clampedRemaining),
      note: noteText,
    });
    toast.success(
      clampedRemaining <= 0
        ? t("registrationFeeSettledToast")
        : t("registrationFeeUpdatedToast"),
    );
    setOpen(false);
  }

  /** Quick chips: settle (→ 0) or a 50 DH partial — both clamped to due. */
  function applyRemaining(value: number) {
    if (!validDue) return;
    setRemainingText(String(Math.max(0, Math.min(due, value))));
  }

  const triggerTooltip = tooltip ?? t("registrationFeeEditTitle");

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
          title={triggerTooltip}
          aria-label={triggerTooltip}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            {t("registrationFeeEditTitle")}
          </DialogTitle>
          <DialogDescription>
            {student.firstName} {student.lastName} · {student.level}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current state summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                {t("registrationFeeRemainingLabel")}
              </p>
              <p className="mt-1 text-sm font-bold text-destructive">
                {effectiveRemaining} MAD
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                {t("registrationFeeAmountDue")}
              </p>
              <p className="mt-1 text-sm font-bold text-accent-foreground">
                {effectiveDue} MAD
              </p>
            </div>
          </div>

          {/* Amount due (exemption/discount) */}
          <div className="space-y-2">
            <Label htmlFor="fee-due" className="text-sm">
              {t("registrationFeeAmountDue")}
            </Label>
            <Input
              id="fee-due"
              type="number"
              inputMode="numeric"
              min={0}
              step={10}
              className="rounded-lg"
              value={dueText}
              onChange={(e) => setDueText(e.target.value)}
            />
          </div>

          {/* New remaining (partial payments) */}
          <div className="space-y-2">
            <Label htmlFor="fee-remaining" className="text-sm">
              {t("registrationFeeNewRemaining")}
            </Label>
            <Input
              id="fee-remaining"
              type="number"
              inputMode="numeric"
              min={0}
              max={validDue ? due : undefined}
              step={10}
              className="rounded-lg"
              value={remainingText}
              onChange={(e) => setRemainingText(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
                onClick={() => applyRemaining(0)}
              >
                {t("registrationFeeSettle")} → 0
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
                onClick={() => applyRemaining(50)}
              >
                50
              </Button>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="fee-note" className="text-sm">
              {t("registrationFeeNoteLabel")}
            </Label>
            <Textarea
              id="fee-note"
              className="min-h-[70px] rounded-lg"
              placeholder={t("registrationFeeNotePlaceholder")}
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
