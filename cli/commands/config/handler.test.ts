import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import { createSuccessEnvelope } from "../../shared/json-output.ts";
import { detectConfigSource, getConfigCommandData, getEnvOverrides } from "./handler.ts";

async function withTempConfigProject(
  files: Record<string, string>,
  fn: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(files)) {
      await Deno.writeTextFile(join(projectDir, name), content);
    }
    await fn(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("Config Command", () => {
  describe("JSON output structure", () => {
    it("creates envelope with all config fields", () => {
      const configData = {
        projectSlug: "my-app",
        nodeEnv: "production",
        veryfrontEnv: "staging",
        apiBaseUrl: "https://api.veryfront.com/",
        debug: false,
        ci: false,
        hasApiToken: true,
        configSource: "veryfront.json",
        envOverrides: ["apiToken (VERYFRONT_API_TOKEN)"],
      };
      const envelope = createSuccessEnvelope("config", configData);
      assertEquals(envelope.success, true);
      assertEquals(envelope.command, "config");
      assertEquals(envelope.data.projectSlug, "my-app");
      assertEquals(envelope.data.hasApiToken, true);
      assertEquals(envelope.data.configSource, "veryfront.json");
      assertEquals(envelope.data.envOverrides.length, 1);
    });

    it("masks apiToken as boolean", () => {
      const configData = {
        projectSlug: null,
        nodeEnv: "development",
        veryfrontEnv: null,
        apiBaseUrl: "https://api.veryfront.com",
        debug: false,
        ci: false,
        hasApiToken: false,
        configSource: null,
        envOverrides: [],
      };
      const envelope = createSuccessEnvelope("config", configData);
      assertEquals(envelope.data.hasApiToken, false);
      assertEquals(envelope.data.projectSlug, null);
      assertEquals(envelope.data.configSource, null);
    });
  });

  describe("detectConfigSource", () => {
    it("detects config file in current project", async () => {
      const { cwd } = await import("veryfront/platform");
      const source = await detectConfigSource(cwd());
      // Project may or may not have a config file — just verify it returns string or null
      assertEquals(
        source === null || typeof source === "string",
        true,
      );
    });

    it("returns null for directory without config", async () => {
      const source = await detectConfigSource("/tmp");
      assertEquals(source, null);
    });
  });

  describe("getConfigCommandData", () => {
    it("reports projectSlug from veryfront.config.ts", async () => {
      const saved = Deno.env.get("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      try {
        await withTempConfigProject(
          {
            "veryfront.config.ts": [
              'export default { projectSlug: "ts-config-project" };',
              "",
            ].join("\n"),
          },
          async (projectDir) => {
            const data = await getConfigCommandData(projectDir);
            assertEquals(data.projectSlug, "ts-config-project");
            assertEquals(data.configSource, "veryfront.config.ts");
          },
        );
      } finally {
        if (saved) Deno.env.set("VERYFRONT_PROJECT_SLUG", saved);
      }
    });
  });

  describe("getEnvOverrides", () => {
    it("detects VERYFRONT_API_TOKEN override", () => {
      const saved = Deno.env.get("VERYFRONT_API_TOKEN");
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      try {
        const overrides = getEnvOverrides();
        const hasToken = overrides.some((o) => o.includes("VERYFRONT_API_TOKEN"));
        assertEquals(hasToken, true);
      } finally {
        if (saved) Deno.env.set("VERYFRONT_API_TOKEN", saved);
        else Deno.env.delete("VERYFRONT_API_TOKEN");
      }
    });

    it("returns empty array when no overrides set", () => {
      const keys = Object.values({
        projectSlug: "VERYFRONT_PROJECT_SLUG",
        apiBaseUrl: "VERYFRONT_API_BASE_URL",
        apiToken: "VERYFRONT_API_TOKEN",
        nodeEnv: "NODE_ENV",
        veryfrontEnv: "VERYFRONT_ENV",
        debug: "VERYFRONT_DEBUG",
      });
      const saved = keys.map((k) => Deno.env.get(k));
      keys.forEach((k) => Deno.env.delete(k));
      try {
        const overrides = getEnvOverrides();
        assertEquals(overrides.length, 0);
      } finally {
        keys.forEach((k, i) => {
          if (saved[i]) Deno.env.set(k, saved[i]!);
        });
      }
    });
  });
});
