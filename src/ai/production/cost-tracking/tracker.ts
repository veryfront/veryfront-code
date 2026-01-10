/**
 * Cost Tracking System
 *
 * Track API usage and costs for monitoring and billing.
 */

import type { AgentContext, AgentResponse } from "../../types/agent.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";

export interface CostConfig {
  /** Provider pricing (per 1M tokens) */
  pricing: {
    [provider: string]: {
      input: number; // Cost per 1M input tokens
      output: number; // Cost per 1M output tokens
    };
  };

  /** Budget limits */
  limits?: {
    daily?: number;
    monthly?: number;
  };

  /** Callback when limit exceeded */
  onLimitExceeded?: (usage: UsageSummary) => void;
}

export interface UsageRecord {
  /** Timestamp */
  timestamp: number;

  /** Agent ID */
  agentId: string;

  /** Model used */
  model: string;

  /** Provider */
  provider: string;

  /** Token usage */
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };

  /** Estimated cost */
  cost: number;

  /** User/session identifier */
  userId?: string;
}

export interface UsageSummary {
  /** Total requests */
  requests: number;

  /** Total tokens */
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };

  /** Total cost */
  cost: number;

  /** Cost by provider */
  byProvider: Record<
    string,
    {
      requests: number;
      tokens: number;
      cost: number;
    }
  >;

  /** Period */
  period: {
    start: number;
    end: number;
  };
}

/**
 * Cost Tracker
 */
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

  /**
   * Track an agent response
   */
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

  /**
   * Calculate cost based on token usage
   */
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

  /**
   * Get usage summary for a period
   */
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

  /**
   * Get daily summary
   */
  getDailySummary(): UsageSummary {
    const now = Date.now();
    const dayStart = now - 24 * 60 * 60 * 1000;
    return this.getSummary(dayStart, now);
  }

  /**
   * Get monthly summary
   */
  getMonthlySummary(): UsageSummary {
    const now = Date.now();
    const monthStart = now - 30 * 24 * 60 * 60 * 1000;
    return this.getSummary(monthStart, now);
  }

  /**
   * Check if limits are exceeded
   */
  private checkLimits(): void {
    if (this.config.limits?.daily && this.dailyTotal > this.config.limits.daily) {
      if (this.config.onLimitExceeded) {
        this.config.onLimitExceeded(this.getDailySummary());
      }
    }

    if (
      this.config.limits?.monthly &&
      this.monthlyTotal > this.config.limits.monthly
    ) {
      if (this.config.onLimitExceeded) {
        this.config.onLimitExceeded(this.getMonthlySummary());
      }
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

  /**
   * Create empty record
   */
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

  /**
   * Get all records
   */
  getAllRecords(): UsageRecord[] {
    return [...this.records];
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records = [];
    this.dailyTotal = 0;
    this.monthlyTotal = 0;
  }
}

/**
 * Create a cost tracker
 */
export function createCostTracker(config: CostConfig) {
  const tracker = new CostTracker(config);

  return {
    /**
     * Track agent response
     */
    track(
      agentId: string,
      model: string,
      response: AgentResponse,
      userId?: string,
    ): UsageRecord {
      return tracker.track(agentId, model, response, userId);
    },

    /**
     * Get usage summary
     */
    getSummary(startTime?: number, endTime?: number): UsageSummary {
      return tracker.getSummary(startTime, endTime);
    },

    /**
     * Get daily summary
     */
    getDailySummary(): UsageSummary {
      return tracker.getDailySummary();
    },

    /**
     * Get monthly summary
     */
    getMonthlySummary(): UsageSummary {
      return tracker.getMonthlySummary();
    },

    /**
     * Get all records
     */
    getAllRecords(): UsageRecord[] {
      return tracker.getAllRecords();
    },

    /**
     * Clear all data
     */
    clear(): void {
      tracker.clear();
    },
  };
}

/**
 * Cost tracking middleware for agents
 */
export function costTrackingMiddleware(config: CostConfig) {
  const tracker = createCostTracker(config);

  return async (
    context: AgentContext,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> => {
    const result = await next();

    // Track cost
    tracker.track(
      context.agentId,
      context.model || "unknown",
      result,
      (context.data as Record<string, unknown>)?.userId as string | undefined,
    );

    return result;
  };
}
