import { NavLink, Outlet } from "react-router";
import { BookOpen, Settings, Layers } from "lucide-react";

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar */}
      <nav className="flex flex-col gap-1 w-14 shrink-0 bg-gray-900 border-r border-gray-800 py-3 items-center">
        <NavLink
          to="/studio"
          className={({ isActive }) =>
            `p-2.5 rounded-lg transition-colors ${isActive ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"}`
          }
          title="Studio"
        >
          <Layers size={20} />
        </NavLink>
        <NavLink
          to="/read"
          className={({ isActive }) =>
            `p-2.5 rounded-lg transition-colors ${isActive ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"}`
          }
          title="Read"
        >
          <BookOpen size={20} />
        </NavLink>
        <div className="mt-auto">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `p-2.5 rounded-lg transition-colors ${isActive ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"}`
            }
            title="Settings"
          >
            <Settings size={20} />
          </NavLink>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
