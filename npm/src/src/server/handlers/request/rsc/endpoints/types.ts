/**
 * Type definitions for RSC endpoints
 * @module rsc-endpoints/types
 */
import * as dntShim from "../../../../../../_dnt.shims.js";


import type { RuntimeAdapter } from "../../../../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../../../../config/index.js";

export interface ActionBody {
  id: string;
  args: unknown[];
}

export interface ActionRequestParams {
  req: dntShim.Request;
  projectDir: string;
  adapter: RuntimeAdapter;
}

export interface RSCEndpointParams {
  req: dntShim.Request;
  pathname: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
}
