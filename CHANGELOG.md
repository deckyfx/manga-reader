# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.4]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.4
[0.0.3]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.3
[0.0.2]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.2
[0.0.1]: https://github.com/deckyfx/manga-reader/releases/tag/v0.0.1
