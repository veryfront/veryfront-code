/** Route HMR status and WebSocket requests into the shared HMR services. */

import type { RuntimeResponse } from "#veryfront/platform/adapters/base.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";
import { BaseHandler } from "../response/base.ts";
import {
  type HandlerContext,
  type HandlerMetadata,
  HandlerPriority,
  type HandlerResult,
} from "../types.ts";
import { getClientCount } from "./hmr-client-manager.ts";
import { getMetrics } from "./hmr-message-router.ts";
import { handleHmrRequest } from "./hmr-request-service.ts";
import { acquireHmrRuntime, shutdownHmrRuntime } from "./hmr-runtime.ts";

export type { HMRClientInfo } from "./hmr-client-manager.ts";

export class HMRHandler extends BaseHandler<RuntimeResponse> {
  metadata: HandlerMetadata = {
    name: "HMRHandler",
    priority: HandlerPriority.EARLY,
    patterns: [{ pattern: "/_ws", exact: true }],
    enabled: () => true,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult<RuntimeResponse>> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    const result = await handleHmrRequest(req, ctx);
    return result.kind === "continue" ? this.continue() : this.respond(result.response);
  }

  static getClientCount(): number {
    return getClientCount();
  }

  static getMetrics(): {
    clients: number;
    broadcastsSent: number;
    messagesForwarded: number;
    lastBroadcastTime: number;
  } {
    return getMetrics();
  }

  /** Keep shared HMR infrastructure alive for one server instance. */
  static acquireRuntime(): () => void {
    return acquireHmrRuntime();
  }

  static shutdown(): void {
    shutdownHmrRuntime();
  }
}

registerProcessStateReset("hmr handler", () => HMRHandler.shutdown());
