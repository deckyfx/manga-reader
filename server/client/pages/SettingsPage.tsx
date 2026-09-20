import { Activity, Boxes, Languages } from "lucide-react";
import { SectionedPage, type PageSection } from "../components/SectionedPage";
import { HealthSection } from "./settings/HealthSection";
import { ModelsSection } from "./settings/ModelsSection";
import { TranslationSection } from "./settings/TranslationSection";

const SECTIONS: PageSection[] = [
  {
    id: "health",
    label: "Health",
    icon: <Activity size={16} />,
    title: "Server health",
    description: "What has finished loading, and what this server is running.",
    render: () => <HealthSection />,
  },
  {
    id: "models",
    label: "Models",
    icon: <Boxes size={16} />,
    description: "The model each stage of the pipeline loads.",
    render: () => <ModelsSection />,
  },
  {
    id: "translation",
    label: "Translation",
    icon: <Languages size={16} />,
    description: "Which engine translates, and which one cleans text off the page.",
    render: () => <TranslationSection />,
  },
];

/** How this server is configured. It's read-only: the values come from the environment it started with. */
export function SettingsPage() {
  return (
    <SectionedPage
      heading="Settings"
      subheading="How this server is set up."
      basePath="/settings"
      sections={SECTIONS}
    />
  );
}
