import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  resolveInternalModuleTarget,
  resolveInternalModuleUrl,
  resolveVeryfrontModuleTarget,
  resolveVeryfrontModuleUrl,
} from "./veryfront-module-urls.ts";

describe("veryfront-module-urls", () => {
  it("resolves public exact mappings from deno.json", () => {
    assertEquals(resolveVeryfrontModuleTarget("veryfront/head"), "./src/react/runtime/core.ts");
    assertEquals(
      resolveVeryfrontModuleUrl("veryfront/head"),
      "/_vf_modules/_veryfront/react/runtime/core.js",
    );
  });

  it("resolves internal exact mappings from deno.json", () => {
    assertEquals(resolveInternalModuleTarget("#veryfront/utils"), "./src/utils/index.ts");
    assertEquals(
      resolveInternalModuleUrl("#veryfront/utils"),
      "/_vf_modules/_veryfront/utils/index.js",
    );
    assertEquals(
      resolveInternalModuleUrl("#veryfront/compat/console"),
      "/_vf_modules/_veryfront/platform/compat/console/index.js",
    );
  });

  it("resolves internal prefix mappings using the longest matching alias", () => {
    assertEquals(
      resolveInternalModuleTarget("#veryfront/compat/path/index.ts"),
      "./src/platform/compat/path/index.ts",
    );
    assertEquals(
      resolveInternalModuleUrl("#veryfront/compat/path/index.ts"),
      "/_vf_modules/_veryfront/platform/compat/path/index.js",
    );
  });

  it("falls back to the root #veryfront/ prefix for unmapped internal files", () => {
    assertEquals(
      resolveInternalModuleTarget("#veryfront/react/head-collector.ts"),
      "./src/react/head-collector.ts",
    );
    assertEquals(
      resolveInternalModuleUrl("#veryfront/react/head-collector.ts"),
      "/_vf_modules/_veryfront/react/head-collector.js",
    );
  });
});
