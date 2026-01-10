import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
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
