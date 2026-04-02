import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compareVersions, shouldSkip } from "./update-check.ts";
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
});
