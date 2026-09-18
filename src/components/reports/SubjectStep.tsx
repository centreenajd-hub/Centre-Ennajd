import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Subject } from "@/types/ennajd";

interface SubjectStepProps {
  subjects: Subject[];
  value: Subject | null;
  onChange: (subject: Subject) => void;
}

export function SubjectStep({ subjects, value, onChange }: SubjectStepProps) {
  const { t } = useI18n();

  if (subjects.length === 0) return null;

  return (
    <div className="animate-in fade-in slide-in-from-top-1 space-y-2 duration-300">
      <p className="text-sm font-semibold text-foreground">{t("chooseSubject")}</p>
      <div className="flex flex-wrap gap-2">
        {subjects.map((subject) => (
          <button
            key={subject}
            type="button"
            onClick={() => onChange(subject)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              value === subject
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            {subject}
          </button>
        ))}
      </div>
    </div>
  );
}