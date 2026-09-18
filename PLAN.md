# Centre Ennajd ERP — Implementation Plan

## Completed Tasks

### 1. Add applyInitialTuitionPayment to use-ennajd-state.ts (waterfall distribution across subjects)
- **Status**: ✅ Done
- **Details**: Implemented `applyInitialTuitionPayment` in `src/hooks/use-ennajd-state.ts` that distributes tuition payments across subjects using a waterfall algorithm (earliest due date first, then subject locale).

### 2. Fix recordPartialPayment, adjustStudentSubjectBalance, setPaymentPaid to await + rollback + error toast
- **Status**: ✅ Done
- **Details**: All three functions now properly `await` their database operations, capture previous state for rollback, and show error toasts on failure.

### 3. Harden updatePaymentsBatchDoc and setPaymentPaidDoc in dbServices.ts (explicit update / onConflict, error propagation)
- **Status**: ✅ Done
- **Details**: `updatePaymentsBatchDoc` uses explicit per-row `update(...).eq("id", id)` instead of upsert to prevent partial row insertion. `setPaymentPaidDoc` uses explicit update with `as never` cast for type safety. Both propagate errors via `assertNoError`.

### 4. Add tuition card (create-only) to StudentFormSheet with Paid input, quick buttons, validation, async handleSubmit
- **Status**: ✅ Done
- **Details**: StudentFormSheet includes a tuition card with:
  - Total tuition display
  - Paid input field with validation
  - Quick buttons (+100, +200, +500 MAD)
  - Remaining amount display
  - Error messages for exceeding total or invalid input
  - Async handleSubmit that applies initial tuition payment after student creation

### 5. Align StudentTable settlementByStudent to use isPaymentFullyPaid consistently
- **Status**: ✅ Done
- **Details**: `settlementByStudent` in StudentTable.tsx now uses `isPaymentFullyPaid(payment)` consistently for determining unpaid installments, matching the logic in `aggregateOverdueInstallments` and `getDueBalanceForStudentSubject`.

### 6. Run type checks and verify build
- **Status**: ✅ Done
- **Details**: TypeScript type checks pass with zero errors. Production build succeeds (33681 ms, 2935 modules transformed).

### 7. Update plan file to mark progress
- **Status**: ✅ Done
- **Details**: This PLAN.md file has been created/updated to track all completed tasks.

## Tech Stack
- React + TypeScript + Vite
- React Router
- Zustand (state management, backed by Supabase)
- Supabase (database, real-time subscriptions)
- Tailwind CSS + shadcn/ui components
- Bilingual FR/AR with RTL support

## Key Files
- `src/hooks/use-ennajd-state.ts` — Single source of truth (Zustand store)
- `src/lib/dbServices.ts` — Database CRUD operations
- `src/lib/ennajd-billing.ts` — Billing logic (tuition, payments, settlement)
- `src/lib/ennajd-taxonomy.ts` — Business rules (Level → Track → Subject → GroupType)
- `src/lib/i18n.ts` — Bilingual FR/AR translation hook
- `src/components/students/StudentFormSheet.tsx` — Student creation/edit form with tuition card
- `src/components/students/StudentTable.tsx` — Student list with settlement badges
