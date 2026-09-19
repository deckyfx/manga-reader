import { BrowserRouter, Navigate, Routes, Route, useParams } from "react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { toast, ToastProvider } from "./components/Toast";
import { AuthProvider } from "./auth/AuthProvider";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { StudioPagesPage } from "./pages/StudioPagesPage";
import { StudioPageEditor } from "./pages/StudioPageEditor";
import { ReadPage } from "./pages/ReadPage";
import { ManagePage } from "./pages/ManagePage";
import { ManageSeriesPage } from "./pages/ManageSeriesPage";
import { ManageChapterPage } from "./pages/ManageChapterPage";
import { SeriesPage } from "./pages/SeriesPage";
import { ReaderPage } from "./pages/ReaderPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { RegisterPage } from "./pages/RegisterPage";
import { UserPage } from "./pages/UserPage";
import { AdminPage } from "./pages/AdminPage";

/**
 * A 401 means the session has ended — expired, signed out elsewhere, or the account suspended. Re-asking who we are
 * makes the whole client agree at once: the sidebar drops what it can't open, and the guarded pages redirect.
 */
const onUnauthorised = (error: unknown) => {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  // A wrong password is also a 401. Only somebody who *was* signed in has a session to lose; a guest is told by the
  // form they are looking at.
  const me = queryClient.getQueryData<{ user: unknown } | undefined>(["me"]);
  if (me?.user) toast.info("Your session has ended. Sign in again to carry on.");
  void queryClient.invalidateQueries({ queryKey: ["me"] });
};

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
  // `["me"]` is the question this handler re-asks, so its own failures must not trigger it again
  queryCache: new QueryCache({ onError: (error, query) => { if (query.queryKey[0] !== "me") onUnauthorised(error); } }),
  mutationCache: new MutationCache({ onError: onUnauthorised }),
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
      <ToastProvider>
      <BrowserRouter>
        <AuthProviderWithRouter>
        <Routes>
          {/* Signing in has no sidebar: there is nowhere to go until it is done */}
          <Route path="login" element={<LoginPage />} />
          <Route path="setup" element={<SetupPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="home" element={<HomePage />} />
            <Route path="studio" element={<StudioPagesPage />} />
            <Route path="studio/pages/:id" element={<StudioPageEditorRoute />} />
            <Route path="read" element={<ReadPage />} />
            <Route path="read/series/:id" element={<SeriesPage />} />
            <Route path="read/chapters/:id/pages/:n" element={<ReaderPage />} />
            <Route path="manage" element={<ManagePage />} />
            <Route path="manage/series/:id" element={<ManageSeriesPage />} />
            <Route path="manage/chapters/:id" element={<ManageChapterPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="user" element={<UserPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Routes>
        </AuthProviderWithRouter>
      </BrowserRouter>
      </ToastProvider>
      </ConfirmProvider>
    </QueryClientProvider>
  );
}

/** Inside the router, so a redirect after signing in can use it. */
function AuthProviderWithRouter({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/**
 * The page editor keyed by page id: moving to another page mounts a fresh editor, so nothing queued or pending for the
 * previous page (debounced saves, canvas history, placement) can act on the new one.
 */
function StudioPageEditorRoute() {
  const { id = "" } = useParams();
  return <StudioPageEditor key={id} />;
}
