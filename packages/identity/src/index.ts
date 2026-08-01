import { randomUUID } from 'node:crypto';

import type {
  AuthorizationContext,
  AuthorizationDecision,
  RoutePolicy,
  UserRole,
} from '@vynode/contracts';

export * from './plex-cloud.js';

export interface PlexLoginAttempt {
  id: string;
  state:
    | 'pending'
    | 'authorized'
    | 'denied'
    | 'expired'
    | 'cancelled'
    | 'failed';
  authorizationUrl: string;
  createdAt: string;
  expiresAt: string;
  userId?: string;
  failureCode?:
    | 'provider-unavailable'
    | 'provider-rejected'
    | 'access-denied'
    | 'identity-conflict'
    | 'internal';
}

export interface PlexPin {
  providerPinId: string;
  code: string;
  authorizationUrl: string;
  expiresAt: string;
}

export interface PlexAccount {
  id: string;
  email: string;
  username: string;
  title?: string;
  avatarUrl?: string;
  hasPlexPass: boolean;
}

export interface AuthorizedPlexAccount {
  account: PlexAccount;
  token: string;
}

export interface PlexAuthProvider {
  createPin(signal?: AbortSignal): Promise<PlexPin>;
  pollPin(
    providerPinId: string,
    signal?: AbortSignal
  ): Promise<AuthorizedPlexAccount | undefined>;
  accountForToken(
    token: string,
    signal?: AbortSignal
  ): Promise<PlexAccount>;
}

export interface SecretVault {
  store(secret: string): Promise<string>;
  replace(reference: string, secret: string): Promise<string>;
}

export interface IdentityRecord {
  id: string;
  role: UserRole;
  plexAccountId: string;
  verifiedEmail: string;
  plexUsername: string;
  plexTitle?: string;
  avatarUrl?: string;
  hasPlexPass: boolean;
  tokenReference: string;
}

export interface IdentityRepository {
  count(): Promise<number>;
  findByPlexAccountId(plexAccountId: string): Promise<IdentityRecord | undefined>;
  findById(id: string): Promise<IdentityRecord | undefined>;
  save(record: IdentityRecord): Promise<void>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
}

export interface SessionRepository {
  rotateForUser(
    previousSessionId: string | undefined,
    userId: string
  ): Promise<{ sessionId: string; expiresAt: string }>;
  revoke(sessionId: string): Promise<void>;
}

export interface PlexAccessPolicy {
  canSignIn(
    account: PlexAccount,
    owner: IdentityRecord | undefined
  ): Promise<boolean>;
  allowAutomaticSharedUserCreation(): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

const roleRank: Record<UserRole, number> = {
  viewer: 0,
  operator: 1,
  administrator: 2,
  owner: 3,
};

export const authorizeRoute = (
  policy: RoutePolicy,
  context: AuthorizationContext
): AuthorizationDecision => {
  if (
    policy.onboarding === 'incomplete-only' &&
    context.onboardingActivated
  ) {
    return {
      allowed: false,
      status: 302,
      reason: 'onboarding-complete',
      redirectTo: '/',
    };
  }
  if (
    policy.onboarding === 'activated-only' &&
    !context.onboardingActivated
  ) {
    return {
      allowed: false,
      status: 302,
      reason: 'onboarding-required',
      redirectTo: '/setup',
    };
  }
  if (policy.authentication === 'anonymous-only' && context.principal) {
    return {
      allowed: false,
      status: 302,
      reason: 'already-authenticated',
      redirectTo: '/',
    };
  }
  if (policy.authentication === 'authenticated' && !context.principal) {
    return {
      allowed: false,
      status: 401,
      reason: 'authentication-required',
      redirectTo: '/login',
    };
  }
  if (
    context.principal &&
    policy.roles &&
    !policy.roles.some(
      (required) =>
        roleRank[context.principal!.role] >= roleRank[required]
    )
  ) {
    return { allowed: false, status: 403, reason: 'insufficient-role' };
  }
  return { allowed: true };
};

export class PlexLoginService {
  readonly #attempts = new Map<
    string,
    PlexLoginAttempt & { providerPinId: string }
  >();

  public constructor(
    private readonly provider: PlexAuthProvider,
    private readonly identities: IdentityRepository,
    private readonly sessions: SessionRepository,
    private readonly secrets: SecretVault,
    private readonly access: PlexAccessPolicy,
    private readonly clock: Clock
  ) {}

  public async begin(signal?: AbortSignal): Promise<PlexLoginAttempt> {
    const pin = await this.provider.createPin(signal);
    const attempt = {
      id: randomUUID(),
      state: 'pending' as const,
      authorizationUrl: pin.authorizationUrl,
      createdAt: this.clock.now().toISOString(),
      expiresAt: pin.expiresAt,
      providerPinId: pin.providerPinId,
    };
    this.#attempts.set(attempt.id, attempt);
    return this.publicAttempt(attempt);
  }

