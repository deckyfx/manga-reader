import { Navigate } from "react-router";
import { KeyRound, Loader2, MonitorSmartphone, ScanText, Shield, TerminalSquare, UserRound } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { LoadFailure } from "../components/LoadFailure";
import { SectionedPage, type PageSection } from "../components/SectionedPage";
import { ApiKeySection } from "./user/ApiKeySection";
import { PasskeySection } from "./user/PasskeySection";
import { ProfileSection } from "./user/ProfileSection";
import { ScansSection } from "./user/ScansSection";
import { SecuritySection } from "./user/SecuritySection";
import { SessionSection } from "./user/SessionSection";

/** Your own account: who you are, what guards it, the keys your tools use, and where you're signed in. */
export function UserPage() {
  const { account, loading, error, retry } = useAuth();
  if (loading) return <Loader2 className="m-4 animate-spin text-gray-500" />;
  // A failed lookup is not a confirmed guest: bouncing to the sign-in screen would hide a server that is simply down
  if (error) return <LoadFailure message={error.message} onRetry={() => void retry()} />;
  if (!account) return <Navigate to="/login" replace />;

  // Readers have no tools to sign in, so those two sections aren't theirs to see
  const usesTools = account.role !== "reader";
  const sections: PageSection[] = [
    {
      id: "profile",
      label: "Profile",
      icon: <UserRound size={16} />,
      title: account.display_name ?? account.username,
      description: "Your account, as this server has it. An admin changes these.",
      render: () => <ProfileSection account={account} />,
    },
    {
      id: "security",
      label: "Security",
      icon: <Shield size={16} />,
      description: "Your password, and the authenticator apps that back it up.",
      render: () => <SecuritySection />,
    },
    ...(usesTools
      ? [{
        id: "passkeys",
        label: "Passkeys",
        icon: <KeyRound size={16} />,
        description: "A fingerprint, face or security key, confirming your password rather than replacing it.",
        render: () => <PasskeySection canUse />,
      }, {
        id: "api-keys",
        label: "API keys",
        icon: <TerminalSquare size={16} />,
        description: "What the browser extension and the desktop app sign in with. OCR refuses to run without one.",
        render: () => <ApiKeySection canUse />,
      }, {
        id: "scans",
        label: "Scans",
        icon: <ScanText size={16} />,
        title: "Your scans",
        description: "Every region you've scanned through this server, and what came back.",
        render: () => <ScansSection userId={account.id} />,
      }] satisfies PageSection[]
      : []),
    {
      id: "sessions",
      label: "Sessions",
      icon: <MonitorSmartphone size={16} />,
      title: "Where you're signed in",
      description: "Sign out anything you don't recognise.",
      render: () => <SessionSection />,
    },
  ];

  return (
    <SectionedPage
      heading={account.display_name ?? account.username}
      subheading={`Signed in as ${account.username}`}
      basePath="/user"
      sections={sections}
    />
  );
}
