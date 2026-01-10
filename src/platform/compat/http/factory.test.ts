import { assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { createHttpServer } from "./factory.ts";

describe("createHttpServer", () => {
  it("should create an HttpServer instance", () => {
    const server = createHttpServer();
    assertExists(server);
    assertExists(server.serve);
  });

  it("should have serve method", () => {
    const server = createHttpServer();
    assertExists(server.serve);
  });
});
