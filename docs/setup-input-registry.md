# Setup input and interaction registry

Parity includes the way a value is requested, not only its persisted value.
Each setup input must retain its control type, label, required marker, helper
text, default, placeholder, conditional visibility, disabled/loading state,
validation message, test dependency, and save/error feedback.

## Step 1: installation

| Input/action | Interaction contract |
| --- | --- |
| Health check | Automatic status panel: checking, ready, or attention. Retry appears only after failure. Continue is disabled until ready. |

## Step 2: owner

| Input/action | Interaction contract |
| --- | --- |
| Plex sign-in | Primary Plex Web button opens a popup and polls automatically. Waiting, blocked-popup, denied, expired, provider-error, and retry states are visible. |
| Manual Plex token | Hidden by default. Offered only when the user requests it or Plex Web fails. Password-style input, helper warning, verify action, and explicit return to web sign-in. |

## Step 3: Plex server and libraries

| Input/action | Interaction contract |
| --- | --- |
| Server discovery | Reachable server cards, local/remote label, latency, unavailable diagnostic, and “Use this server.” |
| Manual endpoint | Host text input, numeric port, security dropdown, optional Plex Web URL, automatic-trash checkbox with destructive warning. |
| Libraries | Read-only discovered summary after verification; unavailable historical libraries remain distinguishable. |

## Step 4: metadata sources

| Integration | Interaction contract |
| --- | --- |
| Fetching policy | Letterboxd and FlixPatrol plain-HTTP toggles with browser-automation fallback helper text. |
| Trakt | Client ID text input; optional OAuth toggle reveals password-style client secret and web authorization. Connected/disconnect state. |
| MDBList | Password-style API key with acquisition helper link. |
| MyAnimeList | Password-style Client ID with application-registration helper text. |
| Tautulli/Maintainerr | Host text, numeric port, HTTPS toggle, URL-base text, external-URL input, password-style API key. |
| Every source | Expandable card, optional status, test then save, exact-draft invalidation, loading/success/error feedback. |

## Step 5: requests and downloads

| Area | Interaction contract |
| --- | --- |
| Seerr | Endpoint fields with reachable-address, port, API-key, URL-base, external-link, and user-mode helpers. Test loads dependent Radarr/Sonarr server dropdowns. Server selection resets profile/root. Multi-select tags. Service-user-mode dropdown. Configured row has Open, Edit, and Disconnect actions. Disconnect confirmation lists watchlist impact, preserved Arr connections, preserved requests/users, credential removal, and external-data safety. |
| Radarr/Sonarr | Add/edit panel with helper text for display name, reachable host, valid/default port, HTTPS, write-only password API key, URL base, and external URL. Test enables profile/root dropdowns and tag checkboxes. Configured rows expose Open, Edit, and Remove. Removal confirmation reports active references, default/tier impact, credential removal, and preserved external data. |
| Radarr policy | Availability dropdown with eligibility helper; default/4K/monitor/search/tag-existing toggles with visible consequence text; automatic-tag dropdown with routing/cleanup helper. |
| Sonarr policy | Series-type and monitor-type dropdowns with numbering/episode helpers; season-folders/default/4K/monitor/search/tag-existing toggles with visible consequence text; automatic-tag dropdown with routing/cleanup helper. |
| Placeholder roots | One text input per immutable Plex movie/show library key plus Browse button. Typed paths and selected paths are equivalent inputs. |
| Folder picker | Modal with current path, parent, mounted-root button, directory rows, loading/empty/error states, selected path, Select, and Cancel. Navigation cannot escape configured mounts. |
| YouTube cookies | Status panel: missing, ready, or present-but-disabled. Filename helper and setup instructions. Generic-trailer toggle. No cookie content is displayed. |
| Plex webhook | Copyable same-origin webhook URL, Plex Pass and Plex Settings path, exact play/stop/scrobble behavior, multipart/thumbnail explanation, duplicate-delivery guarantee, last event/status/time, and manual refresh. |
| Watchlist sync | Owner and all-user toggles; conditional movie/show destinations; server/profile/root dropdowns; creatable tag multi-select; username/monitor/search/season-folder toggles; last-sync status. |

## Step 6: review

Every entered value is grouped by setup step. Secrets display only
“configured.” Edit links return to the correct control. Blocking Plex/health
dependencies are distinct from optional source/download/default/watchlist
warnings. Validation can be rerun, activation requires explicit
acknowledgement, and backend activation revalidates the owner token and Plex
libraries. Activation has progress, conflict recovery, timestamped success, and
retry-safe
failure, and no partial enablement.
