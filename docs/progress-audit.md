# Port progress audit

Production placeholder folders are restricted to mount roots configured with
`VYNODE_MEDIA_ROOTS` (the operating-system path delimiter separates multiple
roots). The example container maps `VYNODE_MEDIA_PATH` on the host to `/media`
and exposes only that path to the placeholder directory browser.

Updated 2026-07-29. This is a capability-weighted estimate, not a percentage
of copied lines. A capability receives:

- 100% when its UI, validation, persistence, external effects, failure states,
  cancellation, tests, and responsive behavior are implemented.
- 50% when the UI/contract and validation are implemented but one or more
  production adapters or external effects remain.
- 0% when it is only inventoried.

## Current estimate

AniList is no longer a UI-only collection source. Its public GraphQL adapter
supports trending, popular, top-rated, and custom user anime lists with bounded
pagination, retry, cancellation, Movie/TV format filtering, and normalized
AniList/MAL/PlexAniBridge/TMDB/TVDB/IMDb identities. Preview, Plex matching,
missing-media routing, synchronization, and scheduled execution now use the
shared production paths. Real five-item trending previews passed for both
Movies and TV Shows against `Laptop`, truthfully reporting that the items are
absent from the intentionally tiny test libraries. Real one-item runs then
added Demon Slayer to the fresh Radarr instance and One Piece to the fresh
Sonarr instance, recorded the missing-media outcomes, and remained
duplicate-safe on rerun. A temporary 15-second Plex Collections Sync schedule
processed all three active configurations with zero failures; the six-hour
schedule was restored and all AniList validation configurations and Arr
records were removed afterward.

Latest verified increment: Maintainerr now uses a real readiness probe, reads
and validates the service's nested collection and media payloads, derives exact
scheduled-action dates, exposes `daysUntilAction` to overlay rendering through
a bounded cache, and enables its library policy only after a verified
connection. A built-in inactive countdown template makes the workflow
discoverable without changing Plex. Radarr/Sonarr tag-source adapters now
validate v3 payloads, filter exact tag membership, and normalize TMDB/TVDB
identity. Direct Radarr/Sonarr execution now performs exact provider lookup,
add, existing-item tag/search, unmonitored-item preservation, monitoring, and
search-on-add payloads with safe credential failures and cancellation.
Trakt, MDBList, and MyAnimeList synchronization now preserve unmatched source
items and route them through a failure-isolated direct missing-media
coordinator with destination overrides and explicit outcome summaries. A live
add, verify, and cleanup lifecycle passed against the fresh local Radarr and
Sonarr containers. Missing-media request history is now atomic, bounded,
restart-safe, credential-redacted, and refreshed against exact Radarr/Sonarr
item endpoints. Missing collection membership is now restart-safe and reconciled
by a production quick-sync coordinator that scans authoritative Plex libraries,
matches TMDB first with TVDB fallback, preserves collection ordering, retains
partial failures, prunes stale/orphan records, and verifies every Plex write.
Both overlay and collection-poster canvases now provide direct manipulation for
every existing or newly added layer: click selection, pointer dragging,
eight-direction resizing, keyboard nudging, snapping, duplication, and
undo/redo-compatible geometry commits.
The live overlay path now acquires clean posters through Plex's authenticated
photo-transcode endpoint, builds context from real metadata, renders and
uploads posters, preserves base images and labels, restores exact originals,
and enforces the `Laptop` mutation allowlist. Single-item apply/restore and
manual or due scheduled batch jobs share the same guarded pipeline. A live
apply and restore passed on `The Breadwinner`; a subsequent two-library job
applied 2, skipped 4, and failed 0.
Managed collection synchronization now uses that same guarded `Laptop` Plex
connection end to end. It creates or adopts a regular collection, reconciles
and verifies exact membership, preserves requested item order through Plex's
collection-item move API, applies visibility and Home placement, synchronizes
custom summaries and collection mode, renders/uploads collection posters,
uploads optional wallpaper/theme assets, and optionally applies overlays to
the verified members. The scheduled Plex Collections job now invokes this
pipeline and reaches a terminal result instead of remaining queued. A live
manual collection lifecycle verified the generated poster, custom summary,
two exact members, and intended member order by reading the result back from
`Laptop`.
The live validation now covers both Plex media types. `Vynode Plex Integration
Validation` was created and reconciled in the Movies library with two ordered
members, while `Vynode TV Integration Validation` was created in TV Shows with
its expected member. Direct Plex read-back verified collection keys, library
ownership, membership and ordering, summaries, collection mode, and generated
posters. Per-collection synchronization is now an actual isolated job rather
than a whole-catalog shortcut. The dashboard overlay action was also replaced
with the real guarded application pipeline; it discovered the current library
sizes and completed 2/2 Movies and 4/4 TV Shows with zero failures instead of
reporting seeded counts or a simulated success.
Plex Auto Director/Actor sources now perform real metadata discovery for both
Movies and TV Shows, apply the legacy per-person minimum and family limit, and
preview qualifying people without misclassifying excluded people as missing
media. A guarded smart-collection adapter creates Plex-native actor/director
filters, verifies the saved library and person filter, rolls back failed
verification, and deletes only the requested collection. Live create,
read-back, and delete lifecycles passed on `Laptop` for one Movies actor and
one TV Shows actor. Family ownership labels, adoption/update, separator
collections, metadata/posters, and stale-family cleanup remain before this
source is complete.
IMDb chart acquisition is now a production integration rather than a UI-only
placeholder. It supports the legacy chart, custom-list, and random-pool
subtypes, normalizes IMDb identities, falls back to an embedded browser only
when IMDb's WAF rejects direct HTTP, matches those identities against Plex, and
feeds unmatched items into the existing missing-media workflow. Real IMDb Top
250 acquisition and live preview passed for both Movies and TV Shows.
The complete suite currently contains 241 passing tests. The detailed
table below will be fully reweighted after the remaining provider adapters land.

