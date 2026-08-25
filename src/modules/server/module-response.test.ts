import "#veryfront/schemas/_test-setup.ts";
/**
 * Module Response Tests
 *
 * Pins the exact status, Content-Type, and Cache-Control produced by each
 * module-serve failure helper. The moduleNotFound vs moduleRejected pair is
 * the regression fence for the whole point of this module: a miss must stay
 * cacheable and a rejection must never be cacheable, even though both are
 * HTTP_NOT_FOUND.
 *
 * @module modules/server/module-response.test
 */

import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  moduleBadRequest,
  moduleMethodNotAllowed,
  moduleNotFound,
  moduleRejected,
  moduleServiceUnavailable,
  unknownDependencySnapshot,
} from "./module-response.ts";

describe("moduleNotFound", () => {
  it("is 404 with a cacheable Cache-Control", async () => {
    const res = moduleNotFound("GET");
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assertEquals(res.headers.get("Cache-Control"), "no-cache");
    assertEquals(await res.text(), "Module not found");
  });

  it("accepts a custom message", async () => {
    const res = moduleNotFound("GET", "Snippet not found");
    assertEquals(await res.text(), "Snippet not found");
    assertEquals(res.headers.get("Cache-Control"), "no-cache");
  });

  it("omits the body on HEAD", async () => {
    const res = moduleNotFound("HEAD");
    assertStrictEquals(await res.text(), "");
  });
});

describe("moduleRejected", () => {
  it("is 404 with an uncacheable Cache-Control", async () => {
    const res = moduleRejected("GET");
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    assertEquals(await res.text(), "Module not found");
  });

  it("omits the body on HEAD", async () => {
    const res = moduleRejected("HEAD");
    assertStrictEquals(await res.text(), "");
  });

  it("shares the same status as moduleNotFound but never the same Cache-Control", () => {
    const notFound = moduleNotFound("GET");
    const rejected = moduleRejected("GET");
    assertEquals(notFound.status, rejected.status);
    assertEquals(notFound.headers.get("Cache-Control"), "no-cache");
    assertEquals(rejected.headers.get("Cache-Control"), "no-store");
  });
});

describe("moduleBadRequest", () => {
  it("is 400 with a cacheable Cache-Control", async () => {
    const res = moduleBadRequest("GET", "Invalid module path");
    assertEquals(res.status, 400);
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assertEquals(res.headers.get("Cache-Control"), "no-cache");
    assertEquals(await res.text(), "Invalid module path");
  });
});

describe("moduleMethodNotAllowed", () => {
  it("is 405 with Allow and an uncacheable Cache-Control", async () => {
    const res = moduleMethodNotAllowed("POST");
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Allow"), "GET, HEAD");
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    assertEquals(await res.text(), "Method not allowed");
  });
});

describe("moduleServiceUnavailable", () => {
  it("is 503 with an uncacheable Cache-Control", async () => {
    const res = moduleServiceUnavailable("GET", "Browser module manifest unavailable");
    assertEquals(res.status, 503);
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    assertEquals(await res.text(), "Browser module manifest unavailable");
  });
});

describe("unknownDependencySnapshot", () => {
  it("is 409 with an uncacheable Cache-Control", async () => {
    const res = unknownDependencySnapshot("GET");
    assertEquals(res.status, 409);
    assertEquals(res.headers.get("Content-Type"), "text/plain; charset=utf-8");
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    assertEquals(await res.text(), "Unknown dependency snapshot");
  });

  it("omits the body on HEAD", async () => {
    const res = unknownDependencySnapshot("HEAD");
    assertStrictEquals(await res.text(), "");
  });
});
