# Capability parity registry

Status values are `discovered`, `specified`, `implemented`, `verified`, and
`exception`. Verification requires fixtures and behavioral comparison with the
legacy implementation.

## Platform

| ID | Capability | Status |
|---|---|---|
| PLAT-001 | Docker deployment and persistent configuration volume | verified |
| PLAT-002 | AMD64 and ARM64 images | implemented |
| PLAT-003 | Initial setup and Plex authentication | verified |
| PLAT-004 | Session and API-key authentication | implemented |
| PLAT-005 | CSRF and reverse-proxy configuration | implemented |
| PLAT-006 | SQLite persistence and migrations | verified |
| PLAT-007 | Logs, machine logs, health, version, and diagnostics | implemented |
| PLAT-008 | Internationalized UI and locale selection | exception |
| PLAT-009 | Service configuration and connectivity testing | implemented |
| PLAT-010 | Configuration import/export and debug archive | verified |

## Collection sources

| ID | Capability | Status |
|---|---|---|
| SRC-001 | Trakt charts, activity, recommendations, watchlists, and custom lists | verified |
| SRC-002 | TMDB trending, popular, rated, discover, random, custom, and franchises | implemented |
| SRC-003 | IMDb charts, people, popular, random, and custom lists | implemented |
| SRC-004 | Letterboxd custom and random lists | implemented |
| SRC-005 | MDBList custom lists | verified |
| SRC-006 | Overseerr global, owner, and per-user sources | implemented |
| SRC-007 | Tautulli popularity and watch statistics | verified |
| SRC-008 | AniList charts and custom lists | implemented |
| SRC-009 | MyAnimeList ranking categories | verified |
| SRC-010 | Plex actors, directors, library content, and existing collections | implemented |
| SRC-011 | Radarr and Sonarr tag sources | implemented |
| SRC-012 | Networks and streaming originals | implemented |
| SRC-013 | Coming Soon monitored, anticipated, and recently added sources | implemented |
| SRC-014 | Filtered recently-added and recently-released hubs | implemented |
| SRC-015 | Multi-source composition and source-specific limits | implemented |

## Collection policies and Plex behavior

| ID | Capability | Status |
|---|---|---|
| COL-001 | Movie, show, season, episode, and mixed identity normalization | exception (movie/show/season/episode implemented and verified; mixed remains post-1.0) |
| COL-002 | Include/exclude genres, keywords, providers, countries, and languages | implemented |
| COL-003 | Year, date, certification, rating, and popularity filters | implemented |
| COL-004 | Position limits, item limits, sorting, reverse, and randomization | implemented |
| COL-005 | Collection mutual exclusion and global title exclusions | implemented |
| COL-006 | Collection templates and title presets | implemented |
| COL-007 | Preview without mutation | implemented |
| COL-008 | Create, update, delete, and adopt Plex collections | verified |
| COL-009 | Default hub and pre-existing collection management | implemented |
| COL-010 | Home, library, and Recommended visibility | implemented |
| COL-011 | Per-user and server-owner targeting | implemented |
| COL-012 | Time-restricted visibility | implemented |
| COL-013 | Manual and randomized ordering | verified |
| COL-014 | Posters, backgrounds, themes, and local artwork | implemented |
| COL-015 | Bulk editing, reordering, and library grouping | implemented |
| COL-016 | Owner-unwatched smart collections and reversible regular conversion | verified |

## Missing media and placeholders

| ID | Capability | Status |
|---|---|---|
| MISS-001 | Missing-item discovery, feed, filtering, and status | implemented |
| MISS-002 | Overseerr movie and television requests | verified |
| MISS-003 | Direct Radarr and Sonarr adds | verified |
| MISS-004 | Profiles, roots, tags, seasons, approval, and request limits | implemented |
| MISS-005 | Download-status and monitored-state awareness | implemented |
| PH-001 | Movie and television placeholder creation | verified |
| PH-002 | Trailer lookup/download and generated media | implemented |
| PH-003 | Marker records and Plex labels | implemented |
| PH-004 | Sonarr-compatible naming and relative-path migration | implemented |
| PH-005 | Real-content detection and cleanup | implemented |
| PH-006 | Direct Plex deletion and scan/trash fallback | implemented |
| PH-007 | TV Season 00/Episode 00 cleanup | implemented |
| PH-008 | Retroactive filters and stale-record self-healing | implemented |

