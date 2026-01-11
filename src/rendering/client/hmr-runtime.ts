import type { HMRMessage } from "@veryfront/server/dev-server/hmr/message-handler.ts";

export interface HMRRuntimeOptions {
  port: number;
  reactRefresh?: boolean;
}

export type { HMRMessage };
