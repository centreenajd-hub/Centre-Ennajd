import { Loader2 } from "lucide-react";
import { Outlet } from "react-router-dom";

import { useAuthUser } from "@/lib/auth-client";
import LoginPage from "@/pages/auth/LoginPage";

export function AuthGate() {
  const { user, loading } = useAuthUser();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <Outlet />;
}
