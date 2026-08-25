import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearAllManifests,
  getRouteModulePaths,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import {
  endRenderSession,
  hasRenderSession,
  recordModuleToSession,
  runInRenderSession,
  startRenderSession,
} from "./render-sessions.ts";

describe("render-sessions", () => {
  beforeEach(() => {
    clearAllManifests();
  });

  afterEach(() => {
    clearAllManifests();
  });

  it("starts and ends a session without error", () => {
    startRenderSession("test-1", "my-project", "/");
    assertEquals(hasRenderSession("test-1"), true, "a started session is live");
    endRenderSession("test-1");
    assertEquals(hasRenderSession("test-1"), false, "an ended session is no longer live");
  });

  it("handles ending a non-existent session gracefully", () => {
    endRenderSession("non-existent-session");
    assertEquals(
      hasRenderSession("non-existent-session"),
      false,
      "ending an unknown session must not create one",
    );
  });

  it("records modules to active session", () => {
    startRenderSession("test-2", "test-project", "/records");
    recordModuleToSession("_vf_modules/components/Foo.tsx");
    endRenderSession("test-2");

    assertEquals(
      getRouteModulePaths("test-project", "/records"),
      ["components/Foo.js"],
      "the module recorded during the session reaches the route manifest",
    );
  });

  it("recordModuleToSession is no-op when no active session", () => {
    recordModuleToSession("_vf_modules/some/module.ts");

    startRenderSession("test-2b", "test-project", "/no-op");
    recordModuleToSession("_vf_modules/other/module.ts");
    endRenderSession("test-2b");

    assertEquals(
      getRouteModulePaths("test-project", "/no-op"),
      ["other/module.js"],
      "a module recorded outside any session must not leak into the next session",
    );
  });

  it("strips _vf_modules/ prefix and converts extensions", () => {
    startRenderSession("test-3", "test-project", "/docs");
    recordModuleToSession("_vf_modules/components/Button.tsx");
    recordModuleToSession("_vf_modules/lib/helpers.ts");
    recordModuleToSession("_vf_modules/widgets/Card.jsx");
    recordModuleToSession("_vf_modules/content/Intro.mdx");
    recordModuleToSession("vendor/plain.js");
    endRenderSession("test-3");

    assertEquals(
      getRouteModulePaths("test-project", "/docs"),
      [
        "components/Button.js",
        "lib/helpers.js",
        "widgets/Card.js",
        "content/Intro.js",
        "vendor/plain.js",
      ],
      "records the _vf_modules-stripped, .js-normalised paths",
    );
  });

  it("handles session with projectSlug and route for manifest recording", () => {
    startRenderSession("test-4", "test-project", "/about");
    recordModuleToSession("_vf_modules/pages/about.tsx");
    endRenderSession("test-4");

    assertEquals(
      getRouteModulePaths("test-project", "/about"),
      ["pages/about.js"],
      "the ended session records its collected modules to the route manifest",
    );
  });

  it("records nothing when the session has no projectSlug or route", () => {
    startRenderSession("test-5");
    recordModuleToSession("_vf_modules/pages/about.tsx");
    endRenderSession("test-5");

    assertEquals(
      getRouteModulePaths(undefined, "/about"),
      [],
      "a session without projectSlug and route records nothing",
    );
  });

  it("declines to attribute a module when two sessions are open", () => {
    startRenderSession("s-b", "proj-rs", "/b");
    startRenderSession("s-a", "proj-rs", "/a");
    recordModuleToSession("_vf_modules/x.tsx");
    endRenderSession("s-a");
    endRenderSession("s-b");

    assertEquals(
      getRouteModulePaths("proj-rs", "/a"),
      [],
      "an ambiguous session must not be guessed",
    );
    assertEquals(
      getRouteModulePaths("proj-rs", "/b"),
      [],
      "an ambiguous session must not be guessed for the other render either",
    );
  });

  it("attributes a module to the session bound on the async context", () => {
    startRenderSession("s-b", "proj-rs", "/b");
    startRenderSession("s-a", "proj-rs", "/a");
    runInRenderSession("s-a", () => recordModuleToSession("_vf_modules/x.tsx"));
    endRenderSession("s-a");
    endRenderSession("s-b");

    assertEquals(
      getRouteModulePaths("proj-rs", "/a"),
      ["x.js"],
      "the module lands in the bound session",
    );
    assertEquals(
      getRouteModulePaths("proj-rs", "/b"),
      [],
      "the other concurrent render is untouched",
    );
  });
});
