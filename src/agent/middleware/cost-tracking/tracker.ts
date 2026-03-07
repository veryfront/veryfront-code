import type { AgentContext, AgentResponse } from "../../types.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const RESET_CHECK_INTERVAL_MS = 60_000;

export interface CostConfig {
  /** Provider pricing (cost per 1M tokens) */
  pricing: {
    [provider: string]: {
      input: number;
      output: number;
    };
  };
  limits?: {
    daily?: number;
    monthly?: number;
  };
  onLimitExceeded?: (usage: UsageSummary) => void;
}

export interface UsageRecord {
  timestamp: number;
  agentId: string;
  model: string;
  provider: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: number;
  userId?: string;
}

export interface UsageSummary {
  requests: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: number;
  byProvider: Record<
    string,
    {
      requests: number;
      tokens: number;
      cost: number;
    }
  >;
  period: {
    start: number;
    end: number;
  };
}

function getProvider(model: string): string {
  return model.split("/")[0] || "unknown";
}

class CostTracker {
  private records: UsageRecord[] = [];
  private dailyTotal = 0;
  private monthlyTotal = 0;
  private lastDayReset = Date.now();
  private lastMonthReset = Date.now();
  private resetInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private config: CostConfig) {
    this.startPeriodicReset();
  }

  track(
    agentId: string,
    model: string,
    response: AgentResponse,
    userId?: string,
  ): UsageRecord {
    if (!response.usage) {
      agentLogger.warn("No usage data in response, cannot track costs");
      return this.createEmptyRecord(agentId, model);
    }

    const provider = getProvider(model);
    const cost = this.calculateCost(
      provider,
      response.usage.promptTokens,
      response.usage.completionTokens,
    );

    const record: UsageRecord = {
      timestamp: Date.now(),
      agentId,
      model,
      provider,
      tokens: {
        prompt: response.usage.promptTokens,
        completion: response.usage.completionTokens,
        total: response.usage.totalTokens,
      },
      cost,
      userId,
    };

    this.records.push(record);
    this.dailyTotal += cost;
    this.monthlyTotal += cost;
    this.checkLimits();

    return record;
  }

  private calculateCost(provider: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.config.pricing[provider];
    if (!pricing) {
      agentLogger.warn(`No pricing configured for provider: ${provider}`);
      return 0;
    }

    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  }

  getSummary(startTime?: number, endTime?: number): UsageSummary {
    const start = startTime ?? 0;
    const end = endTime ?? Date.now();

    const summary: UsageSummary = {
      requests: 0,
      tokens: { prompt: 0, completion: 0, total: 0 },
      cost: 0,
      byProvider: {},
      period: { start, end },
    };

    for (const record of this.records) {
      if (record.timestamp < start || record.timestamp > end) continue;

      summary.requests++;
      summary.tokens.prompt += record.tokens.prompt;
      summary.tokens.completion += record.tokens.completion;
      summary.tokens.total += record.tokens.total;
      summary.cost += record.cost;

      const providerStats = (summary.byProvider[record.provider] ??= {
        requests: 0,
        tokens: 0,
        cost: 0,
      });

      providerStats.requests++;
      providerStats.tokens += record.tokens.total;
      providerStats.cost += record.cost;
    }

    return summary;
  }

  getDailySummary(): UsageSummary {
    const now = Date.now();
    return this.getSummary(now - ONE_DAY_MS, now);
  }

  getMonthlySummary(): UsageSummary {
    const now = Date.now();
    return this.getSummary(now - THIRTY_DAYS_MS, now);
  }

  private checkLimits(): void {
    const dailyLimit = this.config.limits?.daily;
    if (dailyLimit && this.dailyTotal > dailyLimit) {
      this.config.onLimitExceeded?.(this.getDailySummary());
    }

    const monthlyLimit = this.config.limits?.monthly;
    if (monthlyLimit && this.monthlyTotal > monthlyLimit) {
      this.config.onLimitExceeded?.(this.getMonthlySummary());
    }
  }

  private startPeriodicReset(): void {
    this.resetInterval = setInterval(() => {
      const now = Date.now();

      if (now - this.lastDayReset >= ONE_DAY_MS) {
        this.dailyTotal = 0;
        this.lastDayReset = now;
      }

      if (now - this.lastMonthReset >= THIRTY_DAYS_MS) {
        this.monthlyTotal = 0;
        this.lastMonthReset = now;
      }
    }, RESET_CHECK_INTERVAL_MS);
  }

  destroy(): void {
    if (!this.resetInterval) return;

    clearInterval(this.resetInterval);
    this.resetInterval = null;
    this.records = [];
  }

  private createEmptyRecord(agentId: string, model: string): UsageRecord {
    return {
      timestamp: Date.now(),
      agentId,
      model,
      provider: getProvider(model),
      tokens: { prompt: 0, completion: 0, total: 0 },
      cost: 0,
    };
  }

  getAllRecords(): UsageRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
    this.dailyTotal = 0;
    this.monthlyTotal = 0;
  }
}

export function createCostTracker(config: CostConfig): {
  track: (agentId: string, model: string, response: AgentResponse, userId?: string) => UsageRecord;
  getSummary: (startTime?: number, endTime?: number) => UsageSummary;
  getDailySummary: () => UsageSummary;
  getMonthlySummary: () => UsageSummary;
  getAllRecords: () => UsageRecord[];
  clear: () => void;
} {
  const tracker = new CostTracker(config);

  return {
    track: tracker.track.bind(tracker),
    getSummary: tracker.getSummary.bind(tracker),
    getDailySummary: tracker.getDailySummary.bind(tracker),
    getMonthlySummary: tracker.getMonthlySummary.bind(tracker),
    getAllRecords: tracker.getAllRecords.bind(tracker),
    clear: tracker.clear.bind(tracker),
  };
}

export function costTrackingMiddleware(
  config: CostConfig,
): (context: AgentContext, next: () => Promise<AgentResponse>) => Promise<AgentResponse> {
  const tracker = createCostTracker(config);

  return async (context, next): Promise<AgentResponse> => {
    const result = await next();
    tracker.track(
      context.agentId,
      context.model || "unknown",
      result,
      (context.data as { userId?: string } | undefined)?.userId,
    );
    return result;
  };
}
