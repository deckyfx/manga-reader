import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { SeriesListPage } from "./pages/reader/SeriesListPage";
import { SeriesDetailPage } from "./pages/reader/SeriesDetailPage";
import { ChapterGalleryPage } from "./pages/reader/ChapterGalleryPage";
import { ReaderPage } from "./pages/reader/ReaderPage";
import { CreateSeriesPage } from "./pages/admin/CreateSeriesPage";
import { EditSeriesPage } from "./pages/admin/EditSeriesPage";
import { UploadChapterPage } from "./pages/admin/UploadChapterPage";
import { EditChapterPage } from "./pages/admin/EditChapterPage";
import "./global.css";

/**
 * Main Comic Reader App with routing
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Home */}
        <Route path="/" element={<HomePage />} />

        {/* Reader Routes */}
        <Route path="/r" element={<SeriesListPage />} />
        <Route path="/r/:seriesId" element={<SeriesDetailPage />} />
        <Route path="/r/:seriesId/:chapterId" element={<ChapterGalleryPage />} />
        <Route path="/r/:seriesId/:chapterId/:pageNum" element={<ReaderPage />} />

        {/* Admin Routes */}
        <Route path="/a/create" element={<CreateSeriesPage />} />
        <Route path="/a/series/:seriesId/edit" element={<EditSeriesPage />} />
        <Route path="/a/series/:seriesId/chapter" element={<UploadChapterPage />} />
        <Route path="/a/chapters/:chapterId/edit" element={<EditChapterPage />} />
      </Routes>
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
