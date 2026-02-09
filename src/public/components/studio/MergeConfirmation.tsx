import { useState } from "react";

/**
 * MergeConfirmation - Custom confirmation dialog for merge & save operation
 *
 * Features:
 * - Modal overlay with backdrop
 * - Callback-based API
 * - Hook for easy usage
 */

interface MergeConfirmationProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * MergeConfirmation component
 */
export function MergeConfirmation({
  isOpen,
  onConfirm,
  onCancel,
}: MergeConfirmationProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        {/* Title */}
        <h3 className="text-white text-lg font-semibold mb-3">
          Merge & Save Textboxes
        </h3>

        {/* Message */}
        <p className="text-gray-300 text-sm mb-6">
          This will merge all text objects onto the image and save it. The
          textboxes will be removed from the canvas. This action cannot be
          undone.
        </p>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
          >
            Merge & Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for showing merge confirmation dialog
 */
export function useMergeConfirmation() {
  const [isOpen, setIsOpen] = useState(false);
  const [onConfirmCallback, setOnConfirmCallback] = useState<(() => void) | null>(
    null
  );

  const show = (onConfirm: () => void) => {
    setOnConfirmCallback(() => onConfirm);
    setIsOpen(true);
  };

  const handleConfirm = () => {
    setIsOpen(false);
    if (onConfirmCallback) {
      onConfirmCallback();
    }
    setOnConfirmCallback(null);
  };

  const handleCancel = () => {
    setIsOpen(false);
    setOnConfirmCallback(null);
  };

  return {
    show,
    MergeConfirmationComponent: (
      <MergeConfirmation
        isOpen={isOpen}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ),
  };
}
