import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { getReactDOMServer, getProjectReact } from "./server-loader.ts";

describe("server-loader", () => {
  describe("getProjectReact", () => {
    it("should return React module", async () => {
      const React = await getProjectReact();

      assertExists(React);
      assertExists(React.createElement);
      assertEquals(typeof React.createElement, "function");
    });

    it("should return same instance on multiple calls", async () => {
      const React1 = await getProjectReact();
      const React2 = await getProjectReact();

      assertEquals(React1, React2);
    });

    it("should have version property", async () => {
      const React = await getProjectReact();

      assertExists(React.version);
      assertEquals(typeof React.version, "string");
    });
  });

  describe("getReactDOMServer", () => {
    it("should return ReactDOMServer with render methods", async () => {
      const server = await getReactDOMServer();

      assertExists(server);
      assertExists(server.renderToString);
      assertExists(server.renderToStaticMarkup);
      assertEquals(typeof server.renderToString, "function");
      assertEquals(typeof server.renderToStaticMarkup, "function");
    });

    it("should have streaming methods for React 18+", async () => {
      const server = await getReactDOMServer();

      assertExists(server);
      assertEquals(
        server.renderToPipeableStream !== undefined ||
          server.renderToReadableStream !== undefined,
        true,
      );
    });

    it("should be callable multiple times", async () => {
      const server1 = await getReactDOMServer();
      const server2 = await getReactDOMServer();

      assertExists(server1);
      assertExists(server2);
      assertEquals(typeof server1.renderToString, "function");
      assertEquals(typeof server2.renderToString, "function");
    });
  });
});
