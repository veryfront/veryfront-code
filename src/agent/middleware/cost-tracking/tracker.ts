import type { AgentMiddleware, AgentResponse } from "../../types.ts";
import { agentLogger } from "#veryfront/utils";
import { COST_LIMIT_EXCEEDED, INVALID_ARGUMENT } from "#veryfront/errors";

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const RESET_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_MAX_TRACKED_USERS = 10_000;
const DEFAULT_MAX_RECORDS = 10_000;
const MAX_TRACKED_ENTRIES = 1_000_000;

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
    /** Per-user daily cost limit */
    userDaily?: number;
  };
  /** Maximum number of per-user cost entries to retain (default: 10_000) */
  maxTrackedUsers?: number;
  /** Maximum number of detailed usage records to retain (default: 10,000). */
  maxRecords?: number;
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

type ResolvedCostConfig = Readonly<{
  pricing: Readonly<Record<string, Readonly<{ input: number; output: number }>>>;
  limits?: Readonly<{ daily?: number; monthly?: number; userDaily?: number }>;
  maxTrackedUsers: number;
  maxRecords: number;
  onLimitExceeded?: (usage: UsageSummary) => void;
}>;

function positiveSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw INVALID_ARGUMENT.create({ detail: `${name} must be a positive safe integer` });
  }
  if ((value as number) > MAX_TRACKED_ENTRIES) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must not exceed ${MAX_TRACKED_ENTRIES}`,
    });
  }
  return value as number;
}

function finiteNonNegative(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw INVALID_ARGUMENT.create({ detail: `${name} must be a finite non-negative number` });
  }
  return value;
}

function normalizeCostConfig(config: CostConfig): ResolvedCostConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw INVALID_ARGUMENT.create({ detail: "Cost tracking configuration must be an object" });
  }
  if (!config.pricing || typeof config.pricing !== "object" || Array.isArray(config.pricing)) {
    throw INVALID_ARGUMENT.create({ detail: "Cost tracking pricing must be an object" });
  }

  const pricing: Record<string, Readonly<{ input: number; output: number }>> = Object.create(null);
  for (const [provider, value] of Object.entries(config.pricing)) {
    if (
      provider.length === 0 || provider.length > 128 || !value || typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Cost tracking pricing must contain finite non-negative costs",
      });
    }
    if (
      typeof value.input !== "number" || !Number.isFinite(value.input) || value.input < 0 ||
      typeof value.output !== "number" || !Number.isFinite(value.output) || value.output < 0
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Cost tracking pricing must contain finite non-negative costs",
      });
    }
    pricing[provider] = Object.freeze({ input: value.input, output: value.output });
  }

  let limits: ResolvedCostConfig["limits"];
  if (config.limits !== undefined) {
    if (!config.limits || typeof config.limits !== "object" || Array.isArray(config.limits)) {
      throw INVALID_ARGUMENT.create({ detail: "Cost tracking limits must be an object" });
    }
    limits = Object.freeze({
      ...(config.limits.daily === undefined
        ? {}
        : { daily: finiteNonNegative(config.limits.daily, "Daily cost limit") }),
      ...(config.limits.monthly === undefined
        ? {}
        : { monthly: finiteNonNegative(config.limits.monthly, "Monthly cost limit") }),
      ...(config.limits.userDaily === undefined
        ? {}
        : { userDaily: finiteNonNegative(config.limits.userDaily, "Per-user daily cost limit") }),
    });
  }
  if (config.onLimitExceeded !== undefined && typeof config.onLimitExceeded !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Cost tracking onLimitExceeded must be a function" });
  }

  return Object.freeze({
    pricing: Object.freeze(pricing),
    ...(limits === undefined ? {} : { limits }),
    maxTrackedUsers: positiveSafeInteger(
      config.maxTrackedUsers ?? DEFAULT_MAX_TRACKED_USERS,
      "maxTrackedUsers",
    ),
    maxRecords: positiveSafeInteger(config.maxRecords ?? DEFAULT_MAX_RECORDS, "maxRecords"),
    ...(config.onLimitExceeded === undefined ? {} : { onLimitExceeded: config.onLimitExceeded }),
  });
}

function cloneUsageRecord(record: UsageRecord): UsageRecord {
  return { ...record, tokens: { ...record.tokens } };
}

function getProvider(model: string): string {
  return model.split("/")[0] || "unknown";
}

class CostTracker {
  private records: UsageRecord[] = [];
  private nextRecordIndex = 0;
  private dailyTotal = 0;
  private monthlyTotal = 0;
  private userDailyTotals = new Map<string, number>();
  private readonly maxTrackedUsers: number;
  private readonly maxRecords: number;
  private lastDayReset = Date.now();
  private lastMonthReset = Date.now();
  private resetInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: ResolvedCostConfig) {
    this.maxTrackedUsers = config.maxTrackedUsers;
    this.maxRecords = config.maxRecords;
    this.startPeriodicReset();
  }

  isOverBudget(userId?: string): string | null {
    const dailyLimit = this.config.limits?.daily;
    if (dailyLimit !== undefined && this.dailyTotal >= dailyLimit) {
      return "Daily cost limit exceeded";
    }

    const monthlyLimit = this.config.limits?.monthly;
    if (monthlyLimit !== undefined && this.monthlyTotal >= monthlyLimit) {
      return "Monthly cost limit exceeded";
    }

    const userDailyLimit = this.config.limits?.userDaily;
    if (userDailyLimit !== undefined && userId) {
      const userTotal = this.userDailyTotals.get(userId) ?? 0;
      if (userTotal >= userDailyLimit) {
        return "Per-user daily cost limit exceeded";
      }
    }

    return null;
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

    const promptTokens = positiveSafeIntegerOrZero(
      response.usage.promptTokens,
      "Usage promptTokens",
    );
    const completionTokens = positiveSafeIntegerOrZero(
      response.usage.completionTokens,
      "Usage completionTokens",
    );
    const totalTokens = positiveSafeIntegerOrZero(response.usage.totalTokens, "Usage totalTokens");

    const provider = getProvider(model);
    const cost = this.calculateCost(
      provider,
      promptTokens,
      completionTokens,
    );

    const record: UsageRecord = {
      timestamp: Date.now(),
      agentId,
      model,
      provider,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens,
      },
      cost,
      userId,
    };

    if (this.records.length < this.maxRecords) {
      this.records.push(cloneUsageRecord(record));
    } else {
      this.records[this.nextRecordIndex] = cloneUsageRecord(record);
      this.nextRecordIndex = (this.nextRecordIndex + 1) % this.maxRecords;
    }
    this.dailyTotal += cost;
    this.monthlyTotal += cost;
    if (userId && this.maxTrackedUsers > 0) {
      // Keep tracking the current user even after the cap is reached by
      // evicting the oldest tracked user first. This preserves per-user
      // enforcement for active users without unbounded memory growth.
      if (
        !this.userDailyTotals.has(userId) &&
        this.userDailyTotals.size >= this.maxTrackedUsers
      ) {
        const oldestTrackedUser = this.userDailyTotals.keys().next().value;
        if (oldestTrackedUser !== undefined) {
          this.userDailyTotals.delete(oldestTrackedUser);
        }
      }

      this.userDailyTotals.set(
        userId,
        (this.userDailyTotals.get(userId) ?? 0) + cost,
      );
    }
    this.checkLimits(userId);

    return cloneUsageRecord(record);
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

  private checkLimits(userId?: string): void {
    const dailyLimit = this.config.limits?.daily;
    if (dailyLimit !== undefined && this.dailyTotal >= dailyLimit) {
      this.config.onLimitExceeded?.(this.getDailySummary());
      return;
    }

    const monthlyLimit = this.config.limits?.monthly;
    if (monthlyLimit !== undefined && this.monthlyTotal >= monthlyLimit) {
      this.config.onLimitExceeded?.(this.getMonthlySummary());
      return;
    }

    const userDailyLimit = this.config.limits?.userDaily;
    if (userDailyLimit !== undefined && userId) {
      const userTotal = this.userDailyTotals.get(userId) ?? 0;
      if (userTotal >= userDailyLimit) {
        this.config.onLimitExceeded?.(this.getDailySummary());
      }
    }
  }

  private startPeriodicReset(): void {
    this.resetInterval = setInterval(() => {
      const now = Date.now();

      if (now - this.lastDayReset >= ONE_DAY_MS) {
        this.dailyTotal = 0;
        this.userDailyTotals.clear();
        this.lastDayReset = now;
      }

      if (now - this.lastMonthReset >= THIRTY_DAYS_MS) {
        this.monthlyTotal = 0;
        this.lastMonthReset = now;
      }
    }, RESET_CHECK_INTERVAL_MS);
    const interval = this.resetInterval as { unref?: () => void };
    interval.unref?.();
  }

  destroy(): void {
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
      this.resetInterval = null;
    }

    this.clear();
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
    const ordered = this.records.length < this.maxRecords || this.nextRecordIndex === 0
      ? this.records
      : [
        ...this.records.slice(this.nextRecordIndex),
        ...this.records.slice(0, this.nextRecordIndex),
      ];
    return ordered.map(cloneUsageRecord);
  }

  getTrackedUserCount(): number {
    return this.userDailyTotals.size;
  }

  clear(): void {
    this.records = [];
    this.nextRecordIndex = 0;
    this.dailyTotal = 0;
    this.monthlyTotal = 0;
    this.userDailyTotals.clear();
  }
}

function positiveSafeIntegerOrZero(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw INVALID_ARGUMENT.create({ detail: `${name} must be a non-negative safe integer` });
  }
  return value as number;
}

export function createCostTracker(config: CostConfig): {
  track: (agentId: string, model: string, response: AgentResponse, userId?: string) => UsageRecord;
  isOverBudget: (userId?: string) => string | null;
  getSummary: (startTime?: number, endTime?: number) => UsageSummary;
  getDailySummary: () => UsageSummary;
  getMonthlySummary: () => UsageSummary;
  getAllRecords: () => UsageRecord[];
  getTrackedUserCount: () => number;
  clear: () => void;
  destroy: () => void;
} {
  const tracker = new CostTracker(normalizeCostConfig(config));

  return {
    track: tracker.track.bind(tracker),
    isOverBudget: tracker.isOverBudget.bind(tracker),
    getSummary: tracker.getSummary.bind(tracker),
    getDailySummary: tracker.getDailySummary.bind(tracker),
    getMonthlySummary: tracker.getMonthlySummary.bind(tracker),
    getAllRecords: tracker.getAllRecords.bind(tracker),
    getTrackedUserCount: tracker.getTrackedUserCount.bind(tracker),
    clear: tracker.clear.bind(tracker),
    destroy: tracker.destroy.bind(tracker),
  };
}

export function costTrackingMiddleware(
  config: CostConfig,
): AgentMiddleware & { destroy(): void } {
  const tracker = createCostTracker(config);

  const middleware = (async (context, next): Promise<AgentResponse> => {
    const userId = (context.data as { userId?: string } | undefined)?.userId;
    const budgetError = tracker.isOverBudget(userId);
    if (budgetError) {
      throw COST_LIMIT_EXCEEDED.create({
        detail: budgetError,
        context: { userId },
      });
    }

    const result = await next();
    tracker.track(
      context.agentId,
      context.model || "unknown",
      result,
      userId,
    );
    return result;
  }) as AgentMiddleware & { destroy(): void };

  middleware.destroy = () => {
    tracker.destroy();
  };

  return middleware;
}
