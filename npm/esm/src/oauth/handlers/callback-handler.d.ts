/**
 * OAuth Callback Handler
 *
 * Reusable handler for OAuth callback routes.
 */
import * as dntShim from "../../../_dnt.shims.js";
import { type RuntimeEnv } from "../../config/runtime-env.js";
import { type EnvReader } from "../providers/base.js";
import type { OAuthServiceConfig, TokenStore } from "../types.js";
export interface OAuthCallbackHandlerOptions {
    /** Token store to use (defaults to memory store) */
    tokenStore?: TokenStore;
    /** Base URL for redirects (defaults to APP_URL or localhost) */
    baseUrl?: string;
    /** Success redirect path */
    successRedirect?: string;
    /** Error redirect path */
    errorRedirect?: string;
    /** Custom success callback */
    onSuccess?: (serviceId: string, tokens: unknown) => void | Promise<void>;
    /** Custom error callback */
    onError?: (serviceId: string, error: string) => void | Promise<void>;
    /** RuntimeEnv for test isolation (defaults to getRuntimeEnv()) */
    env?: RuntimeEnv;
    /** EnvReader for dynamic env vars (defaults to getEnv) */
    envReader?: EnvReader;
}
/**
 * Create an OAuth callback route handler
 *
 * @example
 * ```typescript
 * // app/api/auth/gmail/callback/route.ts
 * import { createOAuthCallbackHandler } from "veryfront/oauth";
 * import { gmailConfig } from "veryfront/oauth/providers";
 *
 * export const GET = createOAuthCallbackHandler(gmailConfig);
 * ```
 */
export declare function createOAuthCallbackHandler(config: OAuthServiceConfig, options?: OAuthCallbackHandlerOptions): (request: dntShim.Request) => Promise<dntShim.Response>;
//# sourceMappingURL=callback-handler.d.ts.map