import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  checkForUpdates,
  compareVersions,
  getUpdateInstallCommand,
  shouldSkip,
  UPDATE_INSTALL_COMMAND,
  UPDATE_REGISTRY_URL,
} from "./update-check.ts";
import { setJsonMode } from "./json-output.ts";
import { setQuietMode } from "../utils/index.ts";

describe("update-check", () => {
  describe("compareVersions", () => {
    it("detects newer major version", () => {
      assertEquals(compareVersions("1.0.0", "2.0.0"), true);
    });

    it("detects newer minor version", () => {
      assertEquals(compareVersions("1.2.0", "1.3.0"), true);
    });

    it("detects newer patch version", () => {
      assertEquals(compareVersions("1.2.3", "1.2.4"), true);
    });

    it("returns false for same version", () => {
      assertEquals(compareVersions("1.2.3", "1.2.3"), false);
    });

    it("returns false for older version", () => {
      assertEquals(compareVersions("2.0.0", "1.0.0"), false);
    });

    it("handles version with fewer segments", () => {
      assertEquals(compareVersions("1.0", "1.1"), true);
    });

    it("returns false when current is newer", () => {
      assertEquals(compareVersions("1.3.0", "1.2.0"), false);
    });
  });

  describe("shouldSkip", () => {
    function restoreEnv(keys: string[], saved: (string | undefined)[]) {
      keys.forEach((k, i) => {
        if (saved[i] === undefined) Deno.env.delete(k);
        else Deno.env.set(k, saved[i]!);
      });
      setJsonMode(false);
      setQuietMode(false);
    }

    it("skips when VERYFRONT_NO_UPDATE_CHECK=1", () => {
      const saved = Deno.env.get("VERYFRONT_NO_UPDATE_CHECK");
      Deno.env.set("VERYFRONT_NO_UPDATE_CHECK", "1");
      try {
        assertEquals(shouldSkip(), true);
      } finally {
        restoreEnv(["VERYFRONT_NO_UPDATE_CHECK"], [saved]);
      }
    });

    it("skips when CI=true", () => {
      const saved = Deno.env.get("CI");
      Deno.env.set("CI", "true");
      try {
        assertEquals(shouldSkip(), true);
      } finally {
        restoreEnv(["CI"], [saved]);
      }
    });

    it("skips when GITHUB_ACTIONS is set", () => {
      const saved = Deno.env.get("GITHUB_ACTIONS");
      Deno.env.set("GITHUB_ACTIONS", "true");
      try {
        assertEquals(shouldSkip(), true);
      } finally {
        restoreEnv(["GITHUB_ACTIONS"], [saved]);
      }
    });

    it("skips in JSON mode", () => {
      setJsonMode(true);
      try {
        assertEquals(shouldSkip(), true);
      } finally {
        setJsonMode(false);
      }
    });

    it("skips in quiet mode", () => {
      setQuietMode(true);
      try {
        assertEquals(shouldSkip(), true);
      } finally {
        setQuietMode(false);
      }
    });

    it("does not skip under normal conditions", () => {
      const keys = [
        "VERYFRONT_NO_UPDATE_CHECK",
        "CI",
        "GITHUB_ACTIONS",
        "GITLAB_CI",
        "JENKINS_URL",
        "CIRCLECI",
        "BUILDKITE",
      ];
      const saved = keys.map((k) => Deno.env.get(k));
      keys.forEach((k) => Deno.env.delete(k));
      setJsonMode(false);
      setQuietMode(false);
      try {
        assertEquals(shouldSkip(), false);
      } finally {
        restoreEnv(keys, saved);
      }
    });
  });

  describe("registry lookup", () => {
    it("selects update commands that preserve the active install method", () => {
      assertEquals(
        getUpdateInstallCommand({
          standalone: false,
          executablePath: "prefix/homebrew/bin/node",
        }),
        "npm install -g veryfront@latest",
      );
      assertEquals(
        getUpdateInstallCommand({
          standalone: true,
          executablePath: "prefix/homebrew/lib/node_modules/veryfront/bin/veryfront",
        }),
        "npm install -g veryfront@latest",
      );
      assertEquals(
        getUpdateInstallCommand({
          standalone: true,
          executablePath: "prefix/homebrew/bin/veryfront",
        }),
        "brew upgrade veryfront/tap/veryfront",
      );
      assertEquals(
        getUpdateInstallCommand({
          standalone: true,
          executablePath: "prefix/.veryfront/bin/veryfront",
        }),
        "curl -fsSL https://veryfront.com/install.sh | sh",
      );
    });

    it("reads and caches the npm latest response", async () => {
      const writes: Array<{ path: string; data: string }> = [];
      const notices: Array<{ current: string; latest: string }> = [];

      await checkForUpdates("1.2.3", {
        shouldSkip: () => false,
        cacheLocation: {
          directory: "cache/veryfront",
          file: "cache/veryfront/update-check.json",
        },
        fileSystem: {
          readTextFile: () => Promise.reject(new Error("missing")),
          mkdir: () => Promise.resolve(),
          writeTextFile: (path, data) => {
            writes.push({ path, data });
            return Promise.resolve();
          },
        },
        fetcher: (input) => {
          assertEquals(String(input), "https://registry.npmjs.org/veryfront/latest");
          return Promise.resolve(Response.json({ version: "1.2.4" }));
        },
        now: () => 123,
        printNotice: (current, latest) => notices.push({ current, latest }),
      });

      assertEquals(UPDATE_REGISTRY_URL, "https://registry.npmjs.org/veryfront/latest");
      assertEquals(UPDATE_INSTALL_COMMAND, "npm install -g veryfront@latest");
      assertEquals(writes, [{
        path: "cache/veryfront/update-check.json",
        data: JSON.stringify({ lastCheck: 123, latestVersion: "1.2.4" }),
      }]);
      assertEquals(notices, [{ current: "1.2.3", latest: "1.2.4" }]);
    });

    it("prints a valid update notice when cache persistence fails", async () => {
      const diagnostics: string[] = [];
      const notices: Array<{ current: string; latest: string }> = [];

      await checkForUpdates("1.2.3", {
        shouldSkip: () => false,
        cacheLocation: {
          directory: "cache/veryfront",
          file: "cache/veryfront/update-check.json",
        },
        fileSystem: {
          readTextFile: () => Promise.reject(new Error("missing")),
          mkdir: () => Promise.resolve(),
          writeTextFile: () => Promise.reject(new Error("read-only cache")),
        },
        fetcher: () => Promise.resolve(Response.json({ version: "1.2.4" })),
        printNotice: (current, latest) => notices.push({ current, latest }),
        debug: (message) => diagnostics.push(message),
      });

      assertEquals(notices, [{ current: "1.2.3", latest: "1.2.4" }]);
      assertEquals(diagnostics, ["Veryfront could not cache the update check."]);
    });

    it("reports a broken registry endpoint in verbose diagnostics", async () => {
      const diagnostics: string[] = [];

      await checkForUpdates("1.2.3", {
        shouldSkip: () => false,
        cacheLocation: {
          directory: "cache/veryfront",
          file: "cache/veryfront/update-check.json",
        },
        fileSystem: {
          readTextFile: () => Promise.reject(new Error("missing")),
          mkdir: () => Promise.resolve(),
          writeTextFile: () => Promise.resolve(),
        },
        fetcher: () => Promise.resolve(new Response(null, { status: 404 })),
        debug: (message) => diagnostics.push(message),
      });

      assertEquals(diagnostics, [
        "Veryfront could not check for updates: npm registry returned 404.",
      ]);
    });
  });
});
