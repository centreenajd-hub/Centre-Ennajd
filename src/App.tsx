import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/auth/AuthGate";
import { useAuthUser } from "@/lib/auth-client";
import NotFound from "./pages/NotFound";
import LoginPage from "./pages/auth/LoginPage";

import "./globals.css";

// Admin-only page stays lazy (rarely visited) — it keeps its own
// Suspense boundary below.
const SeedDemoData = lazy(() => import("./pages/admin/SeedDemoData"));

const queryClient = new QueryClient();

// Code-split the large page bundles so navigating only parses/executes that
// page's JS instead of the single eagerly-loaded bundle. NotFound stays eager
// (small, always needed).
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Students = lazy(() => import("./pages/Students"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Messages = lazy(() => import("./pages/Messages"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Payments = lazy(() => import("./pages/Payments"));
const Reports = lazy(() => import("./pages/Reports"));

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function LoginRoute() {
  const { user, loading } = useAuthUser();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route element={<AuthGate />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/students" element={<Students />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/payments" element={<Payments />} />
                <Route path="/reports" element={<Reports />} />
                <Route
                  path="/admin/seed"
                  element={
                    <Suspense fallback={<PageLoader />}>
                      <SeedDemoData />
                    </Suspense>
                  }
                />
              </Route>
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
