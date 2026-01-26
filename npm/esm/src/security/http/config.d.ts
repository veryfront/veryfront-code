import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { SecurityConfig } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
export declare class SecurityConfigLoader {
    private projectDir;
    private adapter;
    private configOverride?;
    private securityConfig;
    private cspUserHeader;
    private isLoaded;
    private loadPromise;
    constructor(projectDir: string, adapter: RuntimeAdapter, configOverride?: VeryfrontConfig | undefined);
    ensureLoaded(): Promise<void>;
    private load;
    private applyConfig;
    private parseCspUserHeader;
    getSecurityConfig(): SecurityConfig | null;
    getCspUserHeader(): string | null;
    getCorsConfig(): SecurityConfig["cors"];
    buildCsp(isDev: boolean, nonce?: string): string;
    getSecurityHeader(headerName: string, defaultValue: string): string;
    reset(): void;
}
//# sourceMappingURL=config.d.ts.map