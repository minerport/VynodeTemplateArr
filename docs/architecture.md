# Target architecture

## System boundaries

```text
Web UI
  |
Control Plane API ---- Authentication / Secrets / Configuration
  |
Durable Job Store ---- Audit Log ---- Event Stream
  |
Workers
  |
Planner ---- Policy Engine ---- Identity Resolver ---- Render Engine
  |
Integration adapters
  |-- Plex / Jellyfin
  |-- Radarr / Sonarr / Overseerr / Maintainerr / Tautulli
  `-- TMDB / Trakt / IMDb / Letterboxd / MDBList / AniList / MAL / TVDB
```

## Planning model

All synchronization follows five phases:

1. **Observe**: obtain immutable snapshots from sources and targets.
2. **Normalize**: resolve provider identifiers into canonical media identities.
3. **Plan**: calculate a deterministic ordered set of changes.
4. **Apply**: execute changes with idempotency keys and checkpoints.
5. **Verify**: re-observe affected targets and record divergence.

The planner is pure: the same snapshot and policy must produce the same plan.
No adapter may mutate an external system during observation or planning.

## Core domains

### Media identity

A canonical media record can contain Plex, Jellyfin, TMDB, TVDB, IMDb, Trakt,
AniList, MyAnimeList, Radarr, and Sonarr identifiers. Conflicts are preserved as
resolution evidence rather than silently overwritten.

### Collections

Sources produce ordered candidates. Policies filter, rank, deduplicate, limit,
partition, and target them. The planner compares the result to media-server
state and emits collection, membership, ordering, visibility, and artwork
changes.

### Missing media

Missing candidates are evaluated separately from collection membership.
Policies choose ignore, report, request through Overseerr, add directly to an
arr service, or create a placeholder.

### Artwork

Poster and overlay templates compile into a versioned render specification.
Base artwork is content-addressed and immutable. Restoration always references
the captured base asset, never a subsequently overlaid image.

### Jobs

Jobs have durable state, leases, heartbeats, cancellation, progress events,
retry policy, checkpoints, and an immutable audit record. A process restart
cannot silently lose a running synchronization.

## Storage

The data layer uses repository interfaces implemented for SQLite and
PostgreSQL. Binary assets use a storage interface supporting local files and
S3-compatible object storage.

Sensitive values are envelope-encrypted. Diagnostic exports contain redacted
configuration and explicit user-selected attachments only.

## Compatibility

Legacy import reads settings, SQLite records, poster templates, overlay
templates, saved artwork, placeholder markers, mappings, and caches. Imports
are repeatable and produce a report; they never modify the legacy installation.
