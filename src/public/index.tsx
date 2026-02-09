import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { FontTestPage } from "./pages/FontTestPage";
import { SeriesListPage } from "./pages/reader/SeriesListPage";
import { SeriesDetailPage } from "./pages/reader/SeriesDetailPage";
import { ChapterGalleryPage } from "./pages/reader/ChapterGalleryPage";
import { ReaderPage } from "./pages/reader/ReaderPage";
import { FabricStudioPage } from "./components/studio/FabricStudioPage";
import { CreateSeriesPage } from "./pages/admin/CreateSeriesPage";
import { EditSeriesPage } from "./pages/admin/EditSeriesPage";
import { UploadChapterPage } from "./pages/admin/UploadChapterPage";
import { EditChapterPage } from "./pages/admin/EditChapterPage";
import "./global.css";

/**
 * Main Manga Reader App with routing
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Home */}
        <Route path="/" element={<HomePage />} />
        <Route path="/font-test" element={<FontTestPage />} />

        {/* Reader Routes */}
        <Route path="/r" element={<SeriesListPage />} />
        <Route path="/r/:seriesSlug" element={<SeriesDetailPage />} />
        <Route
          path="/r/:seriesSlug/:chapterSlug"
          element={<ChapterGalleryPage />}
        />
        <Route
          path="/r/:seriesSlug/:chapterSlug/:pageNum"
          element={<ReaderPage />}
        />

        {/* Studio Route */}
        <Route path="/studio/:chapterSlug" element={<FabricStudioPage />} />

        {/* Admin Routes */}
        <Route path="/a/create" element={<CreateSeriesPage />} />
        <Route path="/a/series/:seriesSlug/edit" element={<EditSeriesPage />} />
        <Route
          path="/a/series/:seriesSlug/chapter"
          element={<UploadChapterPage />}
        />
        <Route
          path="/a/chapters/:chapterSlug/edit"
          element={<EditChapterPage />}
        />
      </Routes>
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
