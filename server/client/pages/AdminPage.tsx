import { Navigate } from "react-router";
import { Loader2, MonitorSmartphone, ShieldAlert, UserPlus, Users } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { LoadFailure } from "../components/LoadFailure";
import { SectionedPage, type PageSection } from "../components/SectionedPage";
import { PolicySection } from "./admin/PolicySection";
import { SessionsSection } from "./admin/SessionsSection";
import { UsersSection } from "./admin/UsersSection";

/** Server-level settings: who may join, who is who, and where everyone is signed in. */
export function AdminPage() {
  const { account, loading, error, retry } = useAuth();
  if (loading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  // A failed lookup is not a confirmed guest: bouncing to the sign-in screen would hide a server that is simply down
  if (error) return <LoadFailure message={error.message} onRetry={() => void retry()} />;
  if (!account) return <Navigate to="/login" replace />;
  if (account.role !== "admin") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <ShieldAlert size={16} className="text-amber-400" />
          This area is for admins.
        </p>
      </div>
    );
  }

  const sections: PageSection[] = [
    {
      id: "registration",
      label: "Registration",
      icon: <UserPlus size={16} />,
      description: "With this off, accounts come from you; reading stays open to everyone either way.",
      render: () => <PolicySection />,
    },
    {
      id: "users",
      label: "Accounts",
      icon: <Users size={16} />,
      description: "Changing a role or suspending an account signs it out everywhere.",
      render: () => <UsersSection myId={account.id} />,
    },
    {
      id: "sessions",
      label: "Sessions",
      icon: <MonitorSmartphone size={16} />,
      description: "Every browser signed in to this server right now.",
      render: () => <SessionsSection />,
    },
  ];

  return (
    <SectionedPage
      heading="Server"
      subheading="Settings for the whole server, its accounts and its sessions."
      basePath="/admin"
      sections={sections}
    />
  );
}
