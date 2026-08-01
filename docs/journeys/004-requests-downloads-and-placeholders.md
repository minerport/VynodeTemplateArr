# Journey 004: Requests, downloads, and placeholders

## Page structure and actions

The legacy page manages one Seerr connection, any number of Radarr and Sonarr
connections, per-library placeholder roots, YouTube trailer behavior, Plex
webhook guidance, and Plex watchlist synchronization. Every configured service
has open, edit, test, save, and confirmed-delete states. Lists display internal
or external links and default/4K badges. Missing default standard or 4K
instances produce warnings.

## Radarr

Defaults: port `7878`, HTTPS off, minimum availability `released`, monitor new
items on, search on add on, tag existing items off, automatic tag mode off
(legacy records may migrate to granular), default off, standard/non-4K.

Inputs:

- Default instance, display name, hostname, port, HTTPS, API key, URL base,
  external URL.
- Quality profile and root folder, loaded only after a successful draft test.
- Minimum availability: announced, in cinemas, or released.
- Existing Radarr tags (multi-select).
- Monitor new items, search immediately, tag already-existing items.
- Automatic tag mode: off, one `vynode` tag, per-service tags, or granular
  per-collection tags.

## Sonarr

Defaults: port `8989`, HTTPS off, series type standard, season folders on,
monitor new items on, monitor type all, search on add on, tag existing items
off, automatic tag mode off (legacy records may migrate to per-service),
default off, standard/non-4K.

Inputs:

- The shared endpoint, API, profile, root, tags, default, external URL, and
  automatic-tag fields listed for Radarr.
- Series type: standard, daily, or anime.
- Season folders.
- Monitor type: all, future, missing, existing, pilot, first season, latest
  season, or none.

## Seerr

Defaults: port `5055`, HTTPS off. Inputs are hostname, port, HTTPS, API key,
URL base, and external URL. A successful test loads every Seerr Radarr/Sonarr
server and, for each server, its profiles, roots, and tags.

Optional request defaults are stored independently for movies and television:
server, profile, root folder, and tags. Changing a server clears its dependent
profile and root choices. Service-user creation mode is also saved with the
connection. Disconnecting Seerr must not delete Radarr/Sonarr instances.

## Placeholder roots and trailers

- Each currently discovered Plex movie or show library has its own container
  path. Users may type or choose it through a server-side folder browser.
- Movie examples use `/data/media/movies`; show examples use `/data/media/tv`.
- Removed Plex libraries retain their mappings as unavailable records until the
  user explicitly removes them.
- The server reports whether `youtube-cookies.txt` exists without returning its
  contents. The page distinguishes missing, ready, and present-but-disabled.
- “Skip YouTube trailer downloads” uses the bundled generic placeholder video.
- Cookie setup instructions cover exporting signed-in YouTube cookies and
  mounting the file in the configuration directory.
- Plex webhook path `/plex-webhook` resets watched state after a placeholder
  trailer is played, preventing accidental scrobbles. It requires Plex Pass.
- The endpoint accepts Plex's multipart `payload` field and discards the
  optional thumbnail. Only play, stop, and scrobble events with the exact
  legacy movie/episode placeholder markers are processed. Repeated deliveries
  within five minutes are idempotent, mismatched Plex server identities are
  ignored when an installation identity is known, and the UI reports the last
  processed, ignored, or failed event without exposing account tokens.

## Plex watchlist synchronization

Owner-only synchronization uses the signed-in Plex account's real Discover
watchlist and routes movies and shows directly to independently configured
Radarr and Sonarr destinations. Linked-user synchronization additionally
requires Seerr so Plex identities can be mapped to request users. It invokes
Seerr's real Plex Watchlist Sync job; Seerr applies each linked user's profile
opt-in and permissions, avoids duplicate requests, and routes movies and shows
through its configured default Radarr and Sonarr servers. Vynode's movie/show
destination controls apply only to direct owner sync. A live run against the
local test services created 13 real Seerr requests, dispatched one movie and
twelve shows, and a second run added nothing.

Manual **Run now** and scheduled execution share the same executor, lock,
cancellation signal, validation, and terminal result reporting. Every Plex item
is resolved to TMDB or TVDB identity before routing. Existing Arr records are
reported without duplication, individual failures do not stop unrelated
items, and account/server credentials never appear in job results. The page
reports the last completed synchronization time.

Collection missing-media execution can route through Seerr instead of direct
Arr. Vynode sends the real TMDB/TVDB identity plus the selected Seerr server,
quality profile, and root folder. TV requests resolve real Seerr season
metadata and apply the configured collection-wide limit, per-show limit, and
earliest/latest/airing ordering. Pending requests can be approved, failed
requests can be retried, duplicates are reported without recreation, and the
dashboard reconciles Seerr request state with processing, partial, and
available media state.

Seerr is also a collection source. Vynode reads the paginated request feed,
ignores declined requests, filters all, owner-only, or non-owner requests,
loads the corresponding movie/TV details, and matches TMDB/TVDB identities
against the selected Plex library. Preview is read-only; synchronization uses
the standard collection and missing-media policies.

## Legacy defects corrected by the new contract

- API keys are no longer returned by GET endpoints or injected back into edit
  forms.
- Editing an existing server no longer performs an automatic network test with
  a browser-visible stored key.
- A successful test receipt is bound to the complete endpoint draft; editing
  hostname, port, HTTPS, URL base, or key invalidates dependent options.
- Save validates that profile, root, and tags still exist in the exact tested
  response.
- Creating or changing a default is atomic and unique per service/media tier.
- Delete is revision-checked and reports downstream references before removal.
- Partial Seerr/service-user saves cannot leave mismatched configuration.
- Option-loading failures are visible instead of silently producing empty
  dropdowns.
- Ports are constrained to 1–65535; paths and URLs are normalized consistently.
- Folder browsing is restricted to configured mount roots to prevent arbitrary
  host filesystem disclosure.
- YouTube cookie status checks validate file type and permissions without
  logging content.
- Watchlist settings cannot enable an incomplete destination and never infer
  validity solely from a selected server ID.

## Acceptance checks

1. Add, edit, test, list, link to, and remove every service type.
2. Enforce exact test-before-save and redact every credential.
3. Preserve multiple Radarr/Sonarr instances and one default per tier.
4. Refresh dependent options when an endpoint or selected server changes.
5. Save placeholder paths by immutable Plex library key.
6. Represent all three YouTube-cookie states and generic-trailer mode.
7. Validate webhook event shape and configured Plex server identity, and make
   repeated events idempotent. Plex does not provide a cryptographic webhook
   signature, so the endpoint never claims signature verification.
8. Validate owner/user watchlist destinations before enabling sync; require
   Seerr only when all-user identity routing is enabled.
9. Prove manual and scheduled owner sync against real Plex, Radarr, and Sonarr
   data, including cancellation, duplicate-safe reruns, and cleanup.
10. Preserve `lastSyncAt`, per-user failures, and retry-safe progress.
