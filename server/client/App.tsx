import { BrowserRouter, Navigate, Routes, Route, useParams } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { StudioPagesPage } from "./pages/StudioPagesPage";
import { StudioPageEditor } from "./pages/StudioPageEditor";
import { ReadPage } from "./pages/ReadPage";
import { SeriesPage } from "./pages/SeriesPage";
import { ReaderPage } from "./pages/ReaderPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="home" element={<HomePage />} />
            <Route path="studio" element={<StudioPagesPage />} />
            <Route path="studio/pages/:id" element={<StudioPageEditorRoute />} />
            <Route path="read" element={<ReadPage />} />
            <Route path="read/series/:id" element={<SeriesPage />} />
            <Route path="read/chapters/:id/pages/:n" element={<ReaderPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  );
}

/**
 * The page editor keyed by page id: moving to another page mounts a fresh editor, so nothing queued or pending for the
 * previous page (debounced saves, canvas history, placement) can act on the new one.
 */
function StudioPageEditorRoute() {
  const { id = "" } = useParams();
  return <StudioPageEditor key={id} />;
}
