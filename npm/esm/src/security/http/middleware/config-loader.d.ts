import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { SecurityConfig } from "./types.js";
export declare function isValidSecurityConfig(config: unknown): config is SecurityConfig;
export declare function loadSecurityConfig(projectDir: string, adapter: RuntimeAdapter): Promise<SecurityConfig | null>;
//# sourceMappingURL=config-loader.d.ts.map