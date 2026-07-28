import "#veryfront/schemas/_test-setup.ts";
/**
 * Route Module Manifest Tests
 *
 * Tests for the module dependency tracking system.
 */

import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resetMetrics, state } from "#veryfront/observability/simple-metrics/index.ts";
import {
  clearAllManifests,
  clearProjectManifests,
  finishModuleCollection,
  generateModulePreloadHintsFromManifest,
  getCriticalModulePaths,
  getManifestStats,
  getRouteManifest,
  getRouteModulePaths,
  type ModuleEntry,
  recordModuleLoad,
  recordSSRModules,
  startModuleCollection,
} from "./route-module-manifest.ts";

describe("Route Module Manifest", () => {
  clearAllManifests();

  it("recordSSRModules creates manifest entry", () => {
    recordSSRModules("test-project", "index", [
      "_vf_modules/pages/index.js",
      "_vf_modules/components/Header.js",
    ]);

    const manifest = getRouteManifest("test-project", "index");
    assertExists(manifest);
    assertEquals(manifest.route, "index");
    assertEquals(manifest.moduleCount, 2);
  });

  it("getRouteModulePaths returns paths in order", () => {
    assertEquals(getRouteModulePaths("test-project", "index"), [
      "pages/index.js",
      "components/Header.js",
    ]);
  });

  it("recordSSRModules replaces stale modules for the route with the latest render graph", () => {
    recordSSRModules("test-project", "index", [
      "_vf_modules/components/Header.js",
      "_vf_modules/components/Footer.js",
    ]);

    const manifest = getRouteManifest("test-project", "index");
    assertExists(manifest);
    assertEquals(manifest.moduleCount, 2);
    assertEquals(
      manifest.modules.map((module) => module.path),
      ["components/Header.js", "components/Footer.js"],
    );
  });

  it("generateModulePreloadHintsFromManifest returns HTML hints", () => {
    const hints = generateModulePreloadHintsFromManifest("test-project", "index", 10);
    assertEquals(hints.length, 2);
    assertEquals(
      hints[0],
      '<link rel="modulepreload" href="/_vf_modules/components/Header.js">',
    );
  });

  it("collection API works for tracking", () => {
    const sessionId = "test-session-1";
    startModuleCollection(sessionId);
    recordModuleLoad(sessionId, "pages/about.js");
    recordModuleLoad(sessionId, "components/Nav.js");
    finishModuleCollection(sessionId, "test-project", "about", ["pages/about.js"]);

    const manifest = getRouteManifest("test-project", "about");
    assertExists(manifest);
    assertEquals(manifest.renderCount, 1);
  });

  it("getCriticalModulePaths returns critical modules only", () => {
    assertEquals(getCriticalModulePaths("test-project", "about"), ["pages/about.js"]);
  });

  it("getManifestStats returns correct statistics", () => {
    const stats = getManifestStats();
    assertEquals(stats.routeCount, 2);
    assertEquals(stats.routes.length, 2);
  });

  it("clearProjectManifests removes project manifests", () => {
    clearProjectManifests("test-project");
    assertEquals(getRouteManifest("test-project", "index"), null);
  });

  it("handles undefined projectSlug gracefully", () => {
    recordSSRModules(undefined, "home", ["pages/home.js"]);
    assertEquals(getRouteModulePaths(undefined, "home"), ["pages/home.js"]);
  });

  it("records route manifest LRU hit and miss totals", () => {
    clearAllManifests();
    resetMetrics();

    assertEquals(getRouteManifest("test-project", "missing"), null);
    recordSSRModules("test-project", "index", ["_vf_modules/pages/index.js"]);
    assertExists(getRouteManifest("test-project", "index"));

    assertEquals(state.routeManifestLruMisses, 1);
    assertEquals(state.routeManifestLruHits, 1);
  });

  it("uses injective project and route identities", () => {
    clearAllManifests();

    recordSSRModules(undefined, "", ["undefined-empty.js"]);
    recordSSRModules("default", "index", ["literal-default.js"]);
    recordSSRModules("a:b", "c", ["colon-project.js"]);
    recordSSRModules("a", "b:c", ["colon-route.js"]);

    assertEquals(getRouteModulePaths(undefined, ""), ["undefined-empty.js"]);
    assertEquals(getRouteModulePaths("default", "index"), ["literal-default.js"]);
    assertEquals(getRouteModulePaths("a:b", "c"), ["colon-project.js"]);
    assertEquals(getRouteModulePaths("a", "b:c"), ["colon-route.js"]);
  });

  it("does not expose mutable manifest cache state", () => {
    clearAllManifests();
    recordSSRModules("immutable", "page", ["one.js", "two.js"]);

    const manifest = getRouteManifest("immutable", "page");
    assertExists(manifest);
    assertThrows(
      () => (manifest.modules as ModuleEntry[]).reverse(),
      TypeError,
    );

    assertEquals(getRouteModulePaths("immutable", "page"), ["one.js", "two.js"]);
  });

  it("escapes preload href values and validates the requested limit", () => {
    clearAllManifests();
    recordSSRModules("escaped", "page", ['component"&<.js']);

    assertEquals(
      generateModulePreloadHintsFromManifest("escaped", "page", 1),
      [
        '<link rel="modulepreload" href="/_vf_modules/component&quot;&amp;&lt;.js">',
      ],
    );
    assertThrows(
      () => generateModulePreloadHintsFromManifest("escaped", "page", -1),
      RangeError,
      "maxHints",
    );
  });

  it("reports route names rather than internal cache keys", () => {
    clearAllManifests();
    recordSSRModules("stats-project", "stats-route", ["page.js"]);

    assertEquals(getManifestStats().routes, [{
      route: "stats-route",
      moduleCount: 1,
      renderCount: 1,
    }]);
  });

  clearAllManifests();
});
