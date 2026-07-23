import type { RuntimeResponse } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext } from "../types.ts";
import { canAcceptClient, getClientCount } from "./hmr-client-manager.ts";
import {
  authorizeHmrRequest,
  isAuthorizedHmrOrigin,
  privateHmrResponse,
} from "./hmr-request-policy.ts";
import { initializeRemoteHmrAdapter, upgradeHmrWebSocket } from "./hmr-websocket-session.ts";

const logger = serverLogger.component("hmr-handler");
const HMR_CAPACITY_RETRY_AFTER_SECONDS = 5;

export type HmrRequestResult =
  | { kind: "continue" }
  | { kind: "response"; response: RuntimeResponse };

export async function handleHmrRequest(
  req: Request,
  ctx: HandlerContext,
): Promise<HmrRequestResult> {
  const authorization = await authorizeHmrRequest(req, ctx);
  if (!authorization) {
    logger.debug("Skipping unauthorized HMR request");
    return { kind: "continue" };
  }
  if (req.method !== "GET") {
    return {
      kind: "response",
      response: privateHmrResponse("Method not allowed", {
        status: 405,
        headers: { allow: "GET" },
      }),
    };
  }
  if (!isAuthorizedHmrOrigin(req, authorization)) {
    return { kind: "response", response: privateHmrResponse("Forbidden", { status: 403 }) };
  }

  const upgradeHeader = req.headers.get("upgrade");
  const isWebSocketUpgrade = upgradeHeader?.trim().toLowerCase() === "websocket";
  if (upgradeHeader !== null && !isWebSocketUpgrade) {
    return {
      kind: "response",
      response: privateHmrResponse("Invalid upgrade request", { status: 400 }),
    };
  }
  if (!isWebSocketUpgrade) {
    return {
      kind: "response",
      response: privateHmrResponse(
        JSON.stringify({ status: "ok", clients: getClientCount(authorization.scope) }),
        { headers: { "content-type": "application/json; charset=utf-8" } },
      ),
    };
  }
  if (!ctx.adapter.server) {
    return {
      kind: "response",
      response: privateHmrResponse("WebSocket not supported", { status: 501 }),
    };
  }
  if (!canAcceptClient(authorization.scope)) {
    return {
      kind: "response",
      response: privateHmrResponse("HMR connection capacity reached", {
        status: 503,
        headers: { "retry-after": String(HMR_CAPACITY_RETRY_AFTER_SECONDS) },
      }),
    };
  }

  void initializeRemoteHmrAdapter(ctx);
  return {
    kind: "response",
    response: upgradeHmrWebSocket(req, ctx, authorization.scope),
  };
}
