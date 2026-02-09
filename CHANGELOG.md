# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.7] - 2026-02-09

### Added
- **Studio Mode**: Complete overhaul of Editor mode, now called Studio
  - Fabric.js-based canvas for advanced manipulation
  - Auto-detect text regions using YOLOv8 model (ogkalu/manga-text-detector-yolov8s)
  - Text region predictions with automatic selection generation
  - Batch OCR & translation processing for multiple regions
  - Advanced text object patch controls with Fabric.js
  - Cleanup and inpaint capabilities using AnimeLaMa (anime-big-lama model)
  - Professional text editing with real-time preview
  - History controls (undo/redo)
  - Zoom and pan controls for precise editing

### Changed
- **Database Schema**: Regenerated migrations with clean schema
  - Region data now stored as JSON (discriminated union)
  - Simplified caption storage structure
- **Chapter Upload**: Made chapter title optional (defaults to "Chapter {number}")
- **Python Models**: Display loaded models on server startup (OCR, cleaner, predict)
- **Auto Cover Art**: First page automatically promoted as series cover if none exists

### Fixed
- Database schema mismatch (region field vs old x,y,width,height columns)
- OCR batch processing with new region format

### Technical
- Added Fabric.js to tech stack for advanced canvas manipulation
- Consolidated studio2/ components into unified studio/ directory
- Removed ~9K lines of deprecated code from pre-Fabric.js implementation
- Added Python model status monitoring and health checks

### Credits
- [PanelPachi](https://github.com/firecomet/PanelPachi) for the Studio mode inspiration
- YOLOv8 (ogkalu/manga-text-detector-yolov8s) for text region prediction model
- AnimeLaMa (anime-big-lama) for text cleaning and inpainting model

## [0.0.6] - 2026-02-06

### Added
- **Upload Image from URL**: Added ability to upload manga pages directly from URL
- **Polygon Area Tool**: New polygon drawing tool for creating cleaner, irregular-shaped translation patches
  - Supports arbitrary polygon shapes for better text bubble fitting
  - Interactive polygon creation with visual feedback
  - Full customization support (font, colors, stroke)

### Fixed
- **Caption Dialog Workflow**: Fixed caption dialog closing unexpectedly after creating caption, then clicking generate patch, then clicking update
- **Patch Page Reliability**: Fixed issue where patch page feature would sometimes fail immediately after creating patches
  - Changed API to use page slug instead of pageId for better reliability
  - Improved error handling for patch merging operations
- **Image Storage Optimization**: Reduced size of stored cropped images by removing 1.75 device pixel ratio scaling
  - Smaller file sizes without quality loss
  - More efficient storage usages

## [0.0.5] - 2026-02-06

### Added
- New Feature: create translation image patch
- Patch entire page using created patches


## [0.0.4] - 2026-02-05

### Changed
- **Project Rename**: Renamed project from "comic-reader" to "manga-reader"
  - Updated all references, documentation, and configuration
  - Aligned naming with project purpose and repository name

## [0.0.3] - 2026-02-05

### No Changes just house keeping miss-push

## [0.0.2] - 2026-02-05

### Added
- **Sticky Header Component**: Added reusable `StickyHeader` component with gradient background
  - Applied to all pages (Series List, Series Detail, Chapter Gallery, Reader, and all Admin pages)
  - Consistent navigation and actions always visible while scrolling
  - Back links, titles, and action buttons in unified design

- **Caption Management Improvements**:
  - Slug-based caption operations (update and delete)
  - Added `findBySlug`, `updateBySlug`, and `deleteBySlug` methods to CaptionStore
  - Caption slug included in OCR API response for immediate availability

### Fixed
- **Caption Update/Delete Operations**:
  - Fixed API endpoints to use slugs instead of IDs
  - Changed `/captions/:id` to `/captions/:slug` for PUT and DELETE operations
  - Caption updates and deletions now work correctly

- **Edit Mode Interaction**:
  - Disabled rectangle drawing when editing a caption
  - Prevents event clash between drawing new captions and editing existing ones
  - Mouse events now check for active caption before allowing drawing

- **Sticky Header Positioning**:
  - Fixed gallery page header to be truly sticky to viewport
  - Moved StickyHeader outside container divs for proper positioning

- **Navigation**:
  - Updated all cancel buttons to use series slugs instead of IDs
  - Consistent slug-based routing across all pages

### Changed
- **UI/UX Enhancements**:
  - Removed unused caption info panel from reader page
  - Made page navigation buttons more explicit ("Previous Page" / "Next Page")
  - Added visual cues for chapter boundaries (purple buttons with different text)
  - Chapter navigation panel now collapsed by default
  - Edit button moved to sticky header for constant visibility

- **Text Display**:
  - Limited series list to show only first 2 tags with "+X more Tags" indicator
  - Added 50-character truncation for chapter titles in all list views
  - Series titles limited to 1200px width to prevent pushing buttons
  - Added 100-character limit to chapter title form inputs

- **Type Safety**:
  - Removed unused React import (not needed in React 19)
  - Added proper type conversions for null to undefined where needed
  - Fixed type mismatches in series and caption data

- **Docker Images**:
  - Updated docker-compose.yml to use version tags (0.0.2) instead of latest
  - Both app and manga-ocr images now use explicit version tags

### Technical Improvements
- Added comprehensive debug logging for caption operations (later removed for production)
- Improved code organization with reusable components
- Better separation of concerns between components
- Enhanced type safety throughout the application

## [0.0.1] - 2026-01-04

### Added
- Initial release with core manga reading functionality
- OCR text extraction with manga-ocr integration
- DeepL translation integration
- Database persistence with SQLite and Drizzle ORM
- Series management and chapter organization
- Adaptive OCR captions with inline editing
- Server-side series filtering with clickable tags
- Docker containerization with health checks
- Automatic chapter navigation at page boundaries

### Features
- Manga reader with page-by-page navigation
- Real-time OCR text extraction from manga panels
- Automatic translation of extracted text
- Series and chapter management
- Tag-based filtering and search
- Cover art support
- Drag-and-drop page reordering in gallery view
- Edit mode for caption management

[0.0.7]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.7
[0.0.6]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.6
[0.0.5]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.5
[0.0.4]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.4
[0.0.3]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.3
[0.0.2]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.2
[0.0.1]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.1
