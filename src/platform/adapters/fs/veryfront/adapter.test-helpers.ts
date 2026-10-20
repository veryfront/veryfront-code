import { buildFileListCacheKey } from "./cache-keys.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { FSAdapterConfig } from "./types.ts";

class AdapterTestSocket extends EventTarget implements WebSocket {
  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;
  readonly bufferedAmount = 0;
  readonly extensions = "";
  readonly protocol: string;
  binaryType: BinaryType = "blob";
  readyState: WebSocket["readyState"] = WebSocket.OPEN;
  onmessage: WebSocket["onmessage"] = null;
  onopen: WebSocket["onopen"] = null;
  onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null;
  readonly sentMessages: string[] = [];

  constructor(readonly url: string, readonly protocols?: string | string[]) {
    super();
    this.protocol = typeof protocols === "string" ? protocols : protocols?.[0] ?? "";
  }
  send(data: Parameters<WebSocket["send"]>[0]): void {
    if (typeof data !== "string") throw new Error("Test transport expects text messages");
    this.sentMessages.push(data);
  }
  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
}

export class AdapterTestTransport {
  readonly sockets: AdapterTestSocket[] = [];
  readonly createWebSocket = (url: string, protocols?: string | string[]): WebSocket => {
    const socket = new AdapterTestSocket(url, protocols);
    this.sockets.push(socket);
    return socket;
  };
  poke(data: Record<string, unknown>): void {
    const socket = this.sockets.at(-1);
    if (!socket?.onmessage) throw new Error("Adapter transport is not connected");
    socket.onmessage(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "poke", data }),
      }),
    );
  }
}
const adapterTransports = new WeakMap<VeryfrontFSAdapter, AdapterTestTransport>();
export function getAdapterTestTransport(adapter: VeryfrontFSAdapter): AdapterTestTransport {
  const transport = adapterTransports.get(adapter);
  if (!transport) throw new Error("Adapter was not constructed by the test helper");
  return transport;
}

export function createAdapter(
  overrides: Partial<FSAdapterConfig> = {},
): VeryfrontFSAdapter {
  const transport = new AdapterTestTransport();
  const adapter = new VeryfrontFSAdapter({
    veryfront: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
      projectSlug: "test-project",
      cache: { enabled: false },
    },
    ...overrides,
  }, { createWebSocket: transport.createWebSocket });
  adapterTransports.set(adapter, transport);
  return adapter;
}

export function seedCachedFiles(
  adapter: VeryfrontFSAdapter,
  files: Array<{ id?: string; path: string; content?: string }>,
): void {
  const context = adapter.getContentContext();
  if (!context) throw new Error("Content context required before seeding cache");

  const cacheKey = buildFileListCacheKey(context);
  (adapter as unknown as {
    cache: {
      set: (
        key: string,
        value: Array<{ id?: string; path: string; content?: string }>,
      ) => void;
    };
  }).cache.set(cacheKey, files);
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition");
}
