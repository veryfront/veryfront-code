import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SpanNames } from "./span-names.ts";

describe("observability/tracing/span-names", () => {
  describe("SpanNames", () => {
    it("should be a frozen-like constant object", () => {
      assertEquals(typeof SpanNames, "object");
      assert(SpanNames !== null);
    });

    it("should have HTTP span names", () => {
      assertEquals(SpanNames.HTTP_REQUEST, "http.request");
      assertEquals(SpanNames.HTTP_HANDLER, "http.handler");
      assertEquals(SpanNames.HTTP_CLIENT_FETCH, "http.client.fetch");
    });

    it("should have render span names", () => {
      assertEquals(SpanNames.RENDER_PAGE, "render.page");
      assertEquals(SpanNames.RENDER_COMPONENT, "render.component");
      assertEquals(SpanNames.RENDER_LAYOUT, "render.layout");
      assertEquals(SpanNames.RENDER_SSR, "render.ssr");
      assertEquals(SpanNames.RENDER_RSC, "render.rsc");
      assertEquals(SpanNames.RENDER_LOAD_MODULES, "render.load_modules");
      assertEquals(SpanNames.RENDER_FETCH_DATA, "render.fetch_data");
    });

    it("should have data span names", () => {
      assertEquals(SpanNames.DATA_FETCH, "data.fetch");
      assertEquals(SpanNames.DATA_CACHE_GET, "data.cache.get");
      assertEquals(SpanNames.DATA_CACHE_SET, "data.cache.set");
      assertEquals(SpanNames.DATA_FETCH_STATIC_PATHS, "data.fetch_static_paths");
    });

    it("should have build span names", () => {
      assertEquals(SpanNames.BUILD_BUNDLE, "build.bundle");
      assertEquals(SpanNames.BUILD_SPLIT, "build.split");
      assertEquals(SpanNames.BUILD_OPTIMIZE, "build.optimize");
      assertEquals(SpanNames.BUILD_COMPILE, "build.compile");
    });

    it("should have RSC span names", () => {
      assertEquals(SpanNames.RSC_RENDER, "rsc.render");
      assertEquals(SpanNames.RSC_SERIALIZE, "rsc.serialize");
      assertEquals(SpanNames.RSC_STREAM, "rsc.stream");
    });

    it("should have router span names", () => {
      assertEquals(SpanNames.ROUTER_MATCH, "router.match");
      assertEquals(SpanNames.ROUTER_RESOLVE, "router.resolve");
      assertEquals(SpanNames.ROUTER_DETECT_APP, "router.detect_app");
    });

    it("should have config span names", () => {
      assertEquals(SpanNames.CONFIG_LOAD, "config.load");
      assertEquals(SpanNames.CONFIG_LOAD_PROJECT, "config.load_project");
      assertEquals(SpanNames.CONFIG_TRANSPILE, "config.transpile");
    });

    it("should have layout span names", () => {
      assertEquals(SpanNames.LAYOUT_COLLECT, "layout.collect");
      assertEquals(SpanNames.LAYOUT_APPLY, "layout.apply");
      assertEquals(SpanNames.LAYOUT_WRAP_APP_COMPONENT, "layout.wrap_app_component");
    });

    it("should have MDX span names", () => {
      assertEquals(SpanNames.MDX_COMPILE, "mdx.compile");
      assertEquals(SpanNames.MDX_CACHE_GET, "mdx.cache.get");
      assertEquals(SpanNames.MDX_CACHE_SET, "mdx.cache.set");
    });

    it("should have API span names", () => {
      assertEquals(SpanNames.API_REQUEST, "api.request");
      assertEquals(SpanNames.API_GET_FILE, "api.get_file");
      assertEquals(SpanNames.API_LIST_FILES, "api.list_files");
      assertEquals(SpanNames.API_GET_PROJECT, "api.get_project");
      assertEquals(SpanNames.API_DOMAIN_LOOKUP, "api.domain_lookup");
    });

    it("should have domain span names", () => {
      assertEquals(SpanNames.DOMAIN_LOOKUP, "domain.lookup");
      assertEquals(SpanNames.DOMAIN_RELEASE_LOOKUP, "domain.release_lookup");
    });

    it("should have SSR span names", () => {
      assertEquals(SpanNames.SSR_LOAD_MODULE, "ssr.load_module");
      assertEquals(SpanNames.SSR_REACT_RENDER, "ssr.react_render");
      assertEquals(SpanNames.SSR_HTML_GENERATE, "ssr.html_generate");
    });

    it("should have cache span names", () => {
      assertEquals(SpanNames.CACHE_CHECK_SPECULATIVE, "cache.check_speculative");
      assertEquals(SpanNames.CACHE_DISTRIBUTED_INIT, "cache.distributed.init");
      assertEquals(SpanNames.CACHE_MULTI_TIER_GET, "cache.multi_tier.get");
      assertEquals(SpanNames.CACHE_MULTI_TIER_SET, "cache.multi_tier.set");
    });

    it("should have HTML span names", () => {
      assertEquals(SpanNames.HTML_GENERATE_SHELL_PARTS, "html.generate_shell_parts");
      assertEquals(SpanNames.HTML_WRAP_IN_SHELL, "html.wrap_in_shell");
      assertEquals(SpanNames.HTML_GENERATE_TAILWIND_CSS, "html.generate_tailwind_css");
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
      const uniqueValues = new Set(values);
      assertEquals(values.length, uniqueValues.size, "All span names should be unique");
    });
  });
});
