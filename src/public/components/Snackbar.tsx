import { useEffect } from "react";

export type SnackbarType = "success" | "error" | "warning" | "info";

interface SnackbarProps {
  message: string;
  type: SnackbarType;
  onClose: () => void;
  duration?: number;
}

/**
 * Snackbar component for displaying notifications
 */
export function Snackbar({
  message,
  type,
  onClose,
  duration = 4000,
}: SnackbarProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgColors: Record<SnackbarType, string> = {
    success: "bg-green-500",
    error: "bg-red-500",
    warning: "bg-yellow-500",
    info: "bg-blue-500",
  };

  const icons: Record<SnackbarType, string> = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ",
  };

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
      <div
        className={`${bgColors[type]} text-white px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 min-w-[300px] max-w-md`}
      >
        <span className="text-2xl font-bold">{icons[type]}</span>
        <p className="flex-1 text-sm font-medium">{message}</p>
        <button
          onClick={onClose}
          className="text-white hover:text-gray-200 font-bold text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}
