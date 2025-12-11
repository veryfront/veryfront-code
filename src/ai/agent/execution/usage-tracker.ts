
export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

export class UsageTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private totalTokens = 0;
  private callCount = 0;

  add(usage: ProviderUsage | undefined): void {
    if (!usage) return;

    this.promptTokens += usage.promptTokens ?? 0;
    this.completionTokens += usage.completionTokens ?? 0;
    this.totalTokens += usage.totalTokens ?? 0;
    this.callCount++;
  }

  getTotal(): UsageStats {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      callCount: this.callCount,
    };
  }

  reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
    this.callCount = 0;
  }

  hasUsage(): boolean {
    return this.callCount > 0;
  }
}

export function createUsageTracker(): UsageTracker {
  return new UsageTracker();
}
