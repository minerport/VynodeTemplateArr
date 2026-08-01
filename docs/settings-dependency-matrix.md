# Settings input and workflow dependency matrix

This is the field-level parity ledger for post-setup settings. A setting is not
complete merely because it is rendered. Each row tracks how the user supplies
the value, how it is validated and stored, which workflows consume it, and the
side effects or failure states that must remain visible.

## General settings

| Setting/action | Input contract | Storage/security | Consumers and side effects | States and validation |
| --- | --- | --- | --- | --- |
| Application name | Required text, 80-character maximum. Helper explains installation identity. | Plain configuration value with optimistic revision. | Browser/application identity, links, notifications, generated copy. | Required; save progress, success, conflict reload, and error. |
| Application URL | Required URL input. Helper distinguishes internal access from public reverse-proxy HTTPS address. | Plain configuration value. | Callback/webhook URLs, external links, authentication return paths. | Complete `http` or `https` URL only. |
| Locale | Dropdown of supported locales. | Plain locale identifier. | Dates, numbers, translated interface text. | A supported option is always selected. |
| Cache images | Checkbox, enabled by default. Consequence helper. | Plain boolean. | Artwork browsing, poster generation, provider request volume, disk use. | Disabling also disables cache-duration input. |
| Image cache days | Numeric input, 1–3650, conditional on cache-images. Current file count and size shown. | Plain integer. | Eligibility for background image-cache cleanup. | Clamped client-side and validated server-side. |
| Clear image cache | Secondary action with destructive confirmation containing current count/size. | No input persisted; cache metadata changes atomically. | Deletes local cached artwork only; later workflows redownload it. | Disabled when empty; focus/Escape/cancel/progress/success/error. |
| API key | Masked read-only preview. Regenerate action with invalidation warning. | Full key must remain write-only/secret; only masked preview returns. | External API clients and automation. | Confirmation required; previous key invalid immediately. |

## Plex settings

| Setting/action | Input contract | Storage/security | Consumers and side effects | States and validation |
| --- | --- | --- | --- | --- |
| Discover servers | Explicit refresh button. Results identify name, endpoint, local/remote, security, reachability, and latency. | Discovery result is transient and never saves automatically. Owner token remains a server-side secret reference. | Prefills host, port, and transport only. | Idle/loading/success/empty/unavailable; unreachable choices disabled or clearly marked. |
| Host | Required text input without protocol. | Plain endpoint configuration. | Every Plex API connection, sync, webhook server validation, library discovery. | Required valid hostname/IP; save performs live verification. |
| Port | Required numeric input, default 32400. | Plain integer. | Combined with transport and host for Plex base URL. | Integer 1–65535. |
| Transport security | Dropdown: HTTP, HTTPS with certificate verification, HTTPS without verification. | Plain enum. | Plex HTTP client and all connection tests. | Insecure/no-verification options include visible risk helper. |
| Plex Web App URL | Optional URL input, default helper link to hosted Plex Web. | Plain URL. | “Open in Plex” actions and user-facing media links. | Empty or complete HTTP(S) URL. |
| Auto empty trash | Checkbox with advanced/destructive warning. | Plain boolean. | Placeholder cleanup after original media becomes available. | Never runs merely from saving; cleanup jobs consume it. |
| Save and verify | Primary action, disabled while running. | Optimistic configuration revision; owner token stored only by reference. | Verifies machine identity, refreshes libraries, and makes settings available to all Plex-dependent workflows. | Machine-identity change requires explicit confirmation; connection/library errors do not partially replace settings. |
| Discovered libraries | Read-only rows with type, key, scanner, agent, and mounted locations. | Stored as verified server snapshot. | Collection library choices, placeholder roots, watchlist/download routing, overlays, activation. | Loading/empty/error, unavailable historical-library distinction, last verification time. |

## Sources and downloads

| Source setting/action | Input contract | Storage/security | Consumers and side effects | States and validation |
| --- | --- | --- | --- | --- |
| Letterboxd/FlixPatrol direct fetching | Independent checkboxes with protected-page fallback helper text. | Plain booleans with optimistic revision. | List ingestion chooses direct HTTP or browser automation. | Save progress/success/conflict/error. |
| Trakt Client ID | Required text; OAuth checkbox conditionally reveals Client Secret. | Client ID is public config; Client Secret is a vault secret and write-only. | Public/custom lists; OAuth account lists when enabled. | Exact draft is tested before atomic replacement. |
| MDBList API key | Required password field with acquisition guidance. | Vault secret; stored value returns only `secretConfigured`. | MDBList collections, ratings, and metadata enrichment. | Required for connection test; replacement occurs only after success. |
| MyAnimeList Client ID | Required password-style field with application guidance. | Vault secret/write-only. | Anime rankings and list collection refreshes. | Test receipt is draft-bound and expires. |
| Tautulli endpoint | Host, port, HTTPS, URL base, external URL, API key. Internal and browser URLs are distinguished. | Endpoint fields are public config; key is a vault secret. | Dashboard play statistics and Tautulli-sourced collections. | Host excludes protocol/path; port 1–65535; external HTTP(S) URL; exact-draft test. |
| Maintainerr endpoint | Same endpoint controls and secret rules as Tautulli. | Endpoint public; key write-only. | Maintainerr collection-state sources and maintenance-driven refreshes. | Same normalization, test receipt, conflict, and error states. |
| Disconnect source | Destructive confirmation names credential removal and preserved definitions. | Deletes vault reference and integration config; never mutates external service. | Dependent collections remain but cannot refresh; Tautulli stats/maintenance consumers show missing-config states. | Cancel/focus/Escape/progress/conflict/success/error. |

