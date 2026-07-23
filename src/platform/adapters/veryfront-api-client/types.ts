/**
 * Veryfront API Client Types
 *
 * Re-exports types from schemas.ts and defines config/error types.
 */

export type {
  Environment,
  LookupDomainResponse,
  PageInfo,
  Project,
  ProjectFile,
} from "./schemas/index.ts";

/** File selection used by project file operations. */
export type FileContext =
  | { readonly type: "branch"; readonly name: string }
  | { readonly type: "environment"; readonly name: string }
  | { readonly type: "release"; readonly version: string };

/**
 * Immutable authorization and routing data for one request.
 *
 * Providers must return all request-varying values together. This prevents a
 * concurrent request from pairing one request's token with another request's
 * project or file context.
 */
export interface VeryfrontAPIRequestIdentity {
  readonly token: string;
  readonly projectSlug: string;
  readonly fileContext?: FileContext;
}

/**
 * Lifecycle and response limits for one logical Veryfront API operation.
 *
 * `timeoutMs` applies to each HTTP attempt. `totalTimeoutMs` applies to the
 * complete logical operation, including retries and every pagination page.
 * `maxResponseBytes` applies independently to each HTTP response body.
 */
export interface VeryfrontAPIRequestPolicy {
  /** Cancel the operation, including pending retries and pagination. */
  readonly signal?: AbortSignal;
  /** Maximum duration of one HTTP attempt, in milliseconds. */
  readonly timeoutMs?: number;
  /** Maximum duration of the complete logical operation, in milliseconds. */
  readonly totalTimeoutMs?: number;
  /** Maximum bytes accepted from one successful HTTP response, from 1 byte through 256 MiB. */
  readonly maxResponseBytes?: number;
}

/** Maximum body size accepted by the release asset upload endpoint (10 MiB). */
export const RELEASE_ASSET_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export interface VeryfrontAPIConfig {
  apiBaseUrl: string;
  /** API token - optional in proxy mode where token comes per-request */
  apiToken?: string;
  /**
   * Resolve the token from the active request context.
   *
   * @deprecated For concurrent request routing, use requestIdentityProvider so
   * the token, project, and file context are captured atomically.
   */
  requestTokenProvider?: () => string | undefined;
  /** Resolve one immutable authorization and routing snapshot for the operation. */
  requestIdentityProvider?: () => VeryfrontAPIRequestIdentity | undefined;
  /** Project slug - optional in proxy mode where slug comes per-request */
  projectSlug?: string;
  /** Project ID - if known, skips the listProjects lookup */
  projectId?: string;
  /** Enable proxy mode for multi-project per-request handling */
  proxyMode?: boolean;
  /** Default lifecycle and response limits for every high-level operation. */
  requestPolicy?: VeryfrontAPIRequestPolicy;
  retry?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
}

export { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
export { VeryfrontError } from "#veryfront/errors/types.ts";
