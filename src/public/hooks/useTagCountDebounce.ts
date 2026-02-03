import { useState, useEffect, useRef } from "react";

/**
 * Custom hook to trigger actions based on comma count transitions.
 * Hits server on 0 → 1, 1 → 2, etc.
 * Tracks 1 → 0 to allow the next 0 → 1 to trigger again.
 *
 * @param value - The value to monitor for comma count changes
 * @param delay - Delay in milliseconds (default: 500ms)
 * @returns The active search term (only updates when comma count changes and count > 0)
 *
 * @example
 * ```tsx
 * const [tags, setTags] = useState("");
 * const activeSearchTerm = useTagSearch(tags, 500);
 *
 * useEffect(() => {
 *   // This only runs when comma count changes and there are tags
 *   fetchFilteredResults(activeSearchTerm);
 * }, [activeSearchTerm]);
 * ```
 */
export function useTagSearch(value: string, delay = 500): string {
  // Initialize with the value if it already has content
  const [activeSearchTerm, setActiveSearchTerm] = useState(value);
  const lastCount = useRef((value.match(/,/g) || []).length);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // Skip debounce on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const timer = setTimeout(() => {
      // 1. Calculate how many commas we have now
      const currentCount = (value.match(/,/g) || []).length;

      // 2. Check if the "structure" of the tags changed
      if (currentCount !== lastCount.current) {
        lastCount.current = currentCount;

        // 3. Only update the searchable state if there's actually a tag to search
        // This handles the "track 0 but only hit on > 0" requirement
        if (currentCount > 0 || value.trim().length > 0) {
          setActiveSearchTerm(value);
        } else {
          // If count is 0 and empty, we clear the active search
          setActiveSearchTerm("");
        }
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return activeSearchTerm;
}