## Requests and downloads

| Setting/action | Input contract | Storage/security | Consumers and side effects | States and validation |
| --- | --- | --- | --- | --- |
| Seerr endpoint | Host, port (default 5055), HTTPS, URL base, optional external URL, password API key. Internal and browser-facing URLs are distinguished. | Endpoint values are public config; API key is a write-only vault secret. | Missing-item requests, collection auto-request mode, Plex watchlist synchronization, dashboard request statuses, Open Seerr link. | Any endpoint change invalidates test and dependent destinations. Host excludes protocol/path; port 1–65535; URL base normalized; external URL HTTP(S). |
| Seerr test | Explicit test loads only destinations reachable through the exact tested Seerr draft. | Short-lived draft fingerprint receipt; no configuration changes. | Enables Radarr/Sonarr destination selectors and Save. | Loading/success/failure; receipt expires and cannot be reused after edits. |
| Seerr movie/TV destinations | Server, quality profile, root folder, tags, and service-user creation mode. Options come from tested Seerr. | Plain IDs/paths/policy values. | Routes movie and show requests independently; user mode controls attribution/account reuse. | Changing server clears profile/root/tags. Required selections block save. |
| Save Seerr | Enabled only after exact-draft test and valid destinations. | Atomic optimistic revision plus vault secret replacement. | Makes Seerr available to watchlists, collection request mode, and missing-item tracking. | Conflict reload; no partial credential or routing replacement. |
| Disconnect Seerr | Confirmation includes active watchlist dependency and preserved Arr connections, external users, requests, and media. | Removes Vynode connection and secret only. | Disables Seerr request/watchlist workflows; direct Arr remains available. | Impact calculation/loading, cancel, focus/Escape, progress, conflict/error/success. |
| Radarr/Sonarr endpoint | Display name, host, port (7878/8989), HTTPS, URL base, external URL, password API key. | Public endpoint config plus write-only vault secret. | Direct missing-media routing, watchlists, tag-based collection sources, Open service links. | Every tested field edit invalidates receipt and dependent options. |
| Arr test | Explicit test fetches quality profiles, root folders, and tags from that exact server. | Short-lived draft receipt; secret not stored yet. | Enables all dependent selects and policy controls. | Loading/success/failure/expired/changed-draft states. |
| Quality profile/root folder | Required dropdowns populated by test. | Plain external IDs/path. | Destination for additions and watchlist routing. | Reset when endpoint/server changes; save blocked until selected. |
| Existing/automatic tags | Existing tag multi-select plus automatic-tag policy; watchlists can create new tags. | Plain tag IDs and policy. New tag creation mutates the chosen external Arr server. | Attribution, cleanup, collection-specific routing, existing-media tagging. | Empty/loading/error; new tag trims/validates name and refreshes options. |
| Radarr availability | Dropdown with availability eligibility helper. | Plain policy enum. | Determines when requested movies become eligible to download. | Required tested-server policy. |
| Sonarr series/monitor types | Dropdowns for Standard/Daily/Anime and episode monitoring policy. | Plain policy enums. | Controls numbering and which episodes Sonarr monitors. | Defaults and consequences remain visible. |
| Default/4K/monitor/search/season folders/tag existing | Independent checkboxes with consequence helpers. | Plain booleans. | Default server selection, quality tier routing, automatic searches, folder structure, existing media. | Removing referenced/default/tier servers reports impact before confirmation. |
| Remove Arr | Row Remove action and confirmation with reference counts. | Deletes Vynode endpoint and secret; never deletes Arr media/history. | Invalidates direct, Seerr-derived, watchlist, and tag-source references to that server. | Impact loading, cancel, focus/Escape, conflict/error/success. |
| Placeholder library roots | One text input per verified Plex movie/show library plus Browse. | Plain container path keyed by immutable Plex library key. | Placeholder file creation and cleanup. | Typed and picked paths equivalent; missing Plex libraries show an explicit empty state. |
| Folder picker | Current path, parent, mounted root, directory rows, selected path, Select/Cancel. | No separate persistence until placeholder settings save. | Safely supplies library root. | Cannot escape configured mounts; loading/empty/error and keyboard/modal states. |
| YouTube cookies | Read-only missing/ready/present-but-disabled status and expected filename. Cookie content never displayed. | Mounted secret file outside browser-returned settings. | Title-specific trailer download for placeholders. | Refresh after save; missing instructions and disabled state. |
| Generic trailer | Checkbox to skip YouTube downloads. | Plain boolean. | Uses bundled generic video instead of per-title trailer. | Consequence helper; independent of cookie file presence. |
| Plex watched-state webhook | Copyable same-origin URL, Plex Pass/setup instructions, live last-event status and Refresh. | No Plex webhook secret stored; backend validates configured server UUID and recognized placeholder marker. | Resets watched state for play/stop/scrobble of Vynode trailer placeholders. | Multipart parsing, thumbnail discard, duplicate-event idempotency, processed/ignored/failed/waiting states. |
| Watchlist owner/linked users | Independent enable toggles. | Plain booleans. | Owner mode reads the signed-in Plex Discover watchlist and routes directly to Arr; linked-user mode invokes Seerr's Plex Watchlist Sync so Seerr owns identity mapping, per-user opt-in, permissions, duplicate checks, and its configured default movie/TV destinations. | Direct movie/show destination controls appear only for owner mode. Seerr is required only for linked-user mode. Each linked Seerr user must enable Plex watchlist sync in their profile, and Seerr must have default Radarr and Sonarr servers. |
| Watchlist destinations | Independent Radarr/Sonarr server, profile, root, tags, username tagging, monitor/search, and season-folder controls. | Plain IDs/paths/policies. | Routes watchlist movie/show additions and attribution. | Server change clears profile/root/tags; options reload; last sync shown; save validates both enabled destinations; manual and scheduled runs share cancellation, locking, failure isolation, and duplicate-safe Arr lookup/add behavior. |

