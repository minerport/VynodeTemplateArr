# Posters parity registry

This registry is the implementation checklist for the complete poster subsystem. A row is only marked complete after its controls, helper text, validation, persisted state, backend action, loading/error/empty states, and destructive-action safeguards have been exercised.

## Global navigation and state

- [x] Poster Overlays and Collection Posters routes and tabs
- [ ] Responsive layout, keyboard navigation, focus restoration, and accessible dialogs
- [ ] Loading, empty, partial-failure, offline, and permission-denied states
- [x] Grid-size preference and hide-inactive preference persistence
- [x] Job polling without duplicate runs; safe cancellation and background continuation

## Overlay sources

- [x] Initial source-selection prompt and later Change source action
- [ ] Plex base posters: download on selection, per-library and overall progress, failures, cancellation, background continuation
- [ ] Plex re-download: clean-poster warning and exact `I HAVE CLEAN POSTERS` confirmation
- [ ] Plex change detection on later runs
- [x] Local posters: folder convention, supported extensions, TMDB fallback, mounted-path validation
- [x] Local utility: generate folder structure, progress, safe existing-file preservation, and failure reporting
- [x] Local utility: populate from Plex, progress, safe existing-file preservation, and failure reporting
- [x] TMDB posters: popular-poster behavior and language relationship
- [x] Source save failures, retry, and current-source indicator

## Overlay template library

- [x] Templates/Libraries sub-navigation
- [x] Create template and preset starting points
- [x] Import overlay ZIP with file picker, validation, conflicts, safe extraction, and result summary
- [x] Template cards: preview, name, description, type, condition, tags, and enabled state
- [ ] Edit, duplicate, copy overlay elements, export ZIP, and guarded delete (all except ZIP export implemented)
- [x] Grid density control and hide-inactive filtering
- [x] Full overlay sync; queued/running/complete/error/cancelled states
- [x] Source settings, reset posters, and test-item entry points

## Overlay editor

- [x] Name, description, tags, automatic type, enabled state, preview poster, and refresh/cycle
- [x] 1000×1500 canvas, zoom, pan, selection, drag, resize, snap guides, undo/redo
- [x] Layer add/duplicate/delete/show/hide/lock/reorder controls
- [ ] Text: value, font family/file, size, weight, style, color, opacity, alignment, stroke, shadow, rotation, position, dimensions (all except font upload, stroke, and shadow implemented)
- [ ] Variable text: segmented literal/variable content, date formats, fallbacks, grouped variables (segments and date formats implemented)
- [x] Tile: fill, border, individual/locked corner radii, opacity, sizing and position
- [ ] Raster image: upload/asset selection, fit, opacity, rotation, sizing and position
- [ ] SVG: built-in/custom asset, fill/stroke, grayscale, opacity, rotation, sizing and position (path, grayscale, opacity, and geometry implemented)
- [ ] Mapped icon: source variable, default icon, value-to-icon mappings, add/edit/remove mapping (source, mappings, layout, sizing, spacing, limits, and grid columns implemented)
- [ ] Application conditions: AND/OR sections, add/remove section and rule, operators, typed values, tags, labels, collections (full field list and typed boolean/numeric/media/resolution/live-collection inputs implemented; connected tag/label discovery pending)
- [x] Preview selection with other overlays and saved layer render order
- [ ] Validation, unsaved-changes warning, save, cancel, import/export fidelity

## Overlay libraries

- [x] Movie/show library cards with item count, enabled overlay count, status and last run
- [x] Apply overlays per library, progress details, safe stop, retry, and error details
- [x] Library configuration dialog and close/back behavior
- [x] Enable/disable templates and accessible ordering; top overlay renders above lower overlays
- [x] Per-template hide/show in combined preview without changing saved enablement
- [x] Combined preview and cycle sample poster
- [x] TMDB language control only for TMDB source
- [x] Maintainerr connection-aware season option, real nested collection/media payload adapter with legacy fallback, exact scheduled-action calculation, `daysUntilAction` diagnostics, cache invalidation, isolated movie/show/season application, scheduled/library/item execution, and real Plex apply/read-back/reset validation
- [x] Persist library configuration
- [x] Reset all posters to base versions with irreversible warning and source-aware behavior
- [x] Test-item Plex search, selection, match results, actual values, renderer context, back-to-search, and single-item refresh

## Collection poster templates

- [x] Templates/Saved Posters tabs and explanatory text
- [x] Create, edit, duplicate, set default, and guarded delete
- [x] Import template ZIP with file picker, validation, conflicts, safe extraction, and result summary
- [x] Template cards: preview, name, description, default marker, and updated data
- [x] Prevent deletion of the active default and explain its fallback responsibility

## Collection poster editor

- [ ] Name, description, default state, 1000×1500 canvas, zoom, snap, and undo/redo (name, description, canvas, snap, and design undo/redo implemented; zoom and metadata undo remain)
- [x] Background: color, linear/radial gradient, intensity, and source colors
- [ ] Text: content, typography, color, alignment, stroke, shadow, rotation and geometry
- [ ] Image: upload/asset, crop/fit, opacity, rotation and geometry (validated durable JPEG/PNG/WebP upload, stored selection, preview, rotation, and geometry implemented; crop/fit/opacity remain)
- [ ] SVG/icon selection: search, category, color, opacity, rotation and geometry (validated durable SVG upload, active-content blocking, stored selection, preview, grayscale, rotation, and geometry implemented; catalog search/category/color/opacity remain)
- [ ] Content grid: source, rows/columns, gaps, padding, item image/text options
- [ ] Layer selection, add, duplicate, delete, show/hide, lock, and reorder (selection, all five add types, delete, and raise/lower ordering implemented)
- [x] Live preview, server validation, unsaved-changes warning, save and cancel

## Saved collection posters and collection form integration

- [x] Saved poster cards and generated preview
- [ ] Edit metadata, duplicate, download/export, and guarded delete (edit, duplicate, and guarded deletion implemented; binary download/export pending)
- [x] Single and bulk in-use dialogs naming affected collections
- [x] Collection form upload: file picker, JPEG/PNG/WebP and 10 MB validation, preview, replace/remove
- [x] Collection form selection popover: saved poster selection, upload, and link to poster creation
- [x] Source-color JSON import/export with schema/version, provider-name, collision, count, and exact-color validation
- [ ] Poster assignment persistence, fallback, sync preview, and regeneration consequences (assignment persistence, copy preservation, forced-delete cleanup, template fallback and needs-sync state implemented; rendered Plex sync preview/regeneration still pending)

## Backend and production adapters

- [x] Overlay settings, templates, mappings, tests, library configs and job routes
- [x] Poster templates, saved posters and collection-poster validated CRUD routes
- [x] Durable poster-editor asset index and opaque byte storage, multipart upload, authenticated serving, MIME/signature validation, SVG sanitization, concurrent-write serialization, and design-reference validation
- [x] Atomic database persistence and migrations
- [ ] Base-poster storage, cache, download, change detection and reset
- [x] Local folder service and mounted-path security
- [x] Overlay context builder, preset variables, mappings and condition evaluation
- [x] Renderer output parity for all currently exposed overlay and collection-poster layer types
- [ ] Season/episode policies, release-date policy, Maintainerr and Sonarr context
- [x] Plex upload/refresh and per-item failure recovery
- [x] Import schema versioning, bounded archive validation, and safe asset extraction
- [x] Logs, terminal metrics, job recovery, restart recovery and bounded concurrency