| Area | Completion | Basis |
| --- | ---: | --- |
| Route and user-input surfaces | 76% | 10 of 16 routes complete, 5 materially implemented but missing production adapters, and 1 still at discovery/editor parity |
| Setup, authentication, and settings | 88% | Setup, Plex Web/manual authentication, Plex verification, activated-API session enforcement, viewer/operator/administrator role boundaries and permission UI, restart-safe development integration and download settings, complete Trakt authorization/refresh/disconnect handling, tested Seerr/Radarr/Sonarr/watchlist workflows, Plex-backed placeholder browsing, and general settings are implemented; production identity administration/persistence, diagnostics, scheduler/cache adapters, and distribution metadata remain |
| Collection management and Plex discovery | 88% | Editor/input parity, authenticated discovery, server guards, restart-safe discovery, missing-item reconciliation, manual Plex item selection, live Radarr/Sonarr tag-source selection and execution, isolated per-collection synchronization, exact regular-collection create/rename/add/remove/reorder and verification, metadata/visibility/artwork synchronization, Home ordering, smart-collection protection, guarded actor/director discovery and smart-filter lifecycles, scheduled execution, and discovered Plex synchronization are implemented and live-validated for both Movies and TV Shows on Laptop; remaining gaps center on unimplemented provider engines, person-family ownership/cleanup/artwork, smart/unwatched collection planning, advanced cross-source policies, deletion/adoption UX, and rollback |
| Posters and overlays | 94% | Editors and inputs, direct manipulation, uploaded assets, saved/combined previews, real Plex metadata/poster acquisition, condition/context rendering, clean-base preservation, hash deduplication, guarded single-item, collection-member, and library-wide mutation, exact restoration, labels, cancellation, real dashboard and scheduled execution, restart-safe state, and live Laptop Movies/TV apply/restore/batch verification are implemented; richer asset search, ZIP/binary exchange, TMDB/local acquisition, season/episode execution, mapping management, and richer progress remain |
| Missing media, placeholders, and watchlists | 97% | Configuration, exact direct Radarr/Sonarr and real Seerr collection-request adapters, Seerr request-fed collection sources, Trakt/MDBList/MyAnimeList missing-item orchestration, per-item outcomes, failure isolation, bounded atomic request history, redacted failure notes, restart recovery, complete filtered/paginated dashboard history, and live status refresh are implemented. Seerr execution supports movie/TV identities, destination overrides, season limits/order, approval, retry, duplicate handling, cancellation, request/media status reconciliation, paginated request enumeration, owner/non-owner filtering, detail hydration, and Plex matching. Real Movies and TV previews were validated before restoring the clean test baseline. Separate per-Seerr-user restricted collection generation, title-specific trailer acquisition, and production scheduler/cache adapters remain. |
| Platform, persistence, packaging, and operations | 30% | Core package boundaries and durable Plex/asset files exist; database migrations, Docker/multi-architecture delivery, production logging, backups/import/export, and deployment verification remain |
| Cross-cutting verification and resilience | 88% | 241 automated tests plus live provider, OAuth refresh, Trakt Anticipated Movies/TV, AniList Movies/TV preview, Arr, managed/discovered Movies and TV collection, smart person-filter create/read-back/delete, guarded Plex poster apply/restore, isolated and scheduled collection execution, real two-library overlay execution, restart, cancellation, redaction, responsive UI, read-back verification, and failure-isolation checks cover completed blocks; broader fixtures, full accessibility, migration, and additional real-service suites remain |
| **Overall capability-weighted estimate** | **82%** | Weighted toward backend/external effects so a visually complete page does not count as a complete capability |

The uncertainty is approximately ±5 percentage points because original
provider and overlay engines contain behavior that is still being decomposed
into testable capabilities.

## Largest remaining blocks

The integration-by-integration execution and validation checklist is maintained
in [`integration-parity.md`](./integration-parity.md).

1. Poster rendering and application: season/episode execution, TMDB/local
   acquisition, mapping management, ZIP/binary imports/exports, preview
   supersession, and richer per-item progress.
2. Collection provider engines: TMDB, Letterboxd, Seerr,
   networks, remaining Coming Soon sources/lifecycles, filtered hubs,
   and multi-source execution.
3. Managed collection planner/apply: smart/unwatched collection creation,
   adoption/deletion UX, advanced exclusions and filters, retries, divergence,
   and rollback.
4. Missing media and placeholders: Seerr execution, trailer/media generation,
   labels/scans/trash, real-content cleanup, and placeholder lifecycle repair.
5. Production platform: database-backed repositories and migrations, encrypted
   vault integration, logs/debug archive, scheduler/cache implementations,
   Docker/multi-architecture images, backup/import/export, and upgrades.
6. Cross-cutting UX: deeper accessibility/focus audit,
   broader offline/fatal recovery, global notifications, responsive regression suite,
   localization coverage, and dynamic version/update reporting.

## Completion rule

The percentage increases only when a capability's production effect and
failure behavior are implemented. Adding a field or visual control alone does
not make the capability complete.
