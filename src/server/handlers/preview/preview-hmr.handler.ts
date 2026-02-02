/**
 * Preview HMR Handler
 *
 * WebSocket handler for HMR connections from the preview bundler.
 * This handler manages WebSocket connections for projects using the
 * new esbuild watch mode with incremental rebuilds.
 *
 * Endpoint: /_vf/hmr?project={projectId}
 *
 * @module server/handlers/preview/preview-hmr.handler
 */

import { serverLogger as logger } from "#veryfront/utils";
import { BaseHandler } from "../response/base.ts";
import {
  type HandlerContext,
  type HandlerMetadata,
  HandlerPriority,
  type HandlerResult,
} from "../types.ts";
import { getPreviewBundler } from "#veryfront/bundler/preview-bundler.ts";
import { getRuntimeEnv } from "#veryfront/config/runtime-env.ts";

const PRIORITY_PREVIEW_HMR: HandlerPriority = HandlerPriority.EARLY;

/**
 * Preview HMR Handler
 *
 * Handles WebSocket connections for the preview bundler's HMR system.
 * Routes connections based on project ID to enable per-project HMR updates.
 */
export class PreviewHMRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "PreviewHMRHandler",
    priority: PRIORITY_PREVIEW_HMR,
    patterns: [
      { pattern: "/_vf/hmr", exact: false }, // Matches /_vf/hmr and /_vf/hmr?project=...
    ],
    enabled: () => {
      const env = getRuntimeEnv();
      // Only enable in non-production environments
      return env.nodeEnv !== "production";
    },
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const url = new URL(req.url);

    // Extract project ID from query parameter
    const projectId = url.searchParams.get("project") ?? ctx.projectId ?? ctx.projectSlug;

    if (!projectId) {
      logger.debug("[PreviewHMRHandler] Missing project ID");
      return this.respond(
        new Response(JSON.stringify({ error: "Missing project parameter" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    // Non-WebSocket request - return status
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      const bundler = getPreviewBundler();
      const stats = bundler.getStats();

      return this.respond(
        new Response(
          JSON.stringify({
            status: "ok",
            projectId,
            bundlerStats: stats,
            message: "Preview HMR WebSocket endpoint - connect via WebSocket",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }

    // Check if adapter supports WebSocket upgrades
    if (!ctx.adapter?.server?.upgradeWebSocket) {
      logger.debug("[PreviewHMRHandler] WebSocket upgrade not supported");
      return this.respond(
        new Response("WebSocket not supported", { status: 501 }),
      );
    }

    try {
      const { socket, response } = ctx.adapter.server.upgradeWebSocket(req);
      const bundler = getPreviewBundler();

      // Register client with preview bundler
      bundler.registerHmrClient(projectId, socket);

      logger.debug("[PreviewHMRHandler] HMR client connected", {
        projectId,
        stats: bundler.getStats(),
      });

      // Handle disconnect
      socket.addEventListener("close", () => {
        bundler.unregisterHmrClient(projectId, socket);
        logger.debug("[PreviewHMRHandler] HMR client disconnected", {
          projectId,
          stats: bundler.getStats(),
        });
      });

      // Handle errors
      socket.addEventListener("error", (event) => {
        logger.debug("[PreviewHMRHandler] WebSocket error", {
          projectId,
          error: String(event),
        });
        bundler.unregisterHmrClient(projectId, socket);
      });

      // Handle messages from client (e.g., pong responses)
      socket.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.type === "pong") {
            // Client responded to ping - connection is healthy
            logger.debug("[PreviewHMRHandler] Received pong", { projectId });
          }
        } catch {
          // Ignore non-JSON messages
        }
      });

      return this.respond(response);
    } catch (error) {
      logger.error("[PreviewHMRHandler] WebSocket upgrade failed", {
        projectId,
        error: String(error),
      });
      return this.respond(
        new Response("WebSocket upgrade failed", { status: 500 }),
      );
    }
  }
}
