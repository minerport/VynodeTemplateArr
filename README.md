# Vynode

## Docker and Unraid serious testing

Launch the published serious-test image with persistent configuration, or use
the included Compose build while developing locally:

```sh
openssl rand -base64 32
cp .env.example .env
# Put the generated value in VYNODE_MASTER_KEY, then:
docker pull ghcr.io/minerport/vynodetemplatearr:0.1.0-rc.6
docker compose up -d --build
```

Open `http://SERVER-IP:7171`. The container includes Chromium for protected
provider pages plus ffmpeg and yt-dlp for placeholder trailer media. It runs as
PUID 99 / PGID 100 by default and stores all durable application state in the
configured appdata directory.

For Unraid template installation, volume guidance, upgrades, and rollback, see
[docs/unraid-install.md](docs/unraid-install.md). The template is
[unraid/vynode.xml](unraid/vynode.xml).

Vynode is a self-hosted media automation platform for Plex collections,
posters, overlays, watchlists, requests, downloads, and missing media.

## Principles

1. No capability is removed without an explicit product decision.
2. Every external mutation is planned before it is executed.
3. Plans are previewable, auditable, resumable, and reversible where the target
   service permits it.
4. Integrations are adapters behind stable contracts.
5. Domain logic does not depend on a web framework, database, or vendor SDK.
6. Secrets are encrypted at rest and never included in diagnostics.
7. SQLite is the durable storage backend for this release candidate.
8. Plex is the supported media-server target for this release candidate.

Release validation rejects temporary release markers, development-only
versions, incomplete parity entries, and unfinished integration rows.

## Workspace

- `apps/control-plane`: API, authentication, configuration, and job control.
- `apps/web`: browser interface.
- `apps/worker`: durable job execution.
- `packages/contracts`: shared domain and API contracts.
- `packages/planner`: pure synchronization planning.
- `packages/integrations`: source and target adapter SDK.
- `docs`: architecture, parity registry, and migration specifications.

## User guides

- [Collections: capabilities and how-to](./docs/user-guide-collections.md)

## First milestone

The foundation milestone is complete when:

- every legacy capability has a parity identifier;
- the plan/apply/rollback contracts are stable;
- the control plane exposes unauthenticated health information at `/health`
  and `/api/health`, and the worker exposes its health information;
- a simulated collection sync can produce a deterministic change plan;
- CI runs formatting, linting, type checks, unit tests, and contract tests.
