import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { SubjectEnrollmentPicker } from "@/components/students/SubjectEnrollmentPicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { REGISTRATION_FEE_DEFAULT, computeTuitionTotal } from "@/lib/ennajd-billing";
import {
  LEVELS,
  isGroupTypeApplicable,
  isTrackRequired,
} from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type {
  Level,
  RegistrationFee,
  Student,
  SubjectEnrollment,
  Track,
} from "@/types/ennajd";

interface StudentFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: Student | null;
}

interface FormState {
  fullName: string;
  whatsappPhone: string;
  parentPhone: string;
  level: Level;
  track: Track | null;
  enrollments: SubjectEnrollment[];
  /** Create mode only — "paid the 100 DH registration fee at registration". */
  feePaidAtRegistration: boolean;
  /** Create mode only — tuition paid at creation (MAD as string for input). */
  tuitionPaidText: string;
}

const emptyForm: FormState = {
  fullName: "",
  whatsappPhone: "",
  parentPhone: "",
  level: "T.C",
  track: null,
  enrollments: [],
  feePaidAtRegistration: false,
  tuitionPaidText: "",
};

function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

export function StudentFormSheet({
  open,
  onOpenChange,
  student,
}: StudentFormSheetProps) {
  const { t } = useI18n();
  const addStudent = useEnnajdState((s) => s.addStudent);
  const updateStudent = useEnnajdState((s) => s.updateStudent);
  const applyInitialTuitionPayment = useEnnajdState(
    (s) => s.applyInitialTuitionPayment,
  );
  const prices = useEnnajdState((s) => s.prices);
  const [form, setForm] = useState<FormState>(emptyForm);

  // Tuition card computations (create mode only, when enrollments exist)
  const tuitionTotal = useMemo(() => {
    if (!form.enrollments.length) return 0;
    return computeTuitionTotal(form.enrollments, form.level, prices);
  }, [form.enrollments, form.level, prices]);

  const tuitionPaid = useMemo(() => {
    const val = Number(form.tuitionPaidText);
    if (!Number.isFinite(val)) return 0;
    return Math.max(0, Math.min(Math.round(val), tuitionTotal));
  }, [form.tuitionPaidText, tuitionTotal]);

  const tuitionRemaining = useMemo(() => {
    return Math.max(0, tuitionTotal - tuitionPaid);
  }, [tuitionTotal, tuitionPaid]);

  // Per-subject breakdown for the collapsible section
  const subjectBreakdown = useMemo(() => {
    if (!form.enrollments.length) return [];
    return form.enrollments.map((e) => {
      const custom = e.customPrice;
      if (custom !== undefined) return { subject: e.subject, price: custom };
      const base = prices.find(
        (p) =>
          p.level === form.level &&
          p.subject === e.subject &&
          p.track === e.track &&
          p.groupType === e.groupType,
      )?.price;
      return { subject: e.subject, price: base ?? 0 };
    });
  }, [form.enrollments, form.level, prices]);

  useEffect(() => {
    if (student) {
      setForm({
        fullName: `${student.firstName} ${student.lastName}`.trim(),
        whatsappPhone: student.whatsappPhone,
        parentPhone: student.parentPhone,
        level: student.level,
        track: student.track,
        enrollments: student.enrollments,
        feePaidAtRegistration: false,
        tuitionPaidText: "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [student, open]);

  const trackRequired = isTrackRequired(form.level);
  // Registration fee checkbox: create mode only, and only when the picked
  // enrollments include ≥1 non-Small (Rule A standard) class. Small-only
  // students are exempt — no fee field is stored for them at all.
  const showFeeCheckbox =
    !student &&
    form.enrollments.some((e) => e.groupType !== "Small");

  function handleLevelChange(level: Level) {
    setForm((f) => ({
      ...f,
      level,
      track: null,
      enrollments: [],
    }));
  }

  function handleTrackChange(track: Track) {
    setForm((f) => ({ ...f, track, enrollments: [] }));
  }

  async function handleSubmit(e: React.FormEvent) {
      e.preventDefault();
      const { firstName, lastName } = splitFullName(form.fullName);
      if (!firstName || !lastName) {
        toast.error(t("required"));
        return;
      }
      if (trackRequired && !form.track) {
        toast.error(t("required"));
        return;
      }
      const missingGroupType = form.enrollments.some(
        (enrollment) =>
          isGroupTypeApplicable(form.level, enrollment.subject) && !enrollment.groupType,
      );
      if (missingGroupType) {
        toast.error(t("invalidCombination"));
        return;
      }
  
      // New students owe the 100 DH registration fee unless it was paid at
      // registration (checkbox) or the student is Small-group-only (exempt —
      // no fee field stored). Legacy/existing students keep their stored fee;
      // edit mode never rewrites it (managed in the wallet instead).
      let registrationFee: RegistrationFee | undefined;
      if (!student && showFeeCheckbox) {
        registrationFee = form.feePaidAtRegistration
          ? {
              amountDue: REGISTRATION_FEE_DEFAULT,
              amountPaid: REGISTRATION_FEE_DEFAULT,
              settledAt: new Date().toISOString(),
            }
          : {
              amountDue: REGISTRATION_FEE_DEFAULT,
              amountPaid: 0,
            };
      }
  
      const payload = {
        firstName,
        lastName,
        whatsappPhone: form.whatsappPhone.trim(),
        parentPhone: form.parentPhone.trim(),
        level: form.level,
        track: trackRequired ? form.track : null,
        enrollments: form.enrollments,
        ...(registrationFee ? { registrationFee } : {}),
      };
  
      if (student) {
        // Await the write: payments.student_id is an FK to this row, and the
        // sheet must stay open when the write is rejected.
        const ok = await updateStudent(student.id, payload);
        if (!ok) return;
        toast.success(t("studentSaved"));
        onOpenChange(false);
      } else {
        // Await the student row BEFORE distributing tuition — payments.student_id
        // is an FK to it, so the insert must land first.
        const newStudent = await addStudent(payload);
        if (!newStudent) return;
        // After student creation, distribute any tuition Paid across generated installments.
        // Only in create mode (!student) and when there are enrollments.
        if (form.enrollments.length > 0 && tuitionTotal > 0 && tuitionPaid > 0) {
          try {
            await applyInitialTuitionPayment(newStudent.id, tuitionPaid, new Date());
            toast.success(t("initialTuitionPaymentRecorded"));
          } catch (err) {
            toast.error(t("paymentSaveFailed"));
            // Stay open on failure; the local snapshot was already reverted in the store.
            return;
          }
        }
        toast.success(t("studentSaved"));
        onOpenChange(false);
      }
    }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{student ? t("editStudent") : t("addStudent")}</SheetTitle>
          <SheetDescription>{t("subjectsAndSessions")}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5 pb-6">
          <div className="space-y-1.5">
            <Label>{t("fullName")}</Label>
            <Input
              className="rounded-lg"
              value={form.fullName}
              placeholder={t("fullNamePlaceholder")}
              onChange={(e) =>
                setForm((f) => ({ ...f, fullName: e.target.value }))
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("whatsappPhone")}</Label>
              <Input
                type="tel"
                className="rounded-lg"
                value={form.whatsappPhone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, whatsappPhone: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("parentPhone")}</Label>
              <Input
                type="tel"
                className="rounded-lg"
                value={form.parentPhone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, parentPhone: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("level")}</Label>
              <Select value={form.level} onValueChange={handleLevelChange}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>
                      {lvl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {trackRequired && (
              <div className="space-y-1.5">
                <Label>{t("track")}</Label>
                <Select
                  value={form.track ?? undefined}
                  onValueChange={handleTrackChange}
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue placeholder={t("selectTrack")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="s.x">s.x</SelectItem>
                    <SelectItem value="s.m">s.m</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">
              {t("subjectsAndSessions")}
            </Label>
            <SubjectEnrollmentPicker
              level={form.level}
              track={form.track}
              enrollments={form.enrollments}
              onChange={(enrollments) =>
                setForm((f) => ({ ...f, enrollments }))
              }
            />
          </div>

          {/* Create mode only — hide in edit mode (wallet/pencil handles tuition there) */}
          {!student && form.enrollments.length > 0 && (
            <div className="space-y-2">
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">{t("tuitionCardTitle")}</h3>
                  <span className="text-xs text-muted-foreground">
                    {t("tuitionTotalLabel")}
                  </span>
                </div>

                {/* Total + Paid row */}
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t("tuitionTotalLabel")}</Label>
                    <div className="text-lg font-bold">
                      {tuitionTotal} MAD
                      {tuitionTotal === 0 && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({t("noPriceDefined")})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full max-w-[220px] flex-col gap-1.5 sm:flex-row">
                    <Input
                      type="number"
                      min={0}
                      max={tuitionTotal}
                      step={1}
                      placeholder={t("tuitionPaidPlaceholder")}
                      value={form.tuitionPaidText}
                      disabled={tuitionTotal === 0}
                      onChange={(e) => {
                        const value = e.target.value;
                        const num = Number(value);
                        if (value === "" || Number.isFinite(num)) {
                          setForm((f) => ({ ...f, tuitionPaidText: value }));
                        }
                      }}
                      aria-label={t("tuitionPaidLabel")}
                      aria-describedby="tuition-paid-hint"
                    />
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            tuitionPaidText: String(
                              Math.min(
                                tuitionTotal,
                                Math.max(0, Math.round(Number(f.tuitionPaidText || 0)) + 100),
                              ),
                            ),
                          }))
                        }
                      >
                        +100
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            tuitionPaidText: String(
                              Math.min(
                                tuitionTotal,
                                Math.max(0, Math.round(Number(f.tuitionPaidText || 0)) + 200),
                              ),
                            ),
                          }))
                        }
                      >
                        +200
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 flex-1"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            tuitionPaidText: String(
                              Math.min(
                                tuitionTotal,
                                Math.max(0, Math.round(Number(f.tuitionPaidText || 0)) + 500),
                              ),
                            ),
                          }))
                        }
                      >
                        +500
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Remaining (calculated) */}
                <div className="mt-3 flex items-center justify-between rounded-lg bg-background/60 px-3 py-2">
                  <span className="text-sm font-medium" aria-label={t("tuitionRemainingWillBe")}>
                    {t("tuitionRemainingWillBe")}
                  </span>
                  <span
                    className={`text-lg font-bold ${
                      tuitionRemaining > 0 ? "text-accent-foreground" : "text-success"
                    }`}
                    aria-label={t("remainingAmount")}
                  >
                    {tuitionRemaining} MAD
                  </span>
                </div>

                {/* Validation message */}
                {(form.tuitionPaidText !== "" && tuitionPaid > tuitionTotal) && (
                  <p className="mt-2 text-sm text-destructive" id="tuition-paid-hint">
                    {t("tuitionPaidExceedsTotal")}
                  </p>
                )}
                {form.tuitionPaidText !== "" &&
                  !Number.isFinite(Number(form.tuitionPaidText)) && (
                    <p className="mt-2 text-sm text-destructive" id="tuition-paid-hint">
                      {t("invalidTuitionPaid")}
                    </p>
                  )}

                {/* Per-subject breakdown (collapsible) */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    {t("tuitionPerSubjectBreakdown")}
                  </summary>
                  <div className="mt-2 space-y-1 text-sm">
                    {subjectBreakdown.map((item) => (
                      <div key={item.subject} className="flex items-center justify-between">
                        <span>{item.subject}</span>
                        <span className="font-medium">{item.price} MAD</span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )}

          {showFeeCheckbox && (
            <div className="space-y-1.5 rounded-xl border border-border bg-muted/40 p-3">
              <label
                htmlFor="fee-paid-at-registration"
                className="flex cursor-pointer items-start gap-2.5"
              >
                <Checkbox
                  id="fee-paid-at-registration"
                  className="mt-0.5"
                  checked={form.feePaidAtRegistration}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({
                      ...f,
                      feePaidAtRegistration: checked === true,
                    }))
                  }
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">
                    {t("registrationFeePaidAtRegistration")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("registrationFeeCollectHint")}
                  </span>
                </span>
              </label>
            </div>
          )}

          <SheetFooter className="gap-2 sm:justify-start">
            <Button type="submit" className="rounded-lg">
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}