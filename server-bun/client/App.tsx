import { BrowserRouter, Navigate, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { StudioPagesPage } from "./pages/StudioPagesPage";
import { StudioPageEditor } from "./pages/StudioPageEditor";
import { ReadPage } from "./pages/ReadPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/studio" replace />} />
            <Route path="studio" element={<StudioPagesPage />} />
            <Route path="studio/pages/:id" element={<StudioPageEditor />} />
            <Route path="read" element={<ReadPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
