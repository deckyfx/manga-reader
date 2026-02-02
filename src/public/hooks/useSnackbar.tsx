import { useState, useCallback } from "react";
import { Snackbar, type SnackbarType } from "../components/Snackbar";

interface SnackbarState {
  message: string;
  type: SnackbarType;
  visible: boolean;
}

/**
 * Hook for managing snackbar notifications
 */
export function useSnackbar() {
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    message: "",
    type: "info",
    visible: false,
  });

  const showSnackbar = useCallback(
    (message: string, type: SnackbarType = "info") => {
      setSnackbar({ message, type, visible: true });
    },
    []
  );

  const hideSnackbar = useCallback(() => {
    setSnackbar((prev) => ({ ...prev, visible: false }));
  }, []);

  const SnackbarComponent = snackbar.visible ? (
    <Snackbar
      message={snackbar.message}
      type={snackbar.type}
      onClose={hideSnackbar}
    />
  ) : null;

  return {
    showSnackbar,
    hideSnackbar,
    SnackbarComponent,
  };
}
