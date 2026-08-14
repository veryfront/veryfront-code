import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext, HandlerResult } from "../types.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { DebugContextHandler } from "./debug-context.handler.ts";
import { DevFileHandler } from "./files/dev-file.handler.ts";
import { ClientLogHandler } from "../monitoring/client-log.handler.ts";
import { MemoryDebugHandler } from "../monitoring/memory.handler.ts";
import { MetricsHandler } from "../monitoring/metrics.handler.ts";

interface LocalControlCase {
  readonly name: string;
  readonly createHandler: () => {
    handle(request: Request, context: HandlerContext): Promise<HandlerResult>;
  };
  readonly url: string;
  readonly init?: RequestInit;
}

const LOCAL_CONTEXT = {
  isLocalProject: true,
  securityConfig: undefined,
} as unknown as HandlerContext;

const LOCAL_CONTROLS: readonly LocalControlCase[] = [
  {
    name: "development file bundling",
    createHandler: () => new DevFileHandler(),
    url: "http://localhost/_veryfront/fs/YXBwL3BhZ2UudHN4.js",
  },
  {
    name: "debug context",
    createHandler: () => new DebugContextHandler(),
    url: "http://localhost/_vf_debug/context",
  },
  {
    name: "metrics",
    createHandler: () => new MetricsHandler(),
    url: "http://localhost/_metrics",
  },
  {
    name: "memory GC",
    createHandler: () => new MemoryDebugHandler(),
    url: "http://localhost/_debug/memory/gc",
  },
  {
    name: "client logging",
    createHandler: () => new ClientLogHandler(),
    url: "http://localhost/_veryfront/log",
    init: { method: "POST", body: "{}" },
  },
];

function createControlRequest(
  control: LocalControlCase,
  options: {
    peer?: string;
    forwarded?: boolean;
    hostname?: string;
    fetchSite?: string;
  } = {},
): Request {
  const url = new URL(control.url);
  if (options.hostname) url.hostname = options.hostname;
  const headers = new Headers(control.init?.headers);
  headers.set("host", url.host);
  if (options.forwarded) headers.set("x-forwarded-for", "203.0.113.10");
  if (options.fetchSite) headers.set("sec-fetch-site", options.fetchSite);

  const request = new Request(url, { ...control.init, headers });
  if (options.peer) {
    recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: options.peer,
    });
  }
  return request;
}

async function assertDenied(control: LocalControlCase, request: Request): Promise<void> {
  const result = await control.createHandler().handle(request, LOCAL_CONTEXT);
  assertEquals(result.continue, false, control.name);
  assertExists(result.response, control.name);
  assertEquals(result.response.status, 403, control.name);
  assertEquals(result.response.headers.get("cache-control"), "no-store", control.name);
}

describe("privileged local-control admission", () => {
  for (const control of LOCAL_CONTROLS) {
    it(`${control.name} rejects requests without transport provenance`, async () => {
      await assertDenied(control, createControlRequest(control));
    });

    it(`${control.name} rejects a remote transport peer on a local authority`, async () => {
      await assertDenied(
        control,
        createControlRequest(control, {
          peer: "192.0.2.10",
          hostname: "project.localhost",
        }),
      );
    });

    it(`${control.name} rejects a declared proxy hop from loopback`, async () => {
      await assertDenied(
        control,
        createControlRequest(control, { peer: "127.0.0.1", forwarded: true }),
      );
    });

    for (const fetchSite of ["same-site", "cross-site"]) {
      it(`${control.name} rejects a ${fetchSite} browser request from loopback`, async () => {
        await assertDenied(
          control,
          createControlRequest(control, { peer: "127.0.0.1", fetchSite }),
        );
      });
    }
  }

  it("preserves trusted loopback access to the debug context", async () => {
    const control = LOCAL_CONTROLS.find(({ name }) => name === "debug context");
    assertExists(control);

    const result = await control.createHandler().handle(
      createControlRequest(control, { peer: "127.0.0.1" }),
      LOCAL_CONTEXT,
    );

    assertEquals(result.continue, false);
    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });
});
