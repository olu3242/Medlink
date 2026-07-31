import { AsyncLocalStorage } from "node:async_hooks";
import { RuntimeError } from "./index";

export interface Transaction {
  readonly id: string;
  readonly correlationId: string;
  readonly attempt: number;
}

export interface TransactionDriver {
  begin(input: {
    correlationId: string;
    attempt: number;
    timeoutMs: number;
  }): Promise<Transaction>;
  commit(transaction: Transaction): Promise<void>;
  rollback(transaction: Transaction, cause: unknown): Promise<void>;
}

export interface TransactionOptions {
  correlationId: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryable?(error: unknown): boolean;
}

export class TransactionManager {
  private readonly active = new AsyncLocalStorage<Transaction>();

  constructor(private readonly driver: TransactionDriver) {}

  current(): Transaction | undefined {
    return this.active.getStore();
  }

  async run<T>(
    options: TransactionOptions,
    work: (transaction: Transaction, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const nested = this.current();
    if (nested) {
      if (nested.correlationId !== options.correlationId) {
        throw new RuntimeError(
          "infrastructure",
          "nested_transaction_context_mismatch",
          "Nested transaction context is invalid",
          500,
        );
      }
      return work(nested, AbortSignal.timeout(options.timeoutMs ?? 10_000));
    }

    const attempts = Math.max(1, options.maxAttempts ?? 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const timeoutMs = options.timeoutMs ?? 10_000;
      const transaction = await this.driver.begin({
        correlationId: options.correlationId,
        attempt,
        timeoutMs,
      });
      try {
        const value = await this.active.run(transaction, () =>
          work(transaction, AbortSignal.timeout(timeoutMs)));
        await this.driver.commit(transaction);
        return value;
      } catch (error) {
        await this.driver.rollback(transaction, error);
        if (attempt >= attempts || !options.retryable?.(error)) throw error;
      }
    }
    throw new RuntimeError(
      "system_failure",
      "transaction_attempts_exhausted",
      "The transaction could not be completed",
      500,
      true,
    );
  }
}

export interface DeadLetter<T> {
  eventId: string;
  payload: T;
  errorCode: string;
  retryCount: number;
}

export interface RecoveryStore<T> {
  retry(eventId: string, availableAt: Date, errorCode: string): Promise<void>;
  deadLetter(value: DeadLetter<T>): Promise<void>;
}

export class RecoveryPolicy<T> {
  constructor(
    private readonly store: RecoveryStore<T>,
    private readonly maxAttempts = 5,
    private readonly baseDelayMs = 1_000,
  ) {}

  async failure(value: DeadLetter<T>, now = new Date()): Promise<"retry" | "dead_letter"> {
    if (value.retryCount >= this.maxAttempts) {
      await this.store.deadLetter(value);
      return "dead_letter";
    }
    const delay = this.baseDelayMs * 2 ** value.retryCount;
    await this.store.retry(
      value.eventId,
      new Date(now.valueOf() + delay),
      value.errorCode,
    );
    return "retry";
  }
}
