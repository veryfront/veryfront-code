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

  it("honors critical flags recorded during collection", () => {
    startModuleCollection("critical-session");
    recordModuleLoad("critical-session", "pages/critical.js", true);
    recordModuleLoad("critical-session", "pages/normal.js");
    finishModuleCollection("critical-session", "test-project", "about");

    assertEquals(getCriticalModulePaths("test-project", "about"), [
      "pages/critical.js",
      "pages/about.js",
    ]);
  });

  it("rejects duplicate active collection identities", () => {
    startModuleCollection("duplicate-session");
    assertThrows(
      () => startModuleCollection("duplicate-session"),
      Error,
      "Module collection request is already active",
    );
    finishModuleCollection("duplicate-session", "test-project", "about");
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

  it("normalizes an empty route identity in stored manifests", () => {
    recordSSRModules("test-project", "", ["pages/index.js"]);
    assertEquals(getRouteManifest("test-project", "index")?.route, "index");
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

  it("returns defensive manifest copies", () => {
    clearAllManifests();
    recordSSRModules("copy-project", "copy-route", ["pages/original.js"]);
    const manifest = getRouteManifest("copy-project", "copy-route");
    assertExists(manifest);
    manifest.modules.push({ path: "pages/injected.js", critical: true, loadOrder: 0 });

    assertEquals(getRouteModulePaths("copy-project", "copy-route"), ["pages/original.js"]);
  });

  it("isolates project and route identities containing delimiters", () => {
    clearAllManifests();
    recordSSRModules("tenant:one", "route", ["pages/one.js"]);
    recordSSRModules("tenant", "one:route", ["pages/two.js"]);

    assertEquals(getRouteModulePaths("tenant:one", "route"), ["pages/one.js"]);
    assertEquals(getRouteModulePaths("tenant", "one:route"), ["pages/two.js"]);
    clearProjectManifests("tenant");
    assertEquals(getRouteManifest("tenant:one", "route")?.moduleCount, 1);
  });

  it("encodes safe module paths and rejects HTML injection", () => {
    clearAllManifests();
    recordSSRModules("safe", "route", [
      "components/My Component.js",
      'components/evil" onload="alert(1).js',
    ]);

    assertEquals(generateModulePreloadHintsFromManifest("safe", "route"), [
      '<link rel="modulepreload" href="/_vf_modules/components/My%20Component.js">',
    ]);
  });

  it("rejects invalid hint limits", () => {
    assertThrows(
      () => generateModulePreloadHintsFromManifest("safe", "route", -1),
      RangeError,
    );
    assertThrows(
      () => generateModulePreloadHintsFromManifest("safe", "route", 1.5),
      RangeError,
    );
  });

  clearAllManifests();
});
