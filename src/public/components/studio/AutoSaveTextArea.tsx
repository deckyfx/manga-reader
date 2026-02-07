import React, { useState, useEffect, useRef } from "react";
import { useDebounce } from "../../hooks/useDebounce";
import type { SaveStatus } from "./SaveStatusIcon";
import SaveStatusIcon from "./SaveStatusIcon";

interface AutoSaveTextAreaProps {
  /** Unique key to reset internal state when caption changes */
  captionId: string;
  /** Label shown above the textarea */
  label: string;
  /** Initial/external value */
  value: string;
  /** Called with the new text when debounce fires. Return true on success. */
  onSave: (text: string) => Promise<boolean>;
  /** Called whenever local text changes (for parent to read current value) */
  onLocalChange?: (text: string) => void;
  /** Optional action button config (Re-Extract, Retranslate) */
  action?: {
    label: string;
    isLoading: boolean;
    onClick: () => void;
    className?: string;
  };
  /** Extra className for the textarea */
  textareaClassName?: string;
  /** Number of rows */
  rows?: number;
}

/**
 * AutoSaveTextArea — Self-contained textarea with debounced auto-save
 * and save status indicator (pencil → spinner → checkmark → gone).
 *
 * Manages its own local state, debounce timer, save lifecycle, and
 * cleanup. Parent only provides the save callback and initial value.
 */
export function AutoSaveTextArea({
  captionId,
  label,
  value,
  onSave,
  onLocalChange,
  action,
  textareaClassName,
  rows = 3,
}: AutoSaveTextAreaProps) {
  const [localText, setLocalText] = useState(value);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedValueRef = useRef(value);

  // Sync when caption changes or external value updates
  useEffect(() => {
    setLocalText(value);
    savedValueRef.current = value;
    setSaveStatus("idle");
  }, [captionId, value]);

  // Track editing state
  const debouncedText = useDebounce(localText, 500);
  useEffect(() => {
    if (localText !== debouncedText) {
      setSaveStatus("editing");
    }
  }, [localText, debouncedText]);

  // Auto-save when debounce fires
  useEffect(() => {
    if (debouncedText === savedValueRef.current) return;
    setSaveStatus("saving");
    onSave(debouncedText).then((success) => {
      if (success) {
        savedValueRef.current = debouncedText;
        setSaveStatus("saved");
        clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 500);
      } else {
        setSaveStatus("idle");
      }
    });
  }, [debouncedText]);

  // Cleanup timer
  useEffect(() => {
    return () => clearTimeout(savedTimerRef.current);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setLocalText(newText);
    onLocalChange?.(newText);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
          {label}
          <SaveStatusIcon status={saveStatus} />
        </label>
        {action && (
          <button
            onClick={action.onClick}
            disabled={action.isLoading}
            className={action.className ?? "text-xs px-2 py-0.5 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 rounded transition-colors"}
          >
            {action.isLoading ? (
              <i className="fas fa-spinner fa-spin" />
            ) : (
              <><i className="fas fa-redo" /> {action.label}</>
            )}
          </button>
        )}
      </div>
      <textarea
        value={localText}
        onChange={handleChange}
        className={textareaClassName ?? "w-full px-2 py-1 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"}
        rows={rows}
      />
    </div>
  );
}