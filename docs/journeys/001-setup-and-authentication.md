# Journey 001: setup and authentication

This document traces the legacy first-run and returning-user flows from UI event
to persisted state. It is the acceptance specification for the replacement.

## Entry routing

1. Every server-rendered page requests `GET /api/v1/settings/public`.
2. When `initialized` is false, every route except setup and the Plex popup is
   redirected to `/setup`.
3. When initialized, the server attempts `GET /api/v1/auth/me` using the
   incoming session cookie.
4. An authenticated user visiting setup or login is redirected home.
5. An unauthenticated user visiting any protected page is redirected to login.
6. Client navigation revalidates the current user and repeats the protection.

### Existing weaknesses to improve

- Routing depends on a network call from the application to itself.
- Setup progress exists only in React memory and is lost on refresh.
- Route checks are duplicated between server rendering and client effects.
- Matching routes with regular expressions can accidentally match unintended
  paths.

### Vynode requirement

Use explicit route policy metadata and persisted onboarding state. Server and
client consume the same authorization decision. Refreshing or reopening the
browser resumes the last valid step.

## Plex sign-in control

### Legacy browser behavior

1. User presses `Sign In`.
2. A blank 600x700 popup opens immediately to avoid popup blocking.
3. After a fixed 1.5 second delay, browser metadata and a persistent random
   Plex client identifier are assembled.
4. The browser creates a strong Plex PIN.
5. The popup navigates to Plex authentication with device context.
6. The parent polls the PIN every second.
7. On success, the popup closes and the token is posted to the server.
8. Closing the popup rejects authentication.

### Inputs and local state

- User gesture
- Browser and operating-system description
- Screen resolution
- `plex-client-id` in local storage
- Plex PIN ID and code
- Temporary Plex authentication token

### Existing weaknesses to improve

- Setup does not display authentication errors.
- Popup failure is silent unless a caller supplies `onError`.
- There is no timeout or cancellation signal for polling.
- The fixed 1.5 second delay is arbitrary.
- Plex branding is embedded in protocol metadata.
- A long-lived Plex token passes through browser JavaScript.

### Vynode requirement

The server owns PIN creation and polling. The browser receives an opaque login
attempt ID, opens Plex, and follows server-sent status events. Attempts expire,
can be cancelled, expose accessible progress, and never return the Plex token
to browser code.

## Server-side Plex authentication

### First user

1. Validate that a token exists.
2. Retrieve the Plex account.
3. Search users by Plex ID or case-insensitive email.
4. If no users exist, create the owner with administrative permissions.
5. Persist Plex username, title, ID, token, avatar, email, Plex Pass state, and
   account type.
6. Persist owner username/title for template variables.
7. Store the user ID in the session.

### Returning or shared user

1. Load the owner and use the owner's token to check server access.
2. Permit the owner, an email match for legacy records, or a shared user.
3. Update an existing user's Plex profile and token.
4. If no user exists, create one only when new Plex login is enabled.
5. Deny users without access or users who have not been imported when automatic
   creation is disabled.
6. Establish the session.

### Error behavior

- Missing token currently produces an internal-server-error response.
- Missing Plex ID, Plex failures, and unexpected exceptions return generic
  authentication errors.
- Access failures return forbidden.
- Security-relevant failures are logged with IP and account identifiers.

### Vynode requirement

- Missing/invalid input returns 400; invalid credentials return 401; valid Plex
  users without authorization return 403; provider outage returns 503.
- Owner creation is transactional and race-safe.
- Identity matching records evidence and never merges accounts solely from an
  unverified mutable email address.
- Tokens are encrypted at rest and replaced atomically.
- Sessions rotate after authentication.
- Authorization uses roles and server scopes rather than a numeric permission
  bitmask alone.
- Audit events never contain tokens or sensitive provider responses.

## Four-step onboarding

### Step 1: Plex account

- Title and explanatory copy
- Plex authentication control
- Automatic advance after `/auth/me` returns a user

### Step 2: Plex server

- Reuses the complete Plex settings screen.
- Continue remains disabled until that component reports completion.

### Step 3: metadata sources

- Reuses the complete source settings screen.
- All sources are optional.
- Continue is always available; child completion is ignored.

### Step 4: downloads

- Reuses the complete download settings screen.
- Download services are optional.
- Finish posts initialization, then saves the selected locale, refreshes public
  settings, and navigates home.

### Cross-cutting UI state

- Current step
- Plex-step completion
- Finish-in-progress state
- Selected locale
- Application-data volume warning
- Scroll position adjustment after each step

### Existing weaknesses to improve

- Initialization is saved before locale; failure can leave partial completion.
- Source/download saves are separate and onboarding has no transaction summary.
- There is no explicit back action, skip labeling, final review, test summary,
  or resume support.
- Completion callbacks are inconsistent and some are intentionally ignored.
- Failed finish requests have no visible error handling.
- Accessibility semantics are visual rather than a true stepper.

### Vynode requirement

The redesigned setup has six persisted stages:

1. Welcome and deployment health
2. Owner authentication
3. Media-server selection and libraries
4. Metadata sources
5. Requests/download services
6. Review, connectivity test, and atomic activation

Optional stages are explicitly skippable. Activation is atomic: either the
validated configuration and locale become active together or onboarding
remains incomplete with a repairable error.

## Logout

Legacy logout destroys the server session and returns success. Vynode also
revokes the session record, clears the cookie, records an audit event, and
supports revoking all sessions from account security settings.

## Data migration

The importer maps:

- owner and shared Plex identities;
- Plex account metadata;
- encrypted Plex tokens;
- locale and automatic Plex-login policy;
- application initialization state;
- sessions are intentionally not imported.

No legacy token is deleted until the user validates the imported installation.

## Acceptance scenarios

| ID | Scenario |
|---|---|
| AUTH-AC-001 | New installation always enters resumable onboarding |
| AUTH-AC-002 | First valid Plex account becomes the owner exactly once |
| AUTH-AC-003 | Popup blocked, closed, expired, denied, and provider-down states are actionable |
| AUTH-AC-004 | Shared Plex user access follows owner policy |
| AUTH-AC-005 | Token rotation preserves the identity and revokes the old secret |
| AUTH-AC-006 | Protected routes cannot flash or return protected content |
| AUTH-AC-007 | Activation cannot persist a half-configured installation |
| AUTH-AC-008 | Refresh resumes the last valid onboarding stage |
| AUTH-AC-009 | Logout invalidates the server session and cookie |
| AUTH-AC-010 | Legacy identity/settings import is repeatable and non-destructive |
