import { buildFileListCacheKey } from "./cache-keys.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import type { FSAdapterConfig } from "./types.ts";

export class AdapterTestTransport {
  readonly sockets: Array<{
    url: string;
    protocols?: string | string[];
    readyState: number;
    onmessage: ((event: MessageEvent) => unknown) | null;
    onopen: ((event: Event) => unknown) | null;
    onclose: ((event: CloseEvent) => unknown) | null;
    onerror: ((event: Event) => unknown) | null;
    sentMessages: string[];
    send: (data: string) => void;
    close: () => void;
  }> = [];
  readonly createWebSocket = (url: string, protocols?: string | string[]): WebSocket => {
    const socket: AdapterTestTransport["sockets"][number] = {
      url,
      protocols,
      readyState: WebSocket.OPEN,
      onmessage: null,
      onopen: null,
      onclose: null,
      onerror: null,
      sentMessages: [],
      send: (data: string) => {
        socket.sentMessages.push(data);
      },
      close: () => {
        socket.readyState = WebSocket.CLOSED;
      },
    };
    this.sockets.push(socket);
    return socket as unknown as WebSocket;
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
