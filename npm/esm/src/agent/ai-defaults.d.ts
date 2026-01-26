export declare const AGENT_DEFAULTS: {
    readonly maxTokens: 4096;
    readonly temperature: 0.7;
    readonly maxSteps: 20;
    readonly memoryType: "conversation";
    readonly memoryMaxTokens: 4000;
};
export declare const STREAMING_DEFAULTS: {
    readonly maxBufferSize: number;
    readonly chunkSize: 16384;
};
export declare const MEMORY_DEFAULTS: {
    readonly bufferSize: 10;
    readonly summaryThreshold: 20;
    readonly redisTtl: 86400;
    readonly redisKeyPrefix: "veryfront:agent:memory:";
};
export declare const RATE_LIMIT_DEFAULTS: {
    readonly requestsPerMinute: 60;
    readonly tokensPerMinute: 100000;
    readonly windowMs: 60000;
};
export declare const COST_TRACKING_DEFAULTS: {
    readonly dailyBudget: 100;
    readonly monthlyBudget: 1000;
    readonly warningThreshold: 0.8;
};
export declare const RETRY_DEFAULTS: {
    readonly maxAttempts: 3;
    readonly initialDelayMs: 1000;
    readonly maxDelayMs: 30000;
    readonly backoffMultiplier: 2;
};
export declare const WORKFLOW_DEFAULTS: {
    readonly timeoutMs: 300000;
    readonly maxParallel: 10;
    readonly checkpointIntervalMs: 5000;
    readonly approvalTimeoutMs: 86400000;
};
export declare const PROVIDER_DEFAULTS: {
    readonly models: {
        readonly openai: "gpt-4o";
        readonly anthropic: "claude-sonnet-4-20250514";
        readonly google: "gemini-1.5-pro";
    };
    readonly requestTimeoutMs: 120000;
};
export declare const SECURITY_DEFAULTS: {
    readonly maxInputLength: 100000;
    readonly maxOutputLength: 100000;
    readonly redactPii: false;
};
export declare const AI_DEFAULTS: {
    readonly agent: {
        readonly maxTokens: 4096;
        readonly temperature: 0.7;
        readonly maxSteps: 20;
        readonly memoryType: "conversation";
        readonly memoryMaxTokens: 4000;
    };
    readonly streaming: {
        readonly maxBufferSize: number;
        readonly chunkSize: 16384;
    };
    readonly memory: {
        readonly bufferSize: 10;
        readonly summaryThreshold: 20;
        readonly redisTtl: 86400;
        readonly redisKeyPrefix: "veryfront:agent:memory:";
    };
    readonly rateLimit: {
        readonly requestsPerMinute: 60;
        readonly tokensPerMinute: 100000;
        readonly windowMs: 60000;
    };
    readonly costTracking: {
        readonly dailyBudget: 100;
        readonly monthlyBudget: 1000;
        readonly warningThreshold: 0.8;
    };
    readonly retry: {
        readonly maxAttempts: 3;
        readonly initialDelayMs: 1000;
        readonly maxDelayMs: 30000;
        readonly backoffMultiplier: 2;
    };
    readonly workflow: {
        readonly timeoutMs: 300000;
        readonly maxParallel: 10;
        readonly checkpointIntervalMs: 5000;
        readonly approvalTimeoutMs: 86400000;
    };
    readonly provider: {
        readonly models: {
            readonly openai: "gpt-4o";
            readonly anthropic: "claude-sonnet-4-20250514";
            readonly google: "gemini-1.5-pro";
        };
        readonly requestTimeoutMs: 120000;
    };
    readonly security: {
        readonly maxInputLength: 100000;
        readonly maxOutputLength: 100000;
        readonly redactPii: false;
    };
};
//# sourceMappingURL=ai-defaults.d.ts.map