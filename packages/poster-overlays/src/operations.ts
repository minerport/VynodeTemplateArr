export type PosterOperationKind =
  | 'apply-overlays'
  | 'download-base-posters'
  | 'generate-local-folders'
  | 'populate-local-posters'
  | 'reset-posters';

export class PosterOperationConflictError extends Error {
  public constructor(
    public readonly requested: PosterOperationKind,
    public readonly running: PosterOperationKind
  ) {
    super(`Cannot start ${requested} while ${running} is already running.`);
  }
}

export class PosterOperationCoordinator {
  private active: PosterOperationKind | undefined;

  public running(): PosterOperationKind | undefined {
    return this.active;
  }

  public acquire(kind: PosterOperationKind): () => void {
    if (this.active) throw new PosterOperationConflictError(kind, this.active);
    this.active = kind;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.active === kind) this.active = undefined;
    };
  }

  public async run<T>(
    kind: PosterOperationKind,
    operation: () => Promise<T>
  ): Promise<T> {
    const release = this.acquire(kind);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
