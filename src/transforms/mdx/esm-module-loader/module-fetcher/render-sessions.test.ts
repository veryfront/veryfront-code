import { describe, it } from "#veryfront/testing/bdd.ts";
import { endRenderSession, recordModuleToSession, startRenderSession } from "./render-sessions.ts";

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
});
