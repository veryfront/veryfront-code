import * as dntShim from "../../../../_dnt.shims.js";
import { agentLogger } from "../../../utils/logger/logger.js";
function getProvider(model) {
    return model.split("/")[0] || "unknown";
}
class CostTracker {
    config;
    records = [];
    dailyTotal = 0;
    monthlyTotal = 0;
    lastDayReset = Date.now();
    lastMonthReset = Date.now();
    resetInterval = null;
    constructor(config) {
        this.config = config;
        this.startPeriodicReset();
    }
    track(agentId, model, response, userId) {
        if (!response.usage) {
            agentLogger.warn("No usage data in response, cannot track costs");
            return this.createEmptyRecord(agentId, model);
        }
        const provider = getProvider(model);
        const cost = this.calculateCost(provider, response.usage.promptTokens, response.usage.completionTokens);
        const record = {
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
    calculateCost(provider, inputTokens, outputTokens) {
        const pricing = this.config.pricing[provider];
        if (!pricing) {
            agentLogger.warn(`No pricing configured for provider: ${provider}`);
            return 0;
        }
        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        return inputCost + outputCost;
    }
    getSummary(startTime, endTime) {
        const start = startTime ?? 0;
        const end = endTime ?? Date.now();
        const relevantRecords = this.records.filter((r) => r.timestamp >= start && r.timestamp <= end);
        const summary = {
            requests: relevantRecords.length,
            tokens: { prompt: 0, completion: 0, total: 0 },
            cost: 0,
            byProvider: {},
            period: { start, end },
        };
        for (const record of relevantRecords) {
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
    getDailySummary() {
        const now = Date.now();
        return this.getSummary(now - 24 * 60 * 60 * 1000, now);
    }
    getMonthlySummary() {
        const now = Date.now();
        return this.getSummary(now - 30 * 24 * 60 * 60 * 1000, now);
    }
    checkLimits() {
        const dailyLimit = this.config.limits?.daily;
        if (dailyLimit && this.dailyTotal > dailyLimit) {
            this.config.onLimitExceeded?.(this.getDailySummary());
        }
        const monthlyLimit = this.config.limits?.monthly;
        if (monthlyLimit && this.monthlyTotal > monthlyLimit) {
            this.config.onLimitExceeded?.(this.getMonthlySummary());
        }
    }
    startPeriodicReset() {
        this.resetInterval = dntShim.setInterval(() => {
            const now = Date.now();
            if (now - this.lastDayReset >= 24 * 60 * 60 * 1000) {
                this.dailyTotal = 0;
                this.lastDayReset = now;
            }
            if (now - this.lastMonthReset >= 30 * 24 * 60 * 60 * 1000) {
                this.monthlyTotal = 0;
                this.lastMonthReset = now;
            }
        }, 60_000);
    }
    destroy() {
        if (this.resetInterval) {
            clearInterval(this.resetInterval);
            this.resetInterval = null;
        }
        this.records = [];
    }
    createEmptyRecord(agentId, model) {
        return {
            timestamp: Date.now(),
            agentId,
            model,
            provider: getProvider(model),
            tokens: { prompt: 0, completion: 0, total: 0 },
            cost: 0,
        };
    }
    getAllRecords() {
        return [...this.records];
    }
    clear() {
        this.records = [];
        this.dailyTotal = 0;
        this.monthlyTotal = 0;
    }
}
export function createCostTracker(config) {
    const tracker = new CostTracker(config);
    return {
        track: (agentId, model, response, userId) => tracker.track(agentId, model, response, userId),
        getSummary: (startTime, endTime) => tracker.getSummary(startTime, endTime),
        getDailySummary: () => tracker.getDailySummary(),
        getMonthlySummary: () => tracker.getMonthlySummary(),
        getAllRecords: () => tracker.getAllRecords(),
        clear: () => tracker.clear(),
    };
}
export function costTrackingMiddleware(config) {
    const tracker = createCostTracker(config);
    return async (context, next) => {
        const result = await next();
        tracker.track(context.agentId, context.model || "unknown", result, context.data?.userId);
        return result;
    };
}
