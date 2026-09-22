// Thin wrapper around Supabase Authentication for the Centre Ennajd staff
// login. No public sign-up — accounts are created manually in the Supabase
// console (Authentication → Users → Add user).

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// Map Supabase auth error codes to the Firebase-compatible codes
// that LoginPage.tsx's i18n table already understands.
function mapSupabaseError(
  err: { message?: string; code?: string },
): Error & { code: string } {
  const msg = (err.message ?? "").toLowerCase();
  const code = err.code ?? "";

  // Supabase returns "Invalid login credentials" for wrong email/password
  if (
    msg.includes("invalid") ||
    msg.includes("invalid login") ||
    code === "invalid_credentials"
  ) {
    return Object.assign(new Error(err.message), {
      code: "auth/invalid-credential",
    });
  }
  if (msg.includes("email")) {
    return Object.assign(new Error(err.message), { code: "auth/invalid-email" });
  }
  if (msg.includes("too many") || msg.includes("rate") || msg.includes("429")) {
    return Object.assign(new Error(err.message), { code: "auth/too-many-requests" });
  }
  if (msg.includes("disabled") || msg.includes("banned") || code === "user_banned") {
    return Object.assign(new Error(err.message), { code: "auth/user-disabled" });
  }

  return Object.assign(new Error(err.message), { code: "auth/unknown" });
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw mapSupabaseError(error);
}

export async function signOutUser(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function useAuthUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
