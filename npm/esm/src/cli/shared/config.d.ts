import { type RuntimeEnv } from "../../config/runtime-env.js";
export interface VeryfrontConfig {
    projectSlug?: string;
    /** List of project slugs for multi-project pull */
    projects?: string[];
    apiToken?: string;
    apiUrl?: string;
}
export interface ResolvedConfig {
    apiUrl: string;
    apiToken: string;
    projectSlug: string;
}
export declare function readConfigFile(projectDir: string): Promise<VeryfrontConfig | null>;
export declare function resolveConfig(projectDir?: string, env?: RuntimeEnv): Promise<ResolvedConfig>;
export interface ApiClient {
    get<T>(path: string, params?: Record<string, string>): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
}
export interface ApiError {
    error: string;
    message?: string;
    code?: string;
}
export declare function createApiClient(config: ResolvedConfig): ApiClient;
//# sourceMappingURL=config.d.ts.map