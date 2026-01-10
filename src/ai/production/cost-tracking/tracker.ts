import type { AgentContext, AgentResponse } from "../../types/agent.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";

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

class CostTracker {
  private records: UsageRecord[] = [];
  private config: CostConfig;
  private dailyTotal = 0;
  private monthlyTotal = 0;
  private lastDayReset = Date.now();
  private lastMonthReset = Date.now();
  private resetInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: CostConfig) {
    this.config = config;
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

    // Parse provider from model string
    const provider = model.split("/")[0] || "unknown";

    // Calculate cost
    const cost = this.calculateCost(
      provider,
      response.usage.promptTokens,
      response.usage.completionTokens,
    );

    // Create record
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

    // Add to records
    this.records.push(record);

    // Update totals
    this.dailyTotal += cost;
    this.monthlyTotal += cost;

    // Check limits
    this.checkLimits();

    return record;
  }

  private calculateCost(
    provider: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const pricing = this.config.pricing[provider];

    if (!pricing) {
      agentLogger.warn(`No pricing configured for provider: ${provider}`);
      return 0;
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  getSummary(startTime?: number, endTime?: number): UsageSummary {
    const start = startTime || 0;
    const end = endTime || Date.now();

    const relevantRecords = this.records.filter(
      (r) => r.timestamp >= start && r.timestamp <= end,
    );

    const summary: UsageSummary = {
      requests: relevantRecords.length,
      tokens: {
        prompt: 0,
        completion: 0,
        total: 0,
      },
      cost: 0,
      byProvider: {},
      period: { start, end },
    };

    for (const record of relevantRecords) {
      summary.tokens.prompt += record.tokens.prompt;
      summary.tokens.completion += record.tokens.completion;
      summary.tokens.total += record.tokens.total;
      summary.cost += record.cost;

      const providerStats = summary.byProvider[record.provider] ??= {
        requests: 0,
        tokens: 0,
        cost: 0,
      };
      providerStats.requests++;
      providerStats.tokens += record.tokens.total;
      providerStats.cost += record.cost;
    }

    return summary;
  }

  getDailySummary(): UsageSummary {
    const now = Date.now();
    const dayStart = now - 24 * 60 * 60 * 1000;
    return this.getSummary(dayStart, now);
  }

  getMonthlySummary(): UsageSummary {
    const now = Date.now();
    const monthStart = now - 30 * 24 * 60 * 60 * 1000;
    return this.getSummary(monthStart, now);
  }

  private checkLimits(): void {
    if (this.config.limits?.daily && this.dailyTotal > this.config.limits.daily) {
      this.config.onLimitExceeded?.(this.getDailySummary());
    }

    if (this.config.limits?.monthly && this.monthlyTotal > this.config.limits.monthly) {
      this.config.onLimitExceeded?.(this.getMonthlySummary());
    }
  }

  private startPeriodicReset(): void {
    this.resetInterval = setInterval(() => {
      const now = Date.now();

      if (now - this.lastDayReset >= 24 * 60 * 60 * 1000) {
        this.dailyTotal = 0;
        this.lastDayReset = now;
      }

      if (now - this.lastMonthReset >= 30 * 24 * 60 * 60 * 1000) {
        this.monthlyTotal = 0;
        this.lastMonthReset = now;
      }
    }, 60000);
  }

  destroy(): void {
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
      this.resetInterval = null;
    }
    this.records = [];
  }

  private createEmptyRecord(agentId: string, model: string): UsageRecord {
    return {
      timestamp: Date.now(),
      agentId,
      model,
      provider: model.split("/")[0] || "unknown",
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

export function createCostTracker(config: CostConfig) {
  const tracker = new CostTracker(config);

  return {
    track: (agentId: string, model: string, response: AgentResponse, userId?: string): UsageRecord =>
      tracker.track(agentId, model, response, userId),
    getSummary: (startTime?: number, endTime?: number): UsageSummary =>
      tracker.getSummary(startTime, endTime),
    getDailySummary: (): UsageSummary => tracker.getDailySummary(),
    getMonthlySummary: (): UsageSummary => tracker.getMonthlySummary(),
    getAllRecords: (): UsageRecord[] => tracker.getAllRecords(),
    clear: (): void => tracker.clear(),
  };
}

export function costTrackingMiddleware(config: CostConfig) {
  const tracker = createCostTracker(config);

  return async (
    context: AgentContext,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> => {
    const result = await next();
    tracker.track(
      context.agentId,
      context.model || "unknown",
      result,
      (context.data as Record<string, unknown>)?.userId as string | undefined,
    );

    return result;
  };
}
