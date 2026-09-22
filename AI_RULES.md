# Tech Stack

- You are building a React application.
- Use TypeScript.
- Use React Router. KEEP the routes in src/App.tsx
- Always put source code in the src folder.
- Put pages into src/pages/
- Put components into src/components/
- The main page (default page, route "/") is src/pages/Dashboard.tsx, rendered inside src/components/layout/AppShell.tsx (sidebar + topbar wrapper).
- UPDATE the relevant page to include new components. OTHERWISE, the user can NOT see any components!
- ALWAYS try to use the shadcn/ui library.
- Tailwind CSS: always use Tailwind CSS for styling components. Utilize Tailwind classes extensively for layout, spacing, colors, and other design aspects.

# Centre Ennajd ERP — Project Conventions

- Single source of truth: `src/hooks/use-ennajd-state.ts` (Zustand, backed by Supabase — see below). All students/sessions/prices reads and writes go through this store — never re-derive state elsewhere.
- Supabase: `src/lib/supabase.ts` (client init), `src/lib/auth-client.ts` (email/password sign-in), `src/lib/dbServices.ts` (CRUD/subscriptions), `src/lib/ennajd-firestore-sync.ts` (`useFirestoreSync()` hydrates the store in real time via Supabase realtime channels). Authentication is currently disabled — all routes are publicly accessible.
- SQL Schema: `supabase/schema.sql` contains the complete table definitions with RLS policies.
- Domain types: `src/types/ennajd.ts` for app types, `src/types/supabase.ts` for database row types.
- Business/routing rules (Level → Track → Subject → GroupType matrix): `src/lib/ennajd-taxonomy.ts`. This is pure data/functions with zero React/Zustand imports — always read rules from here instead of re-deriving them inline (e.g. `getSubjectsFor`, `isGroupTypeApplicable`, `isTrackRequired`).
- Bilingual FR/AR + RTL: `src/lib/i18n.ts` (`useI18n()` hook, `t()` calls). Toggle via `LanguageToggle`.
- Theme colors (teal primary, amber accent, `success` token) are centralized in `src/globals.css` CSS variables — never hardcode colors in components.

Available packages and libraries:

- The lucide-react package is installed for icons.
- You ALREADY have ALL the shadcn/ui components and their dependencies installed. So you don't need to install them again.
- You have ALL the necessary Radix UI components installed.
- Use prebuilt components from the shadcn/ui library after importing them. Note that these files shouldn't be edited, so make new components if you need to change them.

# Supabase Integration Notes

- Environment: Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`.
- Offline: Supabase does not have native offline persistence like Firebase. Real-time subscriptions require an active connection.
- Batch operations: Supabase supports array upsert operations, but we chunk at 450 items for safety.
- RLS: Row Level Security is enabled on all tables. All authenticated users have full read/write access.