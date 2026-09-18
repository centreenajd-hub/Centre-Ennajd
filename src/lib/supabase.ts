// Supabase client initialization for Centre Ennajd ERP.
// This replaces Firebase Firestore + Authentication with Supabase.
// Config values are not secret - real protection comes from RLS policies + Supabase Auth.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Type definitions for user (re-exported from supabase-js)
export type { User } from "@supabase/supabase-js";