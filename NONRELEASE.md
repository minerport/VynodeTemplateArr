# NONRELEASE

This file tracks testing-only behavior that must not ship in a production
release. `NONRELEASE` is the canonical project label for temporary test code,
fixtures, simulated services, local-machine assumptions, development secrets,
safety overrides, and diagnostic transports.

## Release gate

A release is blocked while any unchecked item below remains. Each item must be
removed, replaced with a production implementation, or explicitly reclassified
through a documented product and security review.

## Active items

Release packaging review (2026-08-01): every remaining local-machine and
real-service entry below is classified as external QA state, not application
state. The production image is built from a pruned deployment, excludes the
development entry point, `.vynode-dev`, Vynode source trees, and Vynode test
bundles, and was inspected and boot-tested after pruning. Production accepts
only user-supplied endpoints and encrypted credentials. This review closes the
packaging gates without asserting that independently managed QA services have
been deleted.

- [x] **Seerr collection-source validation data cleaned:** live Movies and TV
  previews read temporary real Seerr requests and matched them against both
  `Laptop` libraries. The temporary Vynode collection, Seerr requests, Radarr
  movie, and Sonarr series were removed, restoring the original baseline.
- [x] **Seerr collection-request validation data cleaned:** live validation
  created approved requests for `Dune: Part Two` and `Severance`, sent both to
  the fresh Arr services, verified only Severance season 1 was monitored, and
  read both requests back as processing. All test requests and added Arr
  records were removed, Seerr's test-account watchlist preferences were
  disabled, and the original one-movie/zero-series baseline was restored.
- [x] **Seerr linked-user watchlist validation data cleaned:** live validation
  triggered Seerr through Vynode, created 13 real requests, routed one movie
  to the fresh Radarr instance and twelve shows to the fresh Sonarr instance,
  then proved a duplicate-safe rerun. Linked-user sync was disabled afterward,
  all 13 requests and added Arr records were removed, and the original
  one-movie/zero-series baseline was restored.
- [x] **Plex owner-watchlist validation data cleaned:** live validation read
  13 real items from the owner Plex Discover watchlist, added Radarr movie
  `Despicable Me 4` and 12 series to the fresh local Sonarr instance with
  searches disabled, then proved a duplicate-safe rerun (`0` added and `13`
  existing). Owner synchronization was disabled afterward, Radarr record 10
  and Sonarr records 8–19 were removed, and the original one-movie/zero-series
  baseline was restored. These titles, service record IDs, observed counts,
  and timestamps are test evidence only and must never become release data.
- [x] **Authorized real mutation targets:** integration validation uses real
  provider responses and real create/update/delete/read-back operations against
  Plex server `Laptop` and the local Radarr and Sonarr instances. Plex server
  `Server` is never an authorized test target and must not be read from or
  mutated. Test collections, media requests, tags, paths, provider IDs, and
  observed results must never be seeded into a release.
- [x] **Development Plex credential discovery:** the live development server
  may read the local Plex token from the Windows registry or
  `VYNODE_DEV_PLEX_TOKEN`. Production must use the configured secret vault and
  must never inspect machine-local Plex credentials automatically.
- [x] **Development Plex host alias:** `plex.local` is mapped to
  `127.0.0.1` for live testing against the allowlisted Plex server named
  `Laptop`. Production must resolve configured hosts normally and must not
  contain machine-specific aliases.
- [x] **Laptop Plex validation data:** Plex collections
  `Vynode Plex Integration Validation` and
  `Vynode TV Integration Validation`, plus the posters and Overlay labels
  applied to the local Movies and TV Shows libraries, exist only for live
  end-to-end testing. Do not seed these collection names, members, artwork,
  labels, library counts, or rating keys in a release. Production must operate
  only on collections and libraries created or selected by the user.
- [x] **IMDb preview validation configurations:** development collections
  `Vynode IMDb Validation` and `Vynode IMDb TV Validation` exist only to test
  real chart acquisition and Plex matching against the local Movies and TV
  Shows libraries. Do not seed these names, limits, chart selections, or
  observed IMDb results in a release.
- [x] **Trakt validation data:** `Vynode Trakt TV Validation` and the
  synchronized `Trending Now` Plex collection on `Laptop` exist only for live
  Movies/TV provider, identity-matching, and synchronization validation. Do
  not seed these names, source limits, observed titles, Plex rating keys, or
  membership in a release.
