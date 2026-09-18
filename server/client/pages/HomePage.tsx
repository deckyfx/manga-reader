import { Link } from "react-router";
import { BookOpen, FolderCog, Layers } from "lucide-react";

const AREAS = [
  {
    to: "/studio",
    icon: Layers,
    title: "Studio",
    description: "Translate pages, review each stage, fix regions and text, then publish to open browser tabs.",
  },
  {
    to: "/manage",
    icon: FolderCog,
    title: "Manage",
    description: "Build the library: series, volumes, chapters, and the pages inside them.",
  },
  {
    to: "/read",
    icon: BookOpen,
    title: "Read",
    description: "Browse the library by title or tag and read translated chapters.",
  },
] as const;

/** Landing page: `/` redirects here so browsers pick an area instead of hitting a bare route. */
export function HomePage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold">Web OCR</h1>
        <p className="mt-1 text-sm text-gray-400">Where do you want to go?</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AREAS.map(({ to, icon: Icon, title, description }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-5 hover:border-indigo-500 transition-colors"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-800 text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Icon size={20} />
              </span>
              <span className="text-base font-semibold">{title}</span>
              <span className="text-sm text-gray-400">{description}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
