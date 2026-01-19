/**
 * Route Module Manifest Tests
 *
 * Tests for the module dependency tracking system.
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
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
  // Clean up before tests
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
    const paths = getRouteModulePaths("test-project", "index");
    assertEquals(paths.length, 2);
    assertEquals(paths[0], "pages/index.js");
    assertEquals(paths[1], "components/Header.js");
  });

  it("recordSSRModules merges with existing manifest", () => {
    recordSSRModules("test-project", "index", [
      "_vf_modules/components/Footer.js",
    ]);

    const manifest = getRouteManifest("test-project", "index");
    assertExists(manifest);
    assertEquals(manifest.moduleCount, 3); // Original 2 + 1 new
  });

  it("generateModulePreloadHintsFromManifest returns HTML hints", () => {
    const hints = generateModulePreloadHintsFromManifest("test-project", "index", 10);
    assertEquals(hints.length, 3);
    assertEquals(hints[0], '<link rel="modulepreload" href="/_vf_modules/pages/index.js">');
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
    const critical = getCriticalModulePaths("test-project", "about");
    assertEquals(critical.length, 1);
    assertEquals(critical[0], "pages/about.js");
  });

  it("getManifestStats returns correct statistics", () => {
    const stats = getManifestStats();
    assertEquals(stats.routeCount, 2); // index and about
    assertEquals(stats.routes.length, 2);
  });

  it("clearProjectManifests removes project manifests", () => {
    clearProjectManifests("test-project");
    const manifest = getRouteManifest("test-project", "index");
    assertEquals(manifest, null);
  });

  it("handles undefined projectSlug gracefully", () => {
    recordSSRModules(undefined, "home", ["pages/home.js"]);
    const paths = getRouteModulePaths(undefined, "home");
    assertEquals(paths.length, 1);
    assertEquals(paths[0], "pages/home.js");
  });

  // Clean up after tests
  clearAllManifests();
});