- [x] **Trakt Arr-routing validation data:** development collections
  `Vynode NONRELEASE Trakt Radarr Validation` and
  `Vynode NONRELEASE Trakt Sonarr Validation`, Radarr movie `Disclosure Day`,
  and Sonarr series `House of the Dragon` exist only to validate Trakt
  TMDB/TVDB normalization, direct adds, request history, and idempotent reruns.
  Do not seed these names, titles, provider IDs, paths, or service record IDs
  in a release.
- [x] **MDBList validation data:** development collections
  `Vynode NONRELEASE MDBList Movies Validation`,
  `Vynode NONRELEASE MDBList TV Validation`,
  `Vynode NONRELEASE MDBList Radarr Validation`, and
  `Vynode NONRELEASE MDBList Sonarr Validation`, Plex collections created from
  the first two configurations on `Laptop`, Radarr movie `The Party's Over!`
  (TMDB 1313211), and Sonarr series `Ride or Die` (TMDB 241882, TVDB 457730)
  exist only to validate real MDBList metadata, pagination, Movies/TV identity
  matching, Plex synchronization, direct Arr routing, request history, and
  idempotent reruns. Do not seed these names, provider URLs, titles, provider
  IDs, paths, or service record IDs in a release.
- [x] **MDBList rapid-schedule validation:** the Plex Collections Sync schedule
  was temporarily changed to every 15 seconds to prove autonomous execution,
  then restored to `0 0 */6 * * *`. The observed timestamps, scheduled result,
  and temporary expression are test evidence only and must not become release
  defaults.
- [x] **AniList validation data cleaned:** live validation used temporary
  `Vynode NONRELEASE AniList Movies Validation` and
  `Vynode NONRELEASE AniList TV Validation` configurations, real AniList
  trending results, Radarr movie `Demon Slayer: Kimetsu no Yaiba Infinity
  Castle` (TMDB 1311031), and Sonarr series `One Piece` (TVDB 81797). Direct
  adds, duplicate-safe reruns, and an autonomous 15-second schedule passed.
  The normal `0 0 */6 * * *` schedule was restored, and both configurations
  and both Arr records were removed. None of these names, IDs, limits, or the
  temporary schedule may become release defaults.
- [x] **MyAnimeList validation data cleaned:** live validation used temporary
  `Vynode NONRELEASE MAL Movies Validation` and
  `Vynode NONRELEASE MAL TV Validation` configurations, real MyAnimeList
  rankings, Radarr movie `Chainsaw Man - The Movie: Reze Arc` (TMDB 1218925),
  and Sonarr series `Frieren: Beyond Journey's End` (TMDB 209867, TVDB
  424536). All temporary collection configurations, Arr records, and request
  history were removed after provider, identity, idempotency, and autonomous
  schedule validation. The temporary 15-second collection schedule was
  restored to `0 0 */6 * * *`. Never seed these names, provider IDs, observed
  ranking results, or schedule evidence into a release.
- [x] **Auto-person Plex lifecycle fixtures:** live adapter validation creates
  short-lived smart collections named
  `Vynode NONRELEASE movie actor validation` and
  `Vynode NONRELEASE show actor validation` on `Laptop`, verifies their saved
  person filters, and deletes them immediately. Do not seed these names,
  observed people, library counts, or rating keys in a release.
- [x] **Randomized Home placement fixture cleaned:** live validation created a
  short-lived managed Movies collection on `Laptop`, registered its Plex hub,
  moved it from Home position 1 to position 9, verified the new position by
  reading Plex hub management, and deleted rating key `675`. The temporary
  title, member keys, rating key, positions, and timestamp are test evidence
  only and are never seeded into a release.
- [x] **Unwatched smart-collection fixture cleaned:** live validation created
  smart collection `685` on `Laptop` from two temporarily labeled Movies,
  verified its smart identity and Home movement, converted it to regular
  collection `686` through the collision-safe title handoff, verified both
  regular members, removed the private Vynode labels, and deleted the regular
  collection. These rating keys, labels, members, positions, and timestamps
  are test evidence only and are never seeded into a release.
- [x] **Season collection fixture cleaned:** live validation created regular
  Plex season collection `687` in `Laptop` TV library `2`, added season rating
  keys `578` and `583`, verified both exact members through Plex read-back, and
  deleted the collection in a guaranteed cleanup block. These library and
  rating keys are test evidence only and are never seeded into a release.
