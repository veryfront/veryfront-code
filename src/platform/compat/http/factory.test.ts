import { assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
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
