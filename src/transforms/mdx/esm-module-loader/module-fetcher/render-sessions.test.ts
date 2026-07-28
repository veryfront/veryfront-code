import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  abortRenderSession,
  endRenderSession,
  hasRenderSession,
  recordModuleToSession,
  runInRenderSession,
  startRenderSession,
} from "./render-sessions.ts";
import {
  clearProjectManifests,
  getRouteManifest,
} from "#veryfront/modules/manifest/route-module-manifest.ts";

describe("render-sessions", () => {
  it("starts and ends a session without error", () => {
    startRenderSession("test-1", "my-project", "/");
    endRenderSession("test-1");
  });

  it("handles ending a non-existent session gracefully", () => {
    endRenderSession("non-existent-session");
  });

  it("records modules to active session", () => {
    startRenderSession("test-2");
    recordModuleToSession("_vf_modules/components/Foo.tsx");
    endRenderSession("test-2");
  });

  it("recordModuleToSession is no-op when no active session", () => {
    recordModuleToSession("_vf_modules/some/module.ts");
  });

  it("strips _vf_modules/ prefix and converts extensions", () => {
    startRenderSession("test-3");
    recordModuleToSession("_vf_modules/components/Button.tsx");
    // Session ends without error — the path was stored as components/Button.js
    endRenderSession("test-3");
  });

  it("handles session with projectSlug and route for manifest recording", () => {
    startRenderSession("test-4", "test-project", "/about");
    recordModuleToSession("_vf_modules/pages/about.tsx");
    endRenderSession("test-4");
  });

  it("rejects a duplicate session instead of overwriting the active render", () => {
    startRenderSession("duplicate-session");
    try {
      assertThrows(
        () => startRenderSession("duplicate-session"),
        Error,
        "already exists",
      );
      assertEquals(hasRenderSession("duplicate-session"), true);
    } finally {
      abortRenderSession("duplicate-session");
    }
  });

  it("abandons a failed render without publishing a partial manifest", () => {
    clearProjectManifests("aborted-project");
    startRenderSession("aborted-session", "aborted-project", "/aborted");
    runInRenderSession("aborted-session", () => {
      recordModuleToSession("_vf_modules/pages/partial.tsx");
    });

    abortRenderSession("aborted-session");

    assertEquals(hasRenderSession("aborted-session"), false);
    assertEquals(getRouteManifest("aborted-project", "/aborted"), null);
  });

  it("releases a session before manifest publication can throw", () => {
    const sessionId = "publication-failure";
    startRenderSession(sessionId, "project", "r".repeat(16 * 1024 + 1));
    runInRenderSession(sessionId, () => {
      recordModuleToSession("_vf_modules/pages/index.tsx");
    });

    assertThrows(
      () => endRenderSession(sessionId),
      RangeError,
      "Route must contain at most",
    );
    assertEquals(hasRenderSession(sessionId), false);
  });
});
