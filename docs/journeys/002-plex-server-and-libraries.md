# Journey 002: Plex server and libraries

## Legacy UI inventory

The Plex settings screen is reused both during onboarding and in Settings.

### Server preset

- User-triggered refresh requests owned Plex servers from Plex.tv.
- Every server connection is expanded into a selectable preset.
- When a connection URI hostname differs from its reported address, an
  additional direct connection is synthesized.
- Every candidate is probed with a five-second timeout.
- Candidates sort by reachable first, then secure first.
- Each option shows server name, address, local/remote, secure, and failure
  message.
- Unreachable candidates remain visible but disabled.
- Selecting a preset populates hostname, port, and SSL.
- Manual configuration is always available.

### Persisted inputs

| Field | Legacy behavior |
|---|---|
| Hostname/IP | Required; validated with a hostname-oriented regular expression |
| Port | Required numeric input; defaults to 32400 |
| Use SSL | Chooses HTTP or HTTPS |
| Plex Web App URL | Optional absolute URL; defaults visually to Plex Web |
| Automatically empty trash | Boolean; defaults true when absent |

### Derived values

- Server friendly name
- Plex machine identifier
- Discovered libraries

Derived values are server-owned and must never be accepted from client input.

### Save sequence

1. UI posts the five persisted inputs.
2. Backend immediately merges the request into live settings.
3. Backend loads the owner's Plex token.
4. Backend probes the configured Plex server.
5. Machine identifier and friendly name are copied from the response.
6. Settings are saved.
7. UI asynchronously starts library synchronization without awaiting it.
8. Onboarding enables Continue as soon as the settings request succeeds.

### Library synchronization

- The settings screen requests `GET /plex/library?sync=true`.
- A second `/plex/libraries` endpoint performs effectively the same operation.
- The API fetches Plex sections and writes them into settings.
- Library enable/disable controls were removed.
- Legacy synchronization status endpoints are stubs that always report idle.

## Problems corrected in Vynode

- Invalid draft settings can remain active in memory after a failed probe.
- The backend accepts arbitrary extra request fields through `Object.assign`.
- Port validation has no explicit integer range.
- The UI does not await library synchronization before marking setup complete.
- Two library-sync endpoints overlap.
- Failed library synchronization does not invalidate setup completion.
- Hostname validation is simultaneously too complicated and incomplete for
  IPv6.
- Connection errors expose raw internal/provider messages.
- There is no certificate policy beyond a boolean SSL switch.
- Preset refresh has transient toasts but no durable per-connection diagnostics.

## Vynode design

### Inputs

- Host: DNS name, IPv4, or bracketed/unbracketed IPv6; no scheme, credentials,
  path, query, or fragment.
- Port: integer from 1 through 65535.
- Transport: `http`, `https-verify`, or `https-allow-self-signed`.
- Plex Web URL: optional HTTP(S) URL.
- Automatic trash cleanup: explicit boolean, with a destructive-action warning.

### Save transaction

1. Parse a strict allow-listed request.
2. Normalize host and URLs.
3. Resolve the owner's encrypted Plex credential.
4. Probe the draft without modifying active configuration.
5. Verify the returned machine identifier.
6. Discover libraries from the same verified server.
7. Persist connection, identity, and library snapshot in one compare-and-set
   transaction.
8. Emit an audit event containing no token.
9. Return the committed revision and diagnostics.

Switching to a different machine identifier requires explicit confirmation when
an active server already exists.

### Library model

Libraries retain:

- stable Plex section key;
- title;
- media type;
- agent and scanner metadata when available;
- language;
- locations with paths treated as sensitive;
- last observation time;
- availability state.

Libraries that disappear are marked unavailable rather than immediately
deleted, preserving collection and overlay configuration for recovery.

## Acceptance scenarios

| ID | Scenario |
|---|---|
| PLEX-AC-001 | Owned servers and all connection candidates are discoverable |
| PLEX-AC-002 | Reachability diagnostics do not mutate active settings |
| PLEX-AC-003 | Manual DNS, IPv4, and IPv6 connections validate correctly |
| PLEX-AC-004 | Port and URL validation return field-specific errors |
| PLEX-AC-005 | A failed probe leaves the previous revision unchanged |
| PLEX-AC-006 | Successful save commits identity and libraries atomically |
| PLEX-AC-007 | Machine changes require confirmation |
| PLEX-AC-008 | Missing libraries are retained as unavailable |
| PLEX-AC-009 | Setup cannot advance until server and library discovery succeed |
| PLEX-AC-010 | Legacy Plex configuration and libraries import repeatably |
