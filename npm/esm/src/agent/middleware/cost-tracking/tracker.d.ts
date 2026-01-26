import type { AgentContext, AgentResponse } from "../../types.js";
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
    byProvider: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
    }>;
    period: {
        start: number;
        end: number;
    };
}
export declare function createCostTracker(config: CostConfig): {
    track: (agentId: string, model: string, response: AgentResponse, userId?: string) => UsageRecord;
    getSummary: (startTime?: number, endTime?: number) => UsageSummary;
    getDailySummary: () => UsageSummary;
    getMonthlySummary: () => UsageSummary;
    getAllRecords: () => UsageRecord[];
    clear: () => void;
};
export declare function costTrackingMiddleware(config: CostConfig): (context: AgentContext, next: () => Promise<AgentResponse>) => Promise<AgentResponse>;
//# sourceMappingURL=tracker.d.ts.map