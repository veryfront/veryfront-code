/**
 * Type definitions for RSC endpoints
 * @module rsc-endpoints/types
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";

/**
 * Parsed action request body
 */
export interface ActionBody {
  /** Action identifier */
  id: string;
  /** Action arguments */
  args: unknown[];
}

/**
 * Parameters for handling action requests
 */
export interface ActionRequestParams {
  /** HTTP request */
  req: Request;
  /** Project directory path */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
}

/**
 * Parameters for handling RSC endpoints
 */
export interface RSCEndpointParams {
  /** HTTP request */
  req: Request;
  /** Request pathname */
  pathname: string;
  /** Project directory path */
  projectDir: string;
  /** Runtime adapter */
  adapter: RuntimeAdapter;
  /** Veryfront configuration */
  config?: VeryfrontConfig;
}
