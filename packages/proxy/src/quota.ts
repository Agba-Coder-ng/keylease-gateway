/**
 * On-chain quota commits.
 *
 * The verifier's local counter is a fast path, not the source of truth: a
 * second proxy instance would start from zero. When a gateway key is
 * configured, served calls are batched and committed to `keylease-core` with
 * `use_call`, so the lease's `calls_used` on chain reflects real traffic and
 * every proxy instance sees the same remaining quota.
 *
 * Commits are fire-and-forget from the request path: a failed commit is
 * reported through `onError` and retried on the next flush, never surfaced as
 * a 5xx to the caller (the chain stays authoritative for settlement).
 */
export interface CallCommitter {
  useCalls(leaseId: string, count: number): Promise<unknown>;
}

export interface QuotaSink {
  /** Records one served call for a lease. */
  record(leaseId: string): void;
  /** Commits everything pending. */
  flush(): Promise<void>;
  /** Stops the timer and commits whatever is left. */
  close(): Promise<void>;
  /** Pending (uncommitted) calls for a lease. */
  pendingFor(leaseId: string): number;
}

export interface OnChainQuotaOptions {
  committer: CallCommitter;
  /** Commit once this many calls are pending. Defaults to 50. */
  batchSize?: number;
  /** Maximum distinct leases tracked before an early flush. Defaults to 10 000. */
  maxTrackedLeases?: number;
  /** Periodic flush interval in ms; `0` disables the timer. Defaults to 10s. */
  flushIntervalMs?: number;
  /** Called when the lease bound triggers a flush or a commit fails. Failed counts are queued again. */
  onError?: (error: unknown, leaseId: string, count: number) => void;
}

export class QuotaCapacityWarning extends Error {
  constructor(maxTrackedLeases: number) {
    super(`maximum tracked leases (${maxTrackedLeases}) reached; flushing pending calls early`);
    this.name = 'QuotaCapacityWarning';
  }
}

export class OnChainQuota implements QuotaSink {
  private readonly committer: CallCommitter;
  private readonly batchSize: number;
  private readonly maxTrackedLeases: number;
  private readonly flushIntervalMs: number;
  private readonly onError: (error: unknown, leaseId: string, count: number) => void;
  private readonly pending = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: OnChainQuotaOptions) {
    this.committer = options.committer;
    this.batchSize = Math.max(1, options.batchSize ?? 50);
    const maxTrackedLeases = options.maxTrackedLeases ?? 10_000;
    if (!Number.isSafeInteger(maxTrackedLeases) || maxTrackedLeases <= 0) {
      throw new RangeError('maxTrackedLeases must be a positive safe integer');
    }
    this.maxTrackedLeases = maxTrackedLeases;
    this.flushIntervalMs = options.flushIntervalMs ?? 10_000;
    this.onError = options.onError ?? (() => {});
    if (this.flushIntervalMs > 0) {
      this.timer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      // Never keep the process alive just to flush quota.
      this.timer.unref?.();
    }
  }

  record(leaseId: string): void {
    if (!this.pending.has(leaseId) && this.pending.size >= this.maxTrackedLeases) {
      const [flushedLeaseId, count] = this.pending.entries().next().value!;
      void this.flush();
      this.onError(new QuotaCapacityWarning(this.maxTrackedLeases), flushedLeaseId, count);
    }

    const next = (this.pending.get(leaseId) ?? 0) + 1;
    this.pending.set(leaseId, next);
    if (this.totalPending() >= this.batchSize) {
      void this.flush();
    }
  }

  pendingFor(leaseId: string): number {
    return this.pending.get(leaseId) ?? 0;
  }

  /** Serialises flushes so two commits never overlap. */
  flush(): Promise<void> {
    const snapshot = [...this.pending.entries()];
    if (snapshot.length === 0) return this.queue;
    this.pending.clear();
    this.queue = this.queue.then(() => this.drain(snapshot));
    return this.queue;
  }

  async close(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private totalPending(): number {
    let total = 0;
    for (const count of this.pending.values()) total += count;
    return total;
  }

  private async drain(snapshot: Array<[string, number]>): Promise<void> {
    for (const [leaseId, count] of snapshot) {
      try {
        await this.committer.useCalls(leaseId, count);
      } catch (error) {
        this.pending.set(leaseId, (this.pending.get(leaseId) ?? 0) + count);
        this.onError(error, leaseId, count);
      }
    }
  }
}
