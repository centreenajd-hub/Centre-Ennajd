import { type FormEvent, useState } from "react";
import { Loader2, Lock, LogIn, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function getErrorMessage(code: string, lang: "fr" | "ar"): string {
  const messages: Record<string, { fr: string; ar: string }> = {
    "auth/invalid-credential": {
      fr: "Email ou mot de passe incorrect.",
      ar: "البريد الإلكتروني أو كلمة السر غير صحيحة.",
    },
    "auth/invalid-email": {
      fr: "Adresse email invalide.",
      ar: "البريد الإلكتروني غير صالح.",
    },
    "auth/too-many-requests": {
      fr: "Trop de tentatives. Réessayez plus tard.",
      ar: "محاولات كثيرة جداً. حاول مرة أخرى بعد قليل.",
    },
    "auth/user-disabled": {
      fr: "Ce compte est désactivé.",
      ar: "هذا الحساب معطّل.",
    },
  };
  return (
    messages[code]?.[lang] ??
    (lang === "ar"
      ? "حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى."
      : "Une erreur est survenue lors de la connexion. Réessayez.")
  );
}

export default function LoginPage() {
  const { lang } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAr = lang === "ar";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
      setError(getErrorMessage(code, lang));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.12),_transparent_60%)] p-4">
      <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-lg shadow-primary/5">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <img
              src="https://i.postimg.cc/3JX2NjHn/logo-png.png"
              alt="Centre Ennajd"
              className="h-16 w-auto rounded-2xl object-contain shadow-sm"
              loading="eager"
              decoding="async"
            />
            <div>
              <h1 className="text-lg font-bold text-foreground">
                {isAr ? "مركز النجد" : "Centre Ennajd"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isAr ? "تسجيل دخول الطاقم" : "Connexion de l'équipe"}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{isAr ? "البريد الإلكتروني" : "Email"}</Label>
              <div className="relative">
                <Mail className={cn("absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground", isAr ? "right-3" : "left-3")} />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn("rounded-xl", isAr ? "pr-9" : "pl-9")}
                  placeholder={isAr ? "example@ennajd.com" : "exemple@ennajd.com"}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{isAr ? "كلمة السر" : "Mot de passe"}</Label>
              <div className="relative">
                <Lock className={cn("absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground", isAr ? "right-3" : "left-3")} />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn("rounded-xl", isAr ? "pr-9" : "pl-9")}
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="mt-1 gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {loading
                ? isAr
                  ? "جاري التسجيل..."
                  : "Connexion..."
                : isAr
                  ? "تسجيل الدخول"
                  : "Se connecter"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
