import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "../runtime.ts";
import { DenoHttpServer } from "./deno-server.ts";
import { createHttpServer } from "./factory.ts";
import { NodeHttpServer } from "./node-server.ts";
import type { HttpServer } from "./types.ts";

describe("createHttpServer", () => {
  it("should create the HttpServer implementation for the host runtime", () => {
    const server = createHttpServer();
    const expected: new () => HttpServer = isDeno ? DenoHttpServer : NodeHttpServer;
    assertInstanceOf(
      server,
      expected,
      "the factory selects the server implementation for the host runtime",
    );
    assertEquals(typeof server.serve, "function", "the selected server exposes serve");
  });
});