## Posters and overlays

| ID | Capability | Status |
|---|---|---|
| ART-001 | Collection poster template editor | implemented |
| ART-002 | Overlay template editor | implemented |
| ART-003 | Text, variable, image, SVG, icon, raster, tile, and grid layers | implemented |
| ART-004 | Conditional application and mapped icons | implemented |
| ART-005 | Template presets, copying, tags, ordering, and test rendering | implemented |
| ART-006 | Custom fonts, wallpaper, theme audio, and uploaded assets | implemented |
| ART-007 | Base poster capture, hashing, reset, and restoration | implemented |
| ART-008 | IMDb and Rotten Tomatoes ratings | implemented |
| ART-009 | Resolution, HDR, Dolby Vision, audio, and codec variables | implemented |
| ART-010 | Release dates, next episodes, and countdown variables | implemented |
| ART-011 | Plex episode-file scanning and cached aggregation | implemented |
| ART-012 | Maintainerr movie, show, and season deletion countdowns | verified |
| ART-013 | Season poster overlays and cleanup | implemented |
| ART-014 | Local poster folder source | implemented |

## Automation and resilience

| ID | Capability | Status |
|---|---|---|
| JOB-001 | Full and quick collection synchronization | implemented |
| JOB-002 | Full and quick overlay synchronization | implemented |
| JOB-003 | Per-collection schedules | implemented |
| JOB-004 | Plex watchlist synchronization | verified |
| JOB-005 | Plex webhook processing | implemented |
| JOB-006 | Token refresh and randomized home ordering | verified |
| JOB-007 | Live progress, ETA, cancellation, and prior results | implemented |
| JOB-008 | Cache invalidation and adaptive TTLs | exception |
| JOB-009 | WAF/Cloudflare browser solving and plain-HTTP modes | verified |
| JOB-010 | Retry, backoff, fallback, and partial-failure handling | implemented |

## New guarantees

| ID | Capability | Status |
|---|---|---|
| NEW-001 | Previewable immutable change plans | implemented |
| NEW-002 | Idempotent apply with checkpoints and durable resume | implemented |
| NEW-003 | Verification and divergence reporting | implemented |
| NEW-004 | Rollback where supported by target systems | implemented |
| NEW-005 | Encrypted secrets and redacted diagnostics | verified |
| NEW-006 | Role-based permissions and audit history | verified |
| NEW-007 | First-class Plex and Jellyfin target adapters | exception |
| NEW-008 | SQLite and PostgreSQL storage adapters | exception |

## Documented scope decisions

- Notification destinations are not an original-app requirement. The legacy
  source explicitly removed Pushover routes and VAPID/push support as
  unnecessary (`server/routes/index.ts`, `server/lib/settings.ts`). Adding
  notifications later is a new feature and requires a separate security and
  product review.
- Jellyfin and PostgreSQL are Vynode expansion goals, not Agregarr parity
  requirements. They remain release-visible future work until separately
  approved or implemented.
- Vynode 1.0 ships an English UI. Locale-aware provider queries are supported,
  but translation catalogs and a language switcher are post-1.0 product work.
- Vynode 1.0 manages movie, show, manual season, and manual episode collections. Mixed-media
  collection identity remains post-1.0 work. Installation-wide,
  per-collection exact-title, and cross-collection exclusions are enforced
  after provider matching for previews, missing-media routing, and Plex
  synchronization. Seerr supports owner, aggregate non-owner, and exact
  immutable user-ID targeting.
- Cache entries have bounded lifetimes and explicit invalidation. Automatically
  tuning TTLs from provider behavior is a post-1.0 optimization and is not
  presented as a user-facing capability.
- Trakt token refresh and randomized Plex Home placement are implemented.
  Randomized placement registers the managed collection hub when necessary,
  moves it through Plex's hub-management API, and verifies the resulting
  position. Owner-unwatched smart collections use isolated per-collection
  labels, exact label reconciliation, verified smart filters, and reversible
  collision-safe conversion back to regular collections.
