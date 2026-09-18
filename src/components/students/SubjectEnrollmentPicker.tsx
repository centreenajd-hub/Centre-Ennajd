import { Badge } from "@/components/ui/badge";
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
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import {
  canSubjectBeSmallGroup,
  getSubjectsFor,
  isCombinedClass,
  isGroupTypeApplicable,
} from "@/lib/ennajd-taxonomy";
import { useI18n } from "@/lib/i18n";
import type {
  GroupType,
  Level,
  Subject,
  SubjectEnrollment,
  Track,
} from "@/types/ennajd";

interface SubjectEnrollmentPickerProps {
  level: Level;
  track: Track | null;
  enrollments: SubjectEnrollment[];
  onChange: (enrollments: SubjectEnrollment[]) => void;
}

export function SubjectEnrollmentPicker({
  level,
  track,
  enrollments,
  onChange,
}: SubjectEnrollmentPickerProps) {
  const { t } = useI18n();
  const getBasePrice = useEnnajdState((s) => s.getBasePrice);

  const subjects = getSubjectsFor(level, track);

  function getEnrollment(subject: Subject) {
    return enrollments.find((e) => e.subject === subject);
  }

  function toggleSubject(subject: Subject, checked: boolean) {
      if (checked) {
        const enrollmentTrack = isCombinedClass(level, subject) ? null : track;
        // Group-type subjects default to Large; on tracks that don't allow
        // Small (S.M) this is the only valid value.
        const groupType = isGroupTypeApplicable(level, subject) ? "Large" : null;
        onChange([
          ...enrollments,
          { subject, track: enrollmentTrack, groupType },
        ]);
      } else {
        onChange(enrollments.filter((e) => e.subject !== subject));
      }
    }

  function updateEnrollment(subject: Subject, patch: Partial<SubjectEnrollment>) {
    onChange(
      enrollments.map((e) => (e.subject === subject ? { ...e, ...patch } : e)),
    );
  }

  if (subjects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("selectTrack")}</p>
    );
  }

  return (
    <div className="space-y-3">
      {subjects.map((subject) => {
        const enrollment = getEnrollment(subject);
        const checked = !!enrollment;
                const groupApplicable = isGroupTypeApplicable(level, subject);
                const smallAllowed = canSubjectBeSmallGroup(level, track, subject);
                const effectiveTrack = isCombinedClass(level, subject) ? null : track;
        const basePrice = enrollment
          ? getBasePrice(level, subject, effectiveTrack, enrollment.groupType)
          : undefined;

        return (
          <div
            key={subject}
            className={`rounded-xl border p-3 transition-colors ${
              checked ? "border-primary/40 bg-primary/5" : "border-border"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Checkbox
                checked={checked}
                onCheckedChange={(v) => toggleSubject(subject, !!v)}
                id={`subject-${subject}`}
              />
              <Label
                htmlFor={`subject-${subject}`}
                className="flex-1 cursor-pointer font-medium"
              >
                {subject}
              </Label>
              {isCombinedClass(level, subject) && (
                <Badge variant="outline" className="rounded-full text-xs">
                  s.x + s.m
                </Badge>
              )}
            </div>

            {checked && (
              <div className="mt-3 grid gap-2.5 ps-6 sm:grid-cols-2">
                {groupApplicable && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t("groupType")}
                    </Label>
                    <Select
                                          value={
                                            enrollment?.groupType ??
                                            (smallAllowed ? undefined : "Large")
                                          }
                                          onValueChange={(v: GroupType) =>
                                            updateEnrollment(subject, { groupType: v })
                                          }
                                        >
                                          <SelectTrigger className="rounded-lg">
                                            <SelectValue placeholder={t("selectGroupType")} />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="Large">{t("large")}</SelectItem>
                                            {smallAllowed && (
                                              <SelectItem value="Small">{t("small")}</SelectItem>
                                            )}
                                          </SelectContent>
                                        </Select>
                  </div>
                )}

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">
                    {t("customPrice")}{" "}
                    {basePrice !== undefined && (
                      <span className="text-muted-foreground/70">
                        ({t("basePrice")}: {basePrice} MAD)
                      </span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    className="rounded-lg"
                    placeholder={basePrice !== undefined ? String(basePrice) : "0"}
                    value={enrollment?.customPrice ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateEnrollment(subject, {
                        customPrice: val === "" ? undefined : Number(val),
                      });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}