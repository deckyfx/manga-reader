/** A list that couldn't be loaded (or reloaded): say so, rather than showing it empty or out of date. */
export function ListError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <p className="text-sm text-red-400">
      Couldn't load this list: {error.message}{" "}
      <button type="button" onClick={onRetry} className="text-gray-300 underline hover:text-white">Try again</button>
    </p>
  );
}
