import type { ServeOptions } from "../../base.ts";
import { getNativeDeno } from "../../../compat/http/native-response.ts";
import { scopeRequestAsyncContext } from "../../../compat/http/request-async-scope.ts";
import { getEnvOverlayStorage } from "../../../compat/process.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import {
  type NodeWebSocketServerProvider,
  snapshotNodeWebSocketServerProvider,
} from "#veryfront/extensions/websocket";

/** Deno 2.9.7 and 2.9.8 lose HTTP/1 disconnects after a streamed request body reaches EOF. */
export function needsDenoNodeHttpTransport(version = getNativeDeno()?.version.deno): boolean {
  return version === "2.9.7" || version === "2.9.8";
}

/** Preserve the Deno request scope while reusing the Node HTTP transport. */
export function scopeDenoNodeHttpHandler<T>(
  handler: (request: Request) => T,
): (request: Request) => T {
  const overlay = getEnvOverlayStorage();
  const store = overlay?.getStore();
  return scopeRequestAsyncContext((request: Request) => {
    if (overlay && store) {
      if (overlay.run) return overlay.run(store, () => handler(request));
      overlay.enterWith?.(store);
    }
    return handler(request);
  });
}

/**
 * Direct Deno listeners retain their implicit WebSocket support. A host that
 * resolved extension policy passes null to explicitly disable the provider;
 * that decision must never trigger a default import.
 */
export async function resolveDenoNodeHttpOptions(options: ServeOptions): Promise<ServeOptions> {
  if (options.nodeWebSocketServerProvider !== undefined) return options;
  const extension = await importFirstPartyExtensionModule<{
    WsNodeWebSocketServerProvider: Readonly<NodeWebSocketServerProvider>;
  }>("ext-node-websocket-ws", "@veryfront/ext-node-websocket-ws");
  return {
    ...options,
    nodeWebSocketServerProvider: snapshotNodeWebSocketServerProvider(
      extension.WsNodeWebSocketServerProvider,
    ),
  };
}
