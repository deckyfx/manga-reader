import { Navigate, NavLink, useParams } from "react-router";

/** One entry of a sectioned page: a menu item plus the pane it opens. */
export interface PageSection {
  /** URL segment, e.g. "passkeys" in /user/passkeys. */
  id: string;
  /** Menu label. */
  label: string;
  icon: React.ReactNode;
  /** Pane heading; defaults to the label. */
  title?: string;
  description?: string;
  render: () => React.ReactNode;
}

/**
 * A settings-style page: a menu down the side (a strip across the top on narrow screens) and a full-width pane.
 * Each section has its own URL, so a pane can be linked to, reloaded and stepped back out of.
 */
export function SectionedPage({
  heading,
  subheading,
  basePath,
  sections,
}: {
  heading: string;
  subheading?: string;
  /** Path the sections sit under, without a trailing slash, e.g. "/user". */
  basePath: string;
  sections: PageSection[];
}) {
  const { section } = useParams();
  if (sections.length === 0) return null;
  const current = sections.find((entry) => entry.id === section);
  // No section, or one this account can't see: land on the first it can, rather than showing an empty pane
  if (!current) return <Navigate to={`${basePath}/${sections[0].id}`} replace />;

  return (
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      <nav
        aria-label={heading}
        className="shrink-0 border-b border-gray-800 bg-gray-900 p-3 md:w-60 md:overflow-y-auto md:border-r md:border-b-0"
      >
        <div className="hidden px-2 pb-3 md:block">
          <h1 className="text-sm font-semibold text-gray-100">{heading}</h1>
          {subheading && <p className="mt-1 text-xs text-gray-400">{subheading}</p>}
        </div>
        <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-x-visible">
          {sections.map((entry) => (
            <li key={entry.id} className="shrink-0 md:shrink">
              <NavLink
                to={`${basePath}/${entry.id}`}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                    isActive ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-50"
                  }`
                }
              >
                <span className="shrink-0">{entry.icon}</span>
                {entry.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-5 p-6">
          <header>
            <h2 className="text-lg font-semibold text-gray-100">{current.title ?? current.label}</h2>
            {current.description && <p className="mt-1 text-sm text-gray-400">{current.description}</p>}
          </header>
          {current.render()}
        </div>
      </div>
    </div>
  );
}
