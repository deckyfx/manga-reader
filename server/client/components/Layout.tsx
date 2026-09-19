import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { BookOpen, FolderCog, Layers, LogIn, LogOut, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { ThemeToggle } from "./ThemeToggle";
import { useToast } from "./Toast";

const STORAGE_KEY = "sidebar-expanded";

/** Sidebar state survives reloads; storage can be unavailable (private mode), so fall back to expanded. */
function readExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function NavItem({ to, icon, label, expanded }: { to: string; icon: React.ReactNode; label: string; expanded: boolean }) {
  return (
    <NavLink
      to={to}
      title={expanded ? undefined : label}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg p-2.5 text-sm transition-colors ${
          isActive ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
        }`
      }
    >
      <span className="shrink-0">{icon}</span>
      {expanded && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

export function Layout() {
  const [expanded, setExpanded] = useState(readExpanded);
  const { account, can, needsSetup, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);

  // An empty server has nothing to show until it has an admin
  if (needsSetup && location.pathname !== "/setup") return <Navigate to="/setup" replace />;
  const toggle = () => {
    setExpanded((prev) => {
      try {
        localStorage.setItem(STORAGE_KEY, String(!prev));
      } catch {
        // Not persisted; the toggle still works for this visit
      }
      return !prev;
    });
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <nav
        className={`flex flex-col gap-1 shrink-0 bg-gray-900 border-r border-gray-800 p-2 transition-[width] duration-150 ${
          expanded ? "w-48" : "w-14"
        }`}
      >
        <div className={`flex items-center mb-2 ${expanded ? "justify-between pl-2" : "justify-center"}`}>
          {expanded && <NavLink to="/home" className="text-sm font-semibold text-gray-300 hover:text-white">Web OCR</NavLink>}
          <button
            onClick={toggle}
            title={expanded ? "Collapse sidebar" : "Expand sidebar"}
            className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800"
          >
            {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>
        {/* Only what this account can actually open: the server refuses the rest anyway */}
        {can("contributor") && <NavItem to="/studio" icon={<Layers size={20} />} label="Studio" expanded={expanded} />}
        {can("contributor") && <NavItem to="/manage" icon={<FolderCog size={20} />} label="Manage" expanded={expanded} />}
        <NavItem to="/read" icon={<BookOpen size={20} />} label="Read" expanded={expanded} />

        <div className="mt-auto space-y-1">
          <ThemeToggle expanded={expanded} />
          {can("admin") && <NavItem to="/admin" icon={<ShieldCheck size={20} />} label="Server" expanded={expanded} />}
          {can("contributor") && <NavItem to="/settings" icon={<Settings size={20} />} label="Settings" expanded={expanded} />}
          {account ? (
            <>
              <NavItem to="/user" icon={<UserRound size={20} />} label={account.display_name ?? account.username} expanded={expanded} />
              <button
                disabled={signingOut}
                onClick={() => {
                  setSigningOut(true);
                  signOut()
                    .then(() => navigate("/read"))
                    .catch((error: unknown) => toast.error(`Couldn't sign out: ${error instanceof Error ? error.message : String(error)}`))
                    .finally(() => setSigningOut(false));
                }}
                title={expanded ? undefined : "Sign out"}
                className="flex w-full items-center gap-3 rounded-lg p-2.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-50"
              >
                <span className="shrink-0"><LogOut size={20} /></span>
                {expanded && <span className="truncate">Sign out</span>}
              </button>
            </>
          ) : (
            <NavItem to="/login" icon={<LogIn size={20} />} label="Sign in" expanded={expanded} />
          )}
        </div>
      </nav>

      <div className="flex-1 min-w-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
