import type { ServerAdapter, WebSocketUpgrade, WebSocketUpgradeOptions } from "../../base.ts";
import { getNativeDeno } from "../../../compat/http/native-response.ts";
import { resolveDenoWebSocketUpgradeOptions } from "../../../compat/http/websocket.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";

export class DenoServerAdapter implements ServerAdapter {
  private readonly upgradedRequests = new WeakSet<Request>();

  upgradeWebSocket(
    request: Request,
    options?: WebSocketUpgradeOptions,
  ): WebSocketUpgrade {
    const nativeDeno = getNativeDeno();
    if (typeof nativeDeno?.upgradeWebSocket !== "function") {
      throw NOT_SUPPORTED.create({
        detail: "DenoServerAdapter.upgradeWebSocket() can only be used in Deno runtime",
        context: { platform: "deno", operation: "upgradeWebSocket" },
      });
    }
    if (this.upgradedRequests.has(request)) {
      throw INVALID_ARGUMENT.create({
        detail: "Deno Request has already been upgraded",
        context: { platform: "deno", operation: "upgradeWebSocket" },
      });
    }

    const upgrade = nativeDeno.upgradeWebSocket(
      request,
      resolveDenoWebSocketUpgradeOptions(request, options),
    );
    this.upgradedRequests.add(request);
    return upgrade;
  }
}
