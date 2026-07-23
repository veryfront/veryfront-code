import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareServer, CloudflareServerAdapter } from "./server.ts";
import type {
  CloudflareResponseInit,
  CloudflareServerRuntime,
  CloudflareWebSocket,
} from "./types.ts";

class FakeWebSocket extends EventTarget {
  accepted = false;
  closeCalls = 0;
  readonly readyState = WebSocket.OPEN;

  accept(): void {
    this.accepted = true;
  }

  send(_data: string | ArrayBufferLike | Blob | ArrayBufferView): void {}

  close(): void {
    this.closeCalls++;
  }
}

function createRuntime(): {
  runtime: CloudflareServerRuntime;
  client: FakeWebSocket;
  server: FakeWebSocket;
  responseInits: CloudflareResponseInit[];
} {
  const client = new FakeWebSocket();
  const server = new FakeWebSocket();
  const responseInits: CloudflareResponseInit[] = [];
  const runtime: CloudflareServerRuntime = {
    createWebSocketPair: () => ({
      0: client as unknown as CloudflareWebSocket,
      1: server as unknown as CloudflareWebSocket,
    }),
    createResponse: (init) => {
      responseInits.push(init);
      return { status: init.status, headers: new Headers(init.headers) } as Response;
    },
  };
  return { runtime, client, server, responseInits };
}

function createUpgradeRequest(protocols?: string): Request {
  return new Request("https://example.com/socket", {
    headers: {
      Upgrade: "websocket",
      ...(protocols ? { "Sec-WebSocket-Protocol": protocols } : {}),
    },
  });
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to throw");
}

function assertSanitizedInvalidHeaders(error: unknown, secret: string): void {
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "invalid-argument");
  assertEquals(error.message, "Invalid WebSocket upgrade headers");
  assertEquals(
    JSON.stringify({
      message: error.message,
      detail: error.detail,
      cause: error.cause,
      context: error.context,
    }).includes(secret),
    false,
  );
}

describe("CloudflareServerAdapter", () => {
  it("rejects non-WebSocket requests before creating a socket pair", () => {
    let pairCalls = 0;
    const adapter = new CloudflareServerAdapter({
      createWebSocketPair: () => {
        pairCalls++;
        throw new Error("must not run");
      },
      createResponse: () => {
        throw new Error("must not run");
      },
    });

    assertThrows(
      () => adapter.upgradeWebSocket(new Request("https://example.com/socket")),
      Error,
      "Invalid WebSocket upgrade request",
    );
    assertEquals(pairCalls, 0);
  });

  it("selects an offered protocol and applies only safe custom headers", () => {
    const { runtime, server, responseInits } = createRuntime();
    const adapter = new CloudflareServerAdapter(runtime);

    const result = adapter.upgradeWebSocket(createUpgradeRequest("events, chat"), {
      protocol: "chat",
      idleTimeout: 0,
      headers: {
        Connection: "close",
        "Sec-WebSocket-Accept": "untrusted",
        "X-Request-Id": "safe",
      },
    });

    assertEquals(result.socket, server as unknown as CloudflareWebSocket);
    assertEquals(server.accepted, true);
    assertEquals(responseInits.length, 1);
    const headers = new Headers(responseInits[0]!.headers);
    assertEquals(headers.get("Sec-WebSocket-Protocol"), "chat");
    assertEquals(headers.get("X-Request-Id"), "safe");
    assertEquals(headers.has("Connection"), false);
    assertEquals(headers.has("Sec-WebSocket-Accept"), false);
  });

  it("rejects a protocol the client did not offer", () => {
    const { runtime } = createRuntime();
    const adapter = new CloudflareServerAdapter(runtime);

    assertThrows(
      () =>
        adapter.upgradeWebSocket(createUpgradeRequest("events"), {
          protocol: "chat",
        }),
      Error,
      "not requested",
    );
  });

  it("sanitizes invalid custom header construction failures", () => {
    const { runtime } = createRuntime();
    const adapter = new CloudflareServerAdapter(runtime);
    const secret = "placeholder-secret\ninvalid";

    const error = captureError(() =>
      adapter.upgradeWebSocket(createUpgradeRequest(), {
        headers: { "X-Private-Value": secret },
      })
    );

    assertSanitizedInvalidHeaders(error, secret);
  });

  it("sanitizes invalid selected protocol header failures", () => {
    const { runtime } = createRuntime();
    const adapter = new CloudflareServerAdapter(runtime);
    const secret = "placeholder-secret\ninvalid";
    const request = {
      method: "GET",
      headers: {
        get(name: string): string | null {
          if (name === "upgrade") return "websocket";
          if (name === "sec-websocket-protocol") return secret;
          return null;
        },
      },
    } as unknown as Request;

    const error = captureError(() =>
      adapter.upgradeWebSocket(request, {
        protocol: secret,
      })
    );

    assertSanitizedInvalidHeaders(error, secret);
  });

  it("rejects unsupported per-connection idle timeouts", () => {
    const { runtime } = createRuntime();
    const adapter = new CloudflareServerAdapter(runtime);

    assertThrows(
      () => adapter.upgradeWebSocket(createUpgradeRequest(), { idleTimeout: 30 }),
      Error,
      "idle timeouts",
    );
  });

  it("reports a typed error when WebSocketPair is unavailable", () => {
    const adapter = new CloudflareServerAdapter();

    assertThrows(
      () => adapter.upgradeWebSocket(createUpgradeRequest()),
      Error,
      "WebSocketPair",
    );
  });

  it("does not accept an orphan socket when response construction fails", () => {
    const { runtime, client, server } = createRuntime();
    runtime.createResponse = () => {
      throw new Error("unsupported response");
    };
    const adapter = new CloudflareServerAdapter(runtime);

    assertThrows(
      () => adapter.upgradeWebSocket(createUpgradeRequest()),
      Error,
      "Unable to accept",
    );
    assertEquals(server.accepted, false);
    assertEquals(server.closeCalls, 1);
    assertEquals(client.closeCalls, 1);
  });
});

describe("CloudflareServer", () => {
  it("does not report a fictional listener address", async () => {
    const server = new CloudflareServer();

    assertThrows(() => server.addr, Error, "do not bind");
    await assertRejects(() => server.stop(), Error, "do not bind");
  });
});
