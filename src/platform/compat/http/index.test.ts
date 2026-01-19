import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  convertNodeRequestToWebRequest,
  createHttpServer,
  DenoHttpServer,
  NodeHttpServer,
} from "./index.ts";

describe("compat/http/index.ts exports", () => {
  it("should export DenoHttpServer class", () => {
    assertExists(DenoHttpServer);
    assertEquals(typeof DenoHttpServer, "function");
  });

  it("should export NodeHttpServer class", () => {
    assertExists(NodeHttpServer);
    assertEquals(typeof NodeHttpServer, "function");
  });

  it("should export convertNodeRequestToWebRequest function", () => {
    assertExists(convertNodeRequestToWebRequest);
    assertEquals(typeof convertNodeRequestToWebRequest, "function");
  });

  it("should export createHttpServer factory function", () => {
    assertExists(createHttpServer);
    assertEquals(typeof createHttpServer, "function");
  });
});
