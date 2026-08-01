# Journey 003: Metadata sources

## Legacy inventory

The source step presents integrations independently; none is required to finish
setup. IMDb, TMDB, and Letterboxd work without credentials.

| Area | Inputs | Actions and states |
| --- | --- | --- |
| Fetching | Letterboxd plain HTTP, FlixPatrol plain HTTP | Save both toggles together. Browser automation remains the fallback when plain HTTP is disabled. |
| Trakt basic | Client ID | Test, then save only the exact tested value. Supports public endpoints without a user account. |
| Trakt OAuth | Client ID, client secret | Start browser authorization, accept callback/code, exchange tokens, show connected state, test, disconnect. Existing access and refresh tokens are retained when only the Client ID is updated. |
| MDBList | API key | Test, then save only the exact tested value. |
| MyAnimeList | Client ID (shown as API key in the legacy model) | Test, then save only the exact tested value. |
| Tautulli | Hostname, port (8181), SSL, URL base, external URL, API key | Test draft connection, then save the exact tested draft. |
| Maintainerr | Hostname, port (6246), SSL, URL base, external URL, API key | Test draft connection, then save the exact tested draft. |

Every test reports authentication, endpoint, DNS, refusal, timeout, and
rate-limit failures distinctly where the provider supports them. Seerr,
Radarr, and Sonarr belong to the next Downloads step.

## Improved behavioral contract

- A connection test never writes active configuration or rotates an active
  credential.
- Secrets are write-only. Reads return `secretConfigured`, never secret text.
- A successful test issues a short-lived verification receipt bound to a
  normalized fingerprint of the complete draft.
- Save requires the matching receipt and the expected configuration revision.
  Editing any tested field invalidates the receipt.
- Network inputs are normalized. Ports must be 1–65535, URL bases begin with
  `/`, and external URLs must be HTTP(S) without embedded credentials.
- Clearing a credential is an explicit destructive action, separate from
  submitting a blank/masked field.
- Trakt OAuth token exchange and refresh are server-owned. Browser responses
  never contain access or refresh tokens.
- The setup step can be skipped and revisited; configured integrations retain
  their independent state.

## Acceptance checks

1. Test all five integration shapes without changing active settings.
2. Reject save without a valid receipt, after a draft edit, or at a stale
   revision.
3. Never return API keys, client secrets, or OAuth tokens.
4. Preserve external URLs independently from internal service endpoints.
5. Allow an optional source to be disconnected without affecting another.
6. Complete the onboarding stage with zero configured sources.
