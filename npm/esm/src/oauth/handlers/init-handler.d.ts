import * as dntShim from "../../../_dnt.shims.js";
import { type EnvReader } from "../providers/base.js";
import type { AuthorizationUrlOptions, OAuthServiceConfig, TokenStore } from "../types.js";
import { type RuntimeEnv } from "../../config/runtime-env.js";
export interface OAuthInitHandlerOptions {
    /** Token store to use (defaults to memory store) */
    tokenStore?: TokenStore;
    /** Base URL for callbacks (defaults to APP_URL or localhost) */
    baseUrl?: string;
    /** Additional authorization options */
    authOptions?: AuthorizationUrlOptions;
    /** RuntimeEnv for test isolation (defaults to getRuntimeEnv()) */
    env?: RuntimeEnv;
    /** EnvReader for dynamic env vars (defaults to getEnv) */
    envReader?: EnvReader;
}
export declare function createOAuthInitHandler(config: OAuthServiceConfig, options?: OAuthInitHandlerOptions): () => Promise<dntShim.Response>;
export interface OAuthStatusHandlerOptions {
    /** Token store to use (defaults to memory store) */
    tokenStore?: TokenStore;
    /** EnvReader for dynamic env vars (defaults to getEnv) */
    envReader?: EnvReader;
}
export declare function createOAuthStatusHandler(config: OAuthServiceConfig, options?: OAuthStatusHandlerOptions): () => Promise<dntShim.Response>;
export declare function createOAuthDisconnectHandler(config: OAuthServiceConfig, options?: {
    tokenStore?: TokenStore;
}): () => Promise<dntShim.Response>;
//# sourceMappingURL=init-handler.d.ts.map