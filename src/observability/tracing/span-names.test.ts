import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SpanNames } from "./span-names.ts";

describe("observability/tracing/span-names", () => {
  it("should be a frozen-like constant object", () => {
    assertEquals(typeof SpanNames, "object");
    assert(SpanNames !== null);
  });

  it("should have expected span names", () => {
    const expected: Record<string, string> = {
      HTTP_REQUEST: "http.request",
      HTTP_HANDLER: "http.handler",
      HTTP_CLIENT_FETCH: "http.client.fetch",

      RENDER_PAGE: "render.page",
      RENDER_COMPONENT: "render.component",
      RENDER_LAYOUT: "render.layout",
      RENDER_SSR: "render.ssr",
      RENDER_RSC: "render.rsc",
      RENDER_LOAD_MODULES: "render.load_modules",
      RENDER_FETCH_DATA: "render.fetch_data",

      DATA_FETCH: "data.fetch",
      DATA_CACHE_GET: "data.cache.get",
      DATA_CACHE_SET: "data.cache.set",
      DATA_FETCH_STATIC_PATHS: "data.fetch_static_paths",

      BUILD_BUNDLE: "build.bundle",
      BUILD_SPLIT: "build.split",
      BUILD_OPTIMIZE: "build.optimize",
      BUILD_COMPILE: "build.compile",

      RSC_RENDER: "rsc.render",
      RSC_SERIALIZE: "rsc.serialize",
      RSC_STREAM: "rsc.stream",

      ROUTER_MATCH: "router.match",
      ROUTER_RESOLVE: "router.resolve",
      ROUTER_DETECT_APP: "router.detect_app",

      CONFIG_LOAD: "config.load",
      CONFIG_LOAD_PROJECT: "config.load_project",
      CONFIG_TRANSPILE: "config.transpile",

      LAYOUT_COLLECT: "layout.collect",
      LAYOUT_APPLY: "layout.apply",
      LAYOUT_WRAP_APP_COMPONENT: "layout.wrap_app_component",

      MDX_COMPILE: "mdx.compile",
      MDX_CACHE_GET: "mdx.cache.get",
      MDX_CACHE_SET: "mdx.cache.set",

      API_REQUEST: "api.request",
      API_GET_FILE: "api.get_file",
      API_LIST_FILES: "api.list_files",
      API_GET_PROJECT: "api.get_project",
      API_DOMAIN_LOOKUP: "api.domain_lookup",

      DOMAIN_LOOKUP: "domain.lookup",
      DOMAIN_RELEASE_LOOKUP: "domain.release_lookup",

      SSR_LOAD_MODULE: "ssr.load_module",
      SSR_REACT_RENDER: "ssr.react_render",
      SSR_HTML_GENERATE: "ssr.html_generate",

      CACHE_CHECK_SPECULATIVE: "cache.check_speculative",
      CACHE_DISTRIBUTED_INIT: "cache.distributed.init",
      CACHE_MULTI_TIER_GET: "cache.multi_tier.get",
      CACHE_MULTI_TIER_SET: "cache.multi_tier.set",

      HTML_GENERATE_SHELL_PARTS: "html.generate_shell_parts",
      HTML_WRAP_IN_SHELL: "html.wrap_in_shell",
      HTML_GENERATE_TAILWIND_CSS: "html.generate_tailwind_css",
    };

    for (const [key, value] of Object.entries(expected)) {
      assertEquals(SpanNames[key as keyof typeof SpanNames], value);
    }
  });

  it("should have all values as non-empty strings", () => {
    for (const [key, value] of Object.entries(SpanNames)) {
      assertEquals(typeof value, "string", `${key} should be a string`);
      assert(value.length > 0, `${key} should be non-empty`);
    }
  });

  it("should have all values using dot notation format", () => {
    for (const [key, value] of Object.entries(SpanNames)) {
      assert(
        /^[a-z][a-z0-9_.]+$/.test(value),
        `${key} value "${value}" should use dot notation with lowercase`,
      );
    }
  });

  it("should have unique values", () => {
    const values = Object.values(SpanNames);
    assertEquals(values.length, new Set(values).size, "All span names should be unique");
  });
});
