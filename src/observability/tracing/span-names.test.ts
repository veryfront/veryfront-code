import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { SpanNames } from "./span-names.ts";

describe("tracing/span-names", () => {
  it("should export HTTP span names", () => {
    assertEquals(SpanNames.HTTP_REQUEST, "http.request");
    assertEquals(SpanNames.HTTP_HANDLER, "http.handler");
  });

  it("should export render span names", () => {
    assertEquals(SpanNames.RENDER_PAGE, "render.page");
    assertEquals(SpanNames.RENDER_COMPONENT, "render.component");
    assertEquals(SpanNames.RENDER_LAYOUT, "render.layout");
    assertEquals(SpanNames.RENDER_SSR, "render.ssr");
    assertEquals(SpanNames.RENDER_RSC, "render.rsc");
  });

  it("should export data span names", () => {
    assertEquals(SpanNames.DATA_FETCH, "data.fetch");
    assertEquals(SpanNames.DATA_CACHE_GET, "data.cache.get");
    assertEquals(SpanNames.DATA_CACHE_SET, "data.cache.set");
  });

  it("should export build span names", () => {
    assertEquals(SpanNames.BUILD_BUNDLE, "build.bundle");
    assertEquals(SpanNames.BUILD_SPLIT, "build.split");
    assertEquals(SpanNames.BUILD_OPTIMIZE, "build.optimize");
    assertEquals(SpanNames.BUILD_COMPILE, "build.compile");
  });

  it("should export RSC span names", () => {
    assertEquals(SpanNames.RSC_RENDER, "rsc.render");
    assertEquals(SpanNames.RSC_SERIALIZE, "rsc.serialize");
    assertEquals(SpanNames.RSC_STREAM, "rsc.stream");
  });

  it("should export router span names", () => {
    assertEquals(SpanNames.ROUTER_MATCH, "router.match");
    assertEquals(SpanNames.ROUTER_RESOLVE, "router.resolve");
  });

  it("should have all span names as strings", () => {
    for (const key of Object.keys(SpanNames)) {
      assertExists(SpanNames[key as keyof typeof SpanNames]);
      assertEquals(typeof SpanNames[key as keyof typeof SpanNames], "string");
    }
  });
});
