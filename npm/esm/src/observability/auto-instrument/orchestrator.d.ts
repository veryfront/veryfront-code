import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { AutoInstrumentConfig } from "./types.js";
export declare function initAutoInstrumentation(config?: AutoInstrumentConfig, adapter?: RuntimeAdapter): Promise<void>;
export declare function isAutoInstrumentEnabled(): boolean;
/**
 * Reset initialization state (for testing only)
 * @internal
 */
export declare function __resetAutoInstrumentForTests(): void;
//# sourceMappingURL=orchestrator.d.ts.map