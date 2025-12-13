import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.ts";

describe("createAppRouteMethodNotAllowed", () => {
  it("should return 405 status", () => {
    const handler = { GET: () => {} };
    const response = createAppRouteMethodNotAllowed(handler);
    assertEquals(response.status, 405);
  });

  it("should include Allow header with single method", () => {
    const handler = { GET: () => {} };
    const response = createAppRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "GET");
  });

  it("should include Allow header with multiple methods", () => {
    const handler = {
      GET: () => {},
      POST: () => {},
      PUT: () => {},
    };
    const response = createAppRouteMethodNotAllowed(handler);
    const allow = response.headers.get("Allow");
    assertExists(allow);
    assertEquals(allow.includes("GET"), true);
    assertEquals(allow.includes("POST"), true);
    assertEquals(allow.includes("PUT"), true);
  });

  it("should only include implemented methods", () => {
    const handler = {
      GET: () => {},
      someOtherProp: "not a method",
    };
    const response = createAppRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "GET");
  });

  it("should handle all standard HTTP methods", () => {
    const handler = {
      GET: () => {},
      POST: () => {},
      PUT: () => {},
      PATCH: () => {},
      DELETE: () => {},
      HEAD: () => {},
      OPTIONS: () => {},
    };
    const response = createAppRouteMethodNotAllowed(handler);
    const allow = response.headers.get("Allow");
    assertExists(allow);
    assertEquals(allow, "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
  });

  it("should return empty Allow header when no methods implemented", () => {
    const handler = { notAMethod: "value" };
    const response = createAppRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "");
  });

  it("should return Method not allowed message", async () => {
    const handler = { GET: () => {} };
    const response = createAppRouteMethodNotAllowed(handler);
    const text = await response.text();
    assertEquals(text, "Method not allowed");
  });

  it("should ignore non-function properties", () => {
    const handler = {
      GET: () => {},
      POST: "not a function",
      PUT: 123,
      DELETE: null,
    };
    const response = createAppRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "GET");
  });
});

describe("createPagesRouteMethodNotAllowed", () => {
  it("should return 405 status", () => {
    const handler = { get: () => {} };
    const response = createPagesRouteMethodNotAllowed(handler);
    assertEquals(response.status, 405);
  });

  it("should include Allow header with methods", () => {
    const handler = {
      get: () => {},
      post: () => {},
    };
    const response = createPagesRouteMethodNotAllowed(handler);
    const allow = response.headers.get("Allow");
    assertExists(allow);
    assertEquals(allow.includes("get"), true);
    assertEquals(allow.includes("post"), true);
  });

  it("should exclude default export", () => {
    const handler = {
      default: () => {},
      get: () => {},
    };
    const response = createPagesRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "get");
  });

  it("should handle lowercase method names", () => {
    const handler = {
      get: () => {},
      post: () => {},
      put: () => {},
    };
    const response = createPagesRouteMethodNotAllowed(handler);
    const allow = response.headers.get("Allow");
    assertExists(allow);
    assertEquals(allow.includes("get"), true);
    assertEquals(allow.includes("post"), true);
    assertEquals(allow.includes("put"), true);
  });

  it("should return Method not allowed message", async () => {
    const handler = { get: () => {} };
    const response = createPagesRouteMethodNotAllowed(handler);
    const text = await response.text();
    assertEquals(text, "Method not allowed");
  });

  it("should ignore non-function properties", () => {
    const handler = {
      get: () => {},
      post: "not a function",
      someData: { nested: "value" },
    };
    const response = createPagesRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "get");
  });

  it("should handle empty handler", () => {
    const handler = {};
    const response = createPagesRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "");
  });

  it("should handle only default export", () => {
    const handler = {
      default: () => {},
    };
    const response = createPagesRouteMethodNotAllowed(handler);
    assertEquals(response.headers.get("Allow"), "");
  });

  it("should handle mixed case method names", () => {
    const handler = {
      GET: () => {},
      Post: () => {},
      put: () => {},
    };
    const response = createPagesRouteMethodNotAllowed(handler);
    const allow = response.headers.get("Allow");
    assertExists(allow);
    assertEquals(allow.includes("GET"), true);
    assertEquals(allow.includes("Post"), true);
    assertEquals(allow.includes("put"), true);
  });
});
