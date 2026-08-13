import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for app actions.
 *
 * Everything runs against a fake LauncherHost, no processes, no browser, no
 * disk. The seam is the test surface.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createLauncher, type IDE, type LauncherHost } from "./actions.ts";
import type { ProjectInfo } from "./state.ts";

const LOCAL: ProjectInfo = { slug: "alpha", path: "/repo/alpha", type: "local" };

interface FakeHost extends LauncherHost {
  urls: string[];
  commands: Array<{ command: string; args: string[] }>;
  files: Map<string, string>;
}

function fakeHost(options: {
  installed?: IDE[] | string[];
  runFails?: boolean;
  openThrows?: boolean;
  existingFiles?: Record<string, string>;
  writeFails?: boolean;
} = {}): FakeHost {
  const installed = new Set<string>(options.installed ?? []);
  const urls: string[] = [];
  const commands: Array<{ command: string; args: string[] }> = [];
  const files = new Map<string, string>(Object.entries(options.existingFiles ?? {}));

  return {
    urls,
    commands,
    files,
    openUrl(url) {
      if (options.openThrows) return Promise.reject(new Error("no browser"));
      urls.push(url);
      return Promise.resolve();
    },
    commandExists: (command) => Promise.resolve(installed.has(command)),
    run(command, args) {
      commands.push({ command, args });
      return Promise.resolve(!options.runFails);
    },
    ensureFile(path, contents) {
      if (options.writeFails) return Promise.reject(new Error("read-only file system"));
      if (!files.has(path)) files.set(path, contents);
      return Promise.resolve();
    },
    homeDir: () => "/home/dev",
  };
}

describe("app/actions", () => {
  describe("openInBrowser", () => {
    it("opens the project's preview URL on the running port", async () => {
      const host = fakeHost();
      const result = await createLauncher(host).openInBrowser(LOCAL, 8080);

      assertEquals(host.urls, ["http://alpha.localhost:8080"]);
      assertEquals(result.success, true);
    });

    it("reports failure instead of throwing", async () => {
      const host = fakeHost({ openThrows: true });
      const result = await createLauncher(host).openInBrowser(LOCAL, 8080);

      assertEquals(result.success, false);
      assertEquals(host.urls, []);
    });
  });

  describe("openInStudio", () => {
    it("opens the Studio page for the project", async () => {
      const host = fakeHost();
      const result = await createLauncher(host).openInStudio(LOCAL);

      assertEquals(host.urls, ["https://veryfront.com/projects/alpha"]);
      assertEquals(result.message, "Opened Studio for alpha");
    });
  });

  describe("openInIDE", () => {
    it("prefers Cursor when several IDEs are installed", async () => {
      const host = fakeHost({ installed: ["code", "cursor", "zed"] });
      const result = await createLauncher(host).openInIDE(LOCAL);

      assertEquals(host.commands, [{ command: "cursor", args: ["/repo/alpha"] }]);
      assertEquals(result.message, "Opened alpha in Cursor");
    });

    it("falls through the detection order to the first installed IDE", async () => {
      const host = fakeHost({ installed: ["zed", "webstorm"] });
      await createLauncher(host).openInIDE(LOCAL);

      assertEquals(host.commands[0]?.command, "zed");
    });

    it("honours an explicitly requested IDE over the preferred one", async () => {
      const host = fakeHost({ installed: ["cursor", "code"] });
      const result = await createLauncher(host).openInIDE(LOCAL, "code");

      assertEquals(host.commands, [{ command: "code", args: ["/repo/alpha"] }]);
      assertEquals(result.message, "Opened alpha in VS Code");
    });

    it("explains what to install when no IDE is present", async () => {
      const host = fakeHost({ installed: [] });
      const result = await createLauncher(host).openInIDE(LOCAL);

      assertEquals(result.success, false);
      assertEquals(
        result.message,
        "No supported IDE found. Install VS Code, Cursor, or Zed.",
      );
      assertEquals(host.commands, []);
    });

    it("reports a launch that fails after detection succeeded", async () => {
      const host = fakeHost({ installed: ["cursor"], runFails: true });
      const result = await createLauncher(host).openInIDE(LOCAL);

      assertEquals(result.success, false);
      assertEquals(result.message, "Failed to open Cursor");
    });
  });

  describe("openMCPSettings", () => {
    it("creates the settings file under the home directory and opens it", async () => {
      const host = fakeHost({ installed: ["cursor"] });
      const result = await createLauncher(host).openMCPSettings();

      const path = "/home/dev/.claude/settings.json";
      assertEquals(JSON.parse(host.files.get(path) ?? "null"), { mcpServers: {} });
      assertEquals(host.commands, [{ command: "cursor", args: [path] }]);
      assertEquals(result.success, true);
    });

    it("leaves an existing settings file untouched", async () => {
      const path = "/home/dev/.claude/settings.json";
      const existing = '{"mcpServers":{"veryfront":{"type":"url"}}}';
      const host = fakeHost({ installed: ["cursor"], existingFiles: { [path]: existing } });

      await createLauncher(host).openMCPSettings();

      assertEquals(host.files.get(path), existing);
    });

    it("refuses to write when the home directory is unknown", async () => {
      // Joining "" would drop .claude/settings.json into the project and still
      // report success.
      const host = { ...fakeHost({ installed: ["cursor"] }), homeDir: () => "" };
      const result = await createLauncher(host).openMCPSettings();

      assertEquals(result.success, false);
      assertEquals(host.files.size, 0);
      assertEquals(host.commands, []);
    });

    it("reports a write failure instead of throwing", async () => {
      // Every other launcher method reports through ActionResult; throwing here
      // would reject inside the shell's key handling and read as a dead key.
      const host = fakeHost({ installed: ["cursor"], writeFails: true });
      const result = await createLauncher(host).openMCPSettings();

      assertEquals(result.success, false);
      assertEquals(result.message?.includes("read-only file system"), true);
      assertEquals(host.commands, []);
    });

    it("still creates the file but reports that no IDE could open it", async () => {
      const host = fakeHost({ installed: [] });
      const result = await createLauncher(host).openMCPSettings();

      assertEquals(host.files.has("/home/dev/.claude/settings.json"), true);
      assertEquals(host.commands, []);
      assertEquals(result.success, false);
    });
  });
});
