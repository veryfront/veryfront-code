/**
 * Usage Tracker
 *
 * Tracks token usage across multiple LLM provider calls within an agent execution.
 */

/**
 * Usage statistics from a single provider call
 */
export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Aggregated usage statistics
 */
export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

/**
 * Tracks token usage across multiple LLM calls.
 *
 * Usage:
 * ```ts
 * const tracker = new UsageTracker();
 * tracker.add(response.usage);
 * tracker.add(response2.usage);
 * const total = tracker.getTotal();
 * ```
 */
export class UsageTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private callCount = 0;

  /**
   * Add usage from a provider response.
   * Safely handles undefined values.
   */
  add(usage: ProviderUsage | undefined): void {
    if (!usage) return;

    this.promptTokens += usage.promptTokens ?? 0;
    this.completionTokens += usage.completionTokens ?? 0;
    this.totalTokens += usage.totalTokens ?? 0;
    this.callCount++;
  }

  /**
   * Get aggregated usage statistics.
   */
  getTotal(): UsageStats {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      callCount: this.callCount,
    };
  }

  /**
   * Reset all counters.
   */
  reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.callCount = 0;
  }

  /**
   * Check if any usage has been tracked.
   */
  hasUsage(): boolean {
    return this.callCount > 0;
  }
}

/**
 * Create a new usage tracker instance.
 */
export function createUsageTracker(): UsageTracker {
  return new UsageTracker();
}
