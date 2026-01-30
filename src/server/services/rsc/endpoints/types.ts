/**
 * Type definitions for RSC endpoints
 * @module rsc-endpoints/types
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export interface ActionBody {
  id: string;
  args: unknown[];
}

export interface ActionRequestParams {
  req: Request;
  projectDir: string;
  adapter: RuntimeAdapter;
}

export interface RSCEndpointParams {
  req: Request;
  pathname: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
}
