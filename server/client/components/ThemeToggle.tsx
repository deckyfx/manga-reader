import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { readTheme, saveTheme, type Theme } from "../lib/theme";

const ORDER: Theme[] = ["system", "light", "dark"];
const LOOK: Record<Theme, { icon: typeof Sun; label: string }> = {
  system: { icon: Monitor, label: "Follow the system" },
  light: { icon: Sun, label: "Day" },
  dark: { icon: Moon, label: "Night" },
};

/** Cycles system → day → night. The choice is remembered per browser. */
export function ThemeToggle({ expanded }: { expanded: boolean }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const { icon: Icon, label } = LOOK[theme];

  const next = () => {
    const following = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? "system";
    setTheme(following);
    saveTheme(following);
  };

  return (
    <button
      onClick={next}
      title={`${label} — click for ${LOOK[ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? "system"].label.toLowerCase()}`}
      aria-label={`Theme: ${label}`}
      className="flex w-full items-center gap-3 rounded-lg p-2.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-100"
    >
      <span className="shrink-0"><Icon size={20} /></span>
      {expanded && <span className="truncate">{label}</span>}
    </button>
  );
}
