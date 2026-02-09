import { useState, useEffect } from "react";

/**
 * UnsavedChangesConfirmation - Modal dialog for confirming navigation with unsaved changes
 *
 * Features:
 * - Manages own state (open/closed)
 * - Modal overlay with backdrop
 * - Confirm and Cancel buttons
 * - Callback-based API
 */
interface UnsavedChangesConfirmationProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UnsavedChangesConfirmation({
  isOpen,
  onConfirm,
  onCancel,
}: UnsavedChangesConfirmationProps) {
  // Handle ESC key to cancel
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 border border-gray-700 rounded-lg shadow-2xl max-w-md w-full mx-4 p-6">
        {/* Icon */}
        <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-yellow-500/20">
          <i className="fa-solid fa-triangle-exclamation text-2xl text-yellow-500"></i>
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-white text-center mb-2">
          Unsaved Changes
        </h2>

        {/* Message */}
        <p className="text-gray-300 text-center mb-6">
          You have unsaved mask changes. Unsaved data will be lost. Do you want
          to continue?
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded bg-gray-700 text-white hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage unsaved changes confirmation state
 *
 * @example
 * const confirmation = useUnsavedChangesConfirmation();
 *
 * // When navigation is triggered:
 * if (hasUnsavedChanges) {
 *   confirmation.show((confirmed) => {
 *     if (confirmed) {
 *       // Proceed with navigation
 *     }
 *   });
 * }
 *
 * // Render component:
 * <UnsavedChangesConfirmation {...confirmation.props} />
 */
export function useUnsavedChangesConfirmation() {
  const [isOpen, setIsOpen] = useState(false);
  const [onResolve, setOnResolve] = useState<
    ((confirmed: boolean) => void) | null
  >(null);

  const show = (callback: (confirmed: boolean) => void) => {
    setIsOpen(true);
    setOnResolve(() => callback);
  };

  const handleConfirm = () => {
    setIsOpen(false);
    onResolve?.(true);
    setOnResolve(null);
  };

  const handleCancel = () => {
    setIsOpen(false);
    onResolve?.(false);
    setOnResolve(null);
  };

  return {
    show,
    props: {
      isOpen,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
  };
}
