/** A bordered block inside a settings section, for sections that hold more than one thing. */
export function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
      {description && <p className="mt-1 text-xs text-gray-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
