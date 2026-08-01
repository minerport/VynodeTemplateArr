export const onboardingStages = [
  'deployment',
  'owner',
  'media-server',
  'sources',
  'downloads',
  'review',
] as const;

export type OnboardingStage = (typeof onboardingStages)[number];

export interface OnboardingState {
  installationId: string;
  revision: number;
  stage: OnboardingStage;
  completed: readonly OnboardingStage[];
  skipped: readonly Extract<OnboardingStage, 'sources' | 'downloads'>[];
  activatedAt?: string;
}

const prerequisites: Record<OnboardingStage, readonly OnboardingStage[]> = {
  deployment: [],
  owner: ['deployment'],
  'media-server': ['deployment', 'owner'],
  sources: ['deployment', 'owner', 'media-server'],
  downloads: ['deployment', 'owner', 'media-server'],
  review: ['deployment', 'owner', 'media-server', 'sources', 'downloads'],
};

export type OnboardingEvent =
  | { type: 'complete'; stage: OnboardingStage }
  | { type: 'skip'; stage: 'sources' | 'downloads' }
  | { type: 'navigate'; stage: OnboardingStage }
  | { type: 'activate'; activatedAt: string };

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const isSatisfied = (
  state: OnboardingState,
  stage: OnboardingStage
): boolean =>
  state.completed.includes(stage) ||
  state.skipped.includes(stage as 'sources' | 'downloads');

const canEnter = (
  state: OnboardingState,
  stage: OnboardingStage
): boolean =>
  prerequisites[stage].every((required) => isSatisfied(state, required));

export const createOnboardingState = (
  installationId: string
): OnboardingState => ({
  installationId,
  revision: 0,
  stage: 'deployment',
  completed: [],
  skipped: [],
});

export const applyOnboardingEvent = (
  state: OnboardingState,
  event: OnboardingEvent
): OnboardingState => {
  if (state.activatedAt) {
    throw new Error('Activated onboarding cannot be modified');
  }

  if (event.type === 'navigate') {
    if (!canEnter(state, event.stage)) {
      throw new Error(`Prerequisites for ${event.stage} are incomplete`);
    }
    return { ...state, revision: state.revision + 1, stage: event.stage };
  }

  if (event.type === 'skip') {
    if (state.stage !== event.stage) {
      throw new Error(`Cannot skip ${event.stage} from ${state.stage}`);
    }
    return {
      ...state,
      revision: state.revision + 1,
      skipped: unique([...state.skipped, event.stage]),
    };
  }

  if (event.type === 'complete') {
    if (state.stage !== event.stage) {
      throw new Error(`Cannot complete ${event.stage} from ${state.stage}`);
    }
    return {
      ...state,
      revision: state.revision + 1,
      completed: unique([...state.completed, event.stage]),
    };
  }

  if (!onboardingStages.every((stage) => isSatisfied(state, stage))) {
    throw new Error('Every onboarding stage must be completed or skipped');
  }
  if (state.stage !== 'review') {
    throw new Error('Onboarding can only be activated from review');
  }

  return {
    ...state,
    revision: state.revision + 1,
    activatedAt: event.activatedAt,
  };
};

export const nextOnboardingStage = (
  state: OnboardingState
): OnboardingStage | undefined =>
  onboardingStages.find((stage) => !isSatisfied(state, stage));

export interface OnboardingRepository {
  get(): Promise<OnboardingState>;
  compareAndSet(
    expectedRevision: number,
    next: OnboardingState
  ): Promise<boolean>;
}

export class OnboardingService {
  public constructor(private readonly repository: OnboardingRepository) {}

  public get(): Promise<OnboardingState> {
    return this.repository.get();
  }

  public async apply(
    expectedRevision: number,
    event: OnboardingEvent
  ): Promise<OnboardingState> {
    const current = await this.repository.get();
    if (current.revision !== expectedRevision) {
      throw new OnboardingConflictError(current);
    }
    const next = applyOnboardingEvent(current, event);
    if (!(await this.repository.compareAndSet(expectedRevision, next))) {
      throw new OnboardingConflictError(await this.repository.get());
    }
    return next;
  }
}

export class OnboardingConflictError extends Error {
  public constructor(public readonly current: OnboardingState) {
    super('Onboarding state changed; reload and retry');
  }
}