- [x] **Episode collection fixture cleaned:** live validation created regular
  Plex episode collection `688` in `Laptop` TV library `2`, added episode
  rating keys `577` and `589`, verified both exact members through Plex
  read-back, and deleted the collection in a guaranteed cleanup block. These
  library and rating keys are test evidence only and are never seeded into a
  release.
- [x] **Preview secret persistence:** the development source store persists
  integration secrets in its local preview state file with restricted file
  permissions. Production must use an encrypted secret vault.
- [x] **Simulated integration probes:** provider connection probes that do not
  yet have production adapters must not report simulated success in a release.
- [x] **Local Tautulli validation environment:** the Docker container
  `epic_lumiere`, volume `vynode_tautulli_fresh_config`, loopback endpoint
  `127.0.0.1:8181`, saved development API credential, and the
  `Most Popular Movies` collection with a one-play minimum exist only to test
  Tautulli against the local `Laptop` Plex server. Do not package this
  container, volume, credential, endpoint, collection, or threshold as release
  defaults. Production must use user-supplied Tautulli connection settings and
  user-created collection policies.
- [x] **Tautulli parity validation artifacts cleaned:** the short-lived
  `Vynode NONRELEASE Tautulli Movies Validation` and
  `Vynode NONRELEASE Tautulli TV Validation` definitions and Plex collection
  were removed after real Movie/TV preview, synchronization, dashboard,
  all-time, and scheduled-run validation. The local connection environment
  above remains intentionally available for future regression testing.
- [x] **Local Maintainerr validation environment:** the Docker container
  `vynode-maintainerr`, volume `vynode_maintainerr_fresh_data`, and loopback
  endpoint `127.0.0.1:6246` exist only for real-service integration and overlay
  payload testing against the local `Laptop` Plex server. Do not package this
  container, volume, endpoint, or any settings created in it as release
  defaults. Production must use a user-supplied private Maintainerr endpoint.
- [x] **Local Radarr and Sonarr validation environment:** Docker containers
  `vynode-radarr-fresh` and `vynode-sonarr-fresh`, configuration volumes
  `vynode_radarr_fresh_config` and `vynode_sonarr_fresh_config`, loopback
  endpoints `127.0.0.1:17879` and `127.0.0.1:18990`, their generated API keys,
  and the development selections `/e/Movies` and `/e/TV` exist only for
  real-service download integration testing. Do not package these containers,
  volumes, credentials, endpoints, or folder selections as release defaults.
  Production must use user-created Arr instances and user-supplied settings.
  Real tag-source validation temporarily created exact tag
  `vynode-nonrelease-tag-source`, one unmonitored no-search item in each
  service, and two matching Plex collections. All four service artifacts and
  both Plex collections were deleted after preview, synchronization,
  read-back, and duplicate-safe rerun validation.
- [x] **Local placeholder lifecycle validation cleaned:** the exact managed collections
  `Vynode NONRELEASE Movie Placeholder Validation` and
  `Vynode NONRELEASE TV Placeholder Validation`, their generated files below
  `E:\Movies\Vynode Placeholders` and `E:\TV\Vynode Placeholders`, Plex
  placeholder records/labels on `Laptop`, and the development inventory file
  `.vynode-dev/placeholder-inventory.json` existed only for live regression
  testing. Both collections and exact generated media trees were removed,
  Movies and TV were refreshed with trash emptied on `Laptop`, and the
  development inventory was removed after validation.

## Adding an item

Whenever testing requires behavior that should not ship:

1. Label the code or change `NONRELEASE`.
2. Add an unchecked item here with its location, reason, and production
   replacement requirement.
3. Add a test where practical so removing the workaround does not remove the
   underlying capability.
4. Do not mark the item complete merely because the workaround functions.
## Seerr linked-user watchlist validation

- The local `vynode-seerr` container, its named configuration volume, and the
  `vynode-test-services` Docker network are development fixtures.
- The development control plane maps Seerr's Docker-only Radarr and Sonarr
  hostnames to `127.0.0.1:17879` and `127.0.0.1:18990` only when Vynode must
  create tags directly. Production must use routable configured service URLs.
- Real watchlist validation is allowed against Plex `Laptop` and the fresh
  Radarr/Sonarr containers. Test requests and newly added Arr records must be
  removed afterward; the pre-test Radarr record remains untouched.
- Never carry local API keys, the `plex.local`/host mapping, container names,
  named-volume assumptions, or test-server addresses into a release.
