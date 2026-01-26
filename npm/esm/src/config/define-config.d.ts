import type { VeryfrontConfig } from "./types.js";
import { type RuntimeEnv } from "./runtime-env.js";
export declare function defineConfig(config: VeryfrontConfig): VeryfrontConfig;
export declare function defineConfigWithEnv(factory: (env: string) => VeryfrontConfig, runtimeEnv?: RuntimeEnv): VeryfrontConfig;
export declare function mergeConfigs(...configs: Partial<VeryfrontConfig>[]): VeryfrontConfig;
export declare function validateConfig(config: unknown): Promise<void>;
//# sourceMappingURL=define-config.d.ts.map