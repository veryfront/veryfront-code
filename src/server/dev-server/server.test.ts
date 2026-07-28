import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter, Server } from "#veryfront/platform/adapters/base.ts";
import { RequestHandler } from "./request-handler.ts";
import { DevServer } from "./server.ts";

describe("DevServer lifecycle", () => {
  it("shares shutdown and never permits startup after shutdown begins", async () => {
    const server = new DevServer({
      projectDir: "/project",
      port: 3_000,
    });

    const firstStop = server.stop();
    const concurrentStop = server.stop();
    assertStrictEquals(firstStop, concurrentStop);
    await firstStop;
    assertStrictEquals(server.stop(), firstStop);

    await assertRejects(
      () => server.ready,
      Error,
      "stopped before becoming ready",
    );
    await assertRejects(
      () => server.start(),
      Error,
      "after shutdown has begun",
    );
  });

  it("retires its request handler after the listener and pipeline stop", async () => {
    const events: string[] = [];
    const runtimeHandler = Object.assign(
      (_request: Request) => Promise.resolve(new Response("ok")),
      { dispose: () => void events.push("request-handler") },
    );
    const requestHandler = new RequestHandler(
      "/project",
      {} as RuntimeAdapter,
      () => true,
      () => false,
      undefined,
      "project",
      "project-id",
      undefined,
      { runtimeHandlerFactory: () => Promise.resolve(runtimeHandler) },
    );
    await requestHandler.handleRequest(new Request("http://localhost/page"));

    const server = new DevServer({ projectDir: "/project", port: 3_000 });
    const internals = server as unknown as {
      pipeline: { onTeardown(callback: () => void): void };
      requestHandler?: RequestHandler;
      server?: Server;
    };
    internals.pipeline.onTeardown(() => void events.push("pipeline"));
    internals.requestHandler = requestHandler;
    internals.server = {
      addr: { hostname: "127.0.0.1", port: 3_000 },
      stop: () => {
        events.push("listener");
        return Promise.resolve();
      },
    };

    await server.stop();

    assertEquals(events, ["listener", "pipeline", "request-handler"]);
  });
});
