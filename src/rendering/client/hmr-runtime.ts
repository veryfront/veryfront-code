/**
 * Veryfront HMR Runtime Types
 * Client-side Hot Module Replacement runtime types for development
 *
 * The actual HMR runtime is generated server-side by
 * src/server/modules/hmr-runtime-generator.ts and injected as a script.
 */

import type { HMRMessage } from "../../server/dev-server/hmr/message-handler.ts";

export interface HMRRuntimeOptions {
  port: number;
  reactRefresh?: boolean;
}

export type { HMRMessage };