The setup presentation contract remains in `setup-input-registry.md`; this
matrix is the authoritative consumer and side-effect trace for post-setup use.

## Logs and diagnostics

| Input/action | Interaction contract and consumers |
| --- | --- |
| Search | Debounced text input matching message, label, and structured detail values. Resets to page 1. |
| Minimum severity | Debug/Info/Warning/Error dropdown. Inclusive threshold, so Warning also returns Error. Saved as a browser display preference. |
| Rows per page | 10/25/50/100 dropdown, saved as a browser display preference and resets page 1. |
| Live logs | Five-second refresh by default. Pause preserves the current rows; Resume and Refresh Now are independent actions. |
| Pagination | Server-side page, total, and pages with disabled Previous/Next boundaries and out-of-range page correction. |
| Row details | Timestamp, severity, label, message, formatted structured data, Copy action, initial focus, Escape, and Close. |
| Copy | Produces one complete line containing timestamp, level, optional label, message, and serialized structured data. Clipboard failure gives manual-copy guidance. |
| Debug export | Downloads a diagnostic JSON artifact. Registered secrets and authentication values must be redacted before both logs and export are produced. |
| File/stdout helper | Shows the resolved application data log path and explains standard-output availability. |

## Jobs and caches

| Input/action | Interaction contract and consumers |
| --- | --- |
| Job list | Name, process/command type, raw six-part CRON, next execution, running/start state, five-second refresh, loading/error/empty states. |
| Run now | Starts the same dependency-checked, lock-protected job used by its schedule. Duplicate runs must be rejected. Applicable collection/overlay progress also appears on Dashboard. |
| Cancel | Available only while running. Sends a safe cancellation request; the current adapter must honor its cancellation signal and report terminal state. |
| Edit schedule | Disabled while running. Modal shows current schedule, preset intervals, or custom six-part CRON with format helper and validation. Saving recalculates next execution. |
| Cache statistics | Name, hits, misses, key count, key bytes, value bytes. Values refresh with the page. |
| Flush cache | Disabled when empty. Confirmation names count/size and explains that settings/collections remain while later requests rebuild entries and consume provider quota. |

## About and runtime

| Surface | Interaction contract |
| --- | --- |
| Build | Version, build identifier, commit, and license from the running server—not hard-coded browser values. |
| Update status | Current/latest version, update-available state, restart-required warning, and manual status refresh. |
| Runtime | Node version, platform, architecture, timezone, uptime, and application-data path. |
| Resources | Distribution-configured documentation, issue, and source links open externally. Missing links are visibly disabled and never fall back to the reference application. |

## Traceability rule

Every new setting must identify at least one concrete consumer, or explicitly
state that it is display-only. Every consumer must define behavior for missing,
invalid, changed, and removed configuration. UI completion, API completion,
secret handling, persistence, and consumer wiring are tracked separately.
