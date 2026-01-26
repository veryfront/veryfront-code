/**
 * Token Storage Adapter Factory
 *
 * Creates the appropriate token storage adapter based on configuration.
 * For auto-detection from environment variables, use getTokenStorageAdapter()
 * from token/integration.ts instead.
 */
import { logger } from "../../../utils/index.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
export function createTokenStorageAdapter(config) {
    const type = config.type ?? "memory";
    return withSpan("platform.token.createAdapter", async () => {
        logger.debug("[TokenAdapterFactory] Creating adapter", { type });
        if (type === "memory") {
            const { MemoryTokenAdapter } = await import("./veryfront/memory-adapter.js");
            const adapter = new MemoryTokenAdapter();
            await adapter.initialize?.();
            return adapter;
        }
        if (type === "veryfront-api") {
            const { VeryfrontTokenAdapter } = await import("./veryfront/adapter.js");
            const adapter = new VeryfrontTokenAdapter(config);
            await adapter.initialize?.();
            return adapter;
        }
        throw toError(createError({
            type: "config",
            message: `Token storage adapter type "${type}" is not implemented. Supported types: "memory", "veryfront-api".`,
        }));
    }, { "token.adapter.type": type });
}