  public get(attemptId: string): PlexLoginAttempt | undefined {
    const attempt = this.#attempts.get(attemptId);
    return attempt ? this.publicAttempt(attempt) : undefined;
  }

  public cancel(attemptId: string): PlexLoginAttempt | undefined {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt || attempt.state !== 'pending') return undefined;
    const cancelled = { ...attempt, state: 'cancelled' as const };
    this.#attempts.set(attemptId, cancelled);
    return this.publicAttempt(cancelled);
  }

  public async poll(
    attemptId: string,
    previousSessionId?: string,
    signal?: AbortSignal
  ): Promise<
    | { attempt: PlexLoginAttempt }
    | {
        attempt: PlexLoginAttempt;
        session: { sessionId: string; expiresAt: string };
      }
  > {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt) throw new Error('Login attempt not found');
    if (attempt.state !== 'pending') {
      return { attempt: this.publicAttempt(attempt) };
    }
    if (this.clock.now() >= new Date(attempt.expiresAt)) {
      const expired = { ...attempt, state: 'expired' as const };
      this.#attempts.set(attemptId, expired);
      return { attempt: this.publicAttempt(expired) };
    }

    const authorized = await this.provider.pollPin(
      attempt.providerPinId,
      signal
    );
    if (!authorized) return { attempt: this.publicAttempt(attempt) };

    return this.completeAuthorization(
      attempt,
      authorized,
      previousSessionId
    );
  }

  public async signInWithToken(
    token: string,
    previousSessionId?: string,
    signal?: AbortSignal
  ): Promise<{
    account: PlexAccount;
    session: { sessionId: string; expiresAt: string };
  }> {
    const normalized = token.trim();
    if (!normalized) throw new Error('Plex token is required');
    const account = await this.provider.accountForToken(normalized, signal);
    const attempt = {
      id: randomUUID(),
      state: 'pending' as const,
      authorizationUrl: '',
      createdAt: this.clock.now().toISOString(),
      expiresAt: new Date(
        this.clock.now().getTime() + 60_000
      ).toISOString(),
      providerPinId: 'manual',
    };
    const result = await this.completeAuthorization(
      attempt,
      { account, token: normalized },
      previousSessionId
    );
    if (!('session' in result)) throw new Error('Plex account is not allowed');
    return { account, session: result.session };
  }

  private async completeAuthorization(
    attempt: PlexLoginAttempt & { providerPinId: string },
    authorized: AuthorizedPlexAccount,
    previousSessionId?: string
  ): Promise<
    | { attempt: PlexLoginAttempt }
    | {
        attempt: PlexLoginAttempt;
        session: { sessionId: string; expiresAt: string };
      }
  > {
    return this.identities.transaction(async () => {
      const userCount = await this.identities.count();
      const owner = await this.identities.findById('owner');
      const existing = await this.identities.findByPlexAccountId(
        authorized.account.id
      );

      if (
        userCount > 0 &&
        !(await this.access.canSignIn(authorized.account, owner))
      ) {
        const denied = {
          ...attempt,
          state: 'denied' as const,
          failureCode: 'access-denied' as const,
        };
        this.#attempts.set(attempt.id, denied);
        return { attempt: this.publicAttempt(denied) };
      }

      if (
        userCount > 0 &&
        !existing &&
        !(await this.access.allowAutomaticSharedUserCreation())
      ) {
        const denied = {
          ...attempt,
          state: 'denied' as const,
          failureCode: 'access-denied' as const,
        };
        this.#attempts.set(attempt.id, denied);
        return { attempt: this.publicAttempt(denied) };
      }

      const tokenReference = existing
        ? await this.secrets.replace(
            existing.tokenReference,
            authorized.token
          )
        : await this.secrets.store(authorized.token);
      const userId = existing?.id ?? (userCount === 0 ? 'owner' : randomUUID());
      const identity: IdentityRecord = {
        id: userId,
        role: existing?.role ?? (userCount === 0 ? 'owner' : 'viewer'),
        plexAccountId: authorized.account.id,
        verifiedEmail: authorized.account.email.toLowerCase(),
        plexUsername: authorized.account.username,
        hasPlexPass: authorized.account.hasPlexPass,
        tokenReference,
        ...(authorized.account.title
          ? { plexTitle: authorized.account.title }
          : {}),
        ...(authorized.account.avatarUrl
          ? { avatarUrl: authorized.account.avatarUrl }
          : {}),
      };
      await this.identities.save(identity);
      const session = await this.sessions.rotateForUser(
        previousSessionId,
        userId
      );
      const completed = {
        ...attempt,
        state: 'authorized' as const,
        userId,
      };
      this.#attempts.set(attempt.id, completed);
      return { attempt: this.publicAttempt(completed), session };
    });
  }

  private publicAttempt(
    attempt: PlexLoginAttempt & { providerPinId?: string }
  ): PlexLoginAttempt {
    const { providerPinId: _providerPinId, ...publicAttempt } = attempt;
    return publicAttempt;
  }
}
