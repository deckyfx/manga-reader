export type SaveStatus = "idle" | "editing" | "saving" | "saved";

/** Save status indicator: pencil → spinner → checkmark → gone */
export default function SaveStatusIcon({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  if (status === "editing") {
    return (
      <i
        className="fas fa-pencil-alt text-yellow-500 text-[10px]"
        title="Editing..."
      />
    );
  }
  if (status === "saving") {
    return (
      <i
        className="fas fa-spinner fa-spin text-blue-500 text-[10px]"
        title="Saving..."
      />
    );
  }
  return (
    <i className="fas fa-check text-green-500 text-[10px]" title="Saved" />
  );
}
