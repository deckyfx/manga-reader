import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { BookOpen, Layers, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";

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
        <NavItem to="/studio" icon={<Layers size={20} />} label="Studio" expanded={expanded} />
        <NavItem to="/read" icon={<BookOpen size={20} />} label="Read" expanded={expanded} />
        <div className="mt-auto">
          <NavItem to="/settings" icon={<Settings size={20} />} label="Settings" expanded={expanded} />
        </div>
      </nav>

      <div className="flex-1 min-w-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
