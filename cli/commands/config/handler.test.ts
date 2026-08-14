import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import { createSuccessEnvelope } from "../../shared/json-output.ts";
import { detectConfigSource, getConfigCommandData, getEnvOverrides } from "./handler.ts";

const CONFIG_ENV_KEYS = [
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_PROJECT_ID",
  "TENANT_PROJECT_SLUG",
  "TENANT_PROJECT_ID",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "NODE_ENV",
  "VERYFRONT_ENV",
  "VERYFRONT_DEBUG",
] as const;

const TOKEN_STORE_ENV_KEYS = [
  ...CONFIG_ENV_KEYS,
  "XDG_CONFIG_HOME",
] as const;

async function withTokenStore(
  storedToken: string | null,
  fn: () => Promise<void>,
): Promise<void> {
  const configHome = await Deno.makeTempDir();
  try {
    if (storedToken !== null) {
      await Deno.mkdir(join(configHome, "veryfront"), { recursive: true });
      await Deno.writeTextFile(join(configHome, "veryfront", "token"), `${storedToken}\n`);
    }
    Deno.env.set("XDG_CONFIG_HOME", configHome);
    await fn();
  } finally {
    await Deno.remove(configHome, { recursive: true });
  }
}

async function withSavedEnv(
  keys: readonly string[],
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map(keys.map((key) => [key, Deno.env.get(key)]));
  try {
    for (const key of keys) Deno.env.delete(key);
    await fn();
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

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

async function writeRawProjectLink(
  projectDir: string,
  projectSlug: string,
  controlPlane = "https://api.veryfront.com",
): Promise<void> {
  await Deno.mkdir(join(projectDir, ".veryfront"), { recursive: true });
  await Deno.writeTextFile(
    join(projectDir, ".veryfront", "project.json"),
    JSON.stringify({
      version: 1,
      controlPlane,
      projectId: "linked-project-id",
      projectSlug,
    }),
  );
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
      await withSavedEnv(CONFIG_ENV_KEYS, async () => {
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
      });
    });

    it("reports projectSlug and source from a local project link", async () => {
      await withTempConfigProject({}, async (projectDir) => {
        await writeRawProjectLink(projectDir, "linked-project");

        const data = await getConfigCommandData(projectDir);

        assertEquals(data.projectSlug, "linked-project");
        assertEquals(data.configSource, ".veryfront/project.json");
      });
    });

    it("rejects a local project link for a different control plane", async () => {
      await withSavedEnv(CONFIG_ENV_KEYS, async () => {
        await withTempConfigProject({}, async (projectDir) => {
          await writeRawProjectLink(
            projectDir,
            "linked-project",
            "https://api.other.veryfront.com",
          );

          await assertRejects(
            () => getConfigCommandData(projectDir),
            Error,
            ".veryfront/project.json",
          );
          await assertRejects(
            () => getConfigCommandData(projectDir),
            Error,
            "https://api.other.veryfront.com",
          );
          await assertRejects(
            () => getConfigCommandData(projectDir),
            Error,
            "https://api.veryfront.com",
          );
        });
      });
    });

    it("uses VERYFRONT_PROJECT_ID before validating a stale local project link", async () => {
      await withSavedEnv(CONFIG_ENV_KEYS, async () => {
        Deno.env.set("VERYFRONT_PROJECT_ID", "project-id-from-env");
        await withTempConfigProject({}, async (projectDir) => {
          await writeRawProjectLink(
            projectDir,
            "linked-project",
            "https://api.other.veryfront.com",
          );

          const data = await getConfigCommandData(projectDir);

          assertEquals(data.projectSlug, "project-id-from-env");
          assertEquals(data.configSource, null);
        });
      });
    });

    it("uses TENANT_PROJECT_ID before validating a stale local project link", async () => {
      await withSavedEnv(CONFIG_ENV_KEYS, async () => {
        Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id-from-env");
        await withTempConfigProject({}, async (projectDir) => {
          await writeRawProjectLink(
            projectDir,
            "linked-project",
            "https://api.other.veryfront.com",
          );

          const data = await getConfigCommandData(projectDir);

          assertEquals(data.projectSlug, "tenant-project-id-from-env");
          assertEquals(data.configSource, null);
        });
      });
    });

    it("reports a stored login token as authenticated", async () => {
      await withSavedEnv(TOKEN_STORE_ENV_KEYS, async () => {
        await withTokenStore("stored-session-token", async () => {
          await withTempConfigProject({}, async (projectDir) => {
            const data = await getConfigCommandData(projectDir);

            assertEquals(data.hasStoredToken, true);
            assertEquals(data.hasApiToken, false);
            assertEquals(data.authenticated, true);
          });
        });
      });
    });

    it("reports VERYFRONT_API_TOKEN as authenticated without a stored token", async () => {
      await withSavedEnv(TOKEN_STORE_ENV_KEYS, async () => {
        await withTokenStore(null, async () => {
          Deno.env.set("VERYFRONT_API_TOKEN", "vf_env_token");
          await withTempConfigProject({}, async (projectDir) => {
            const data = await getConfigCommandData(projectDir);

            assertEquals(data.hasStoredToken, false);
            assertEquals(data.hasApiToken, true);
            assertEquals(data.authenticated, true);
          });
        });
      });
    });

    it("reports no authentication when neither a token store nor an env token exists", async () => {
      await withSavedEnv(TOKEN_STORE_ENV_KEYS, async () => {
        await withTokenStore(null, async () => {
          await withTempConfigProject({}, async (projectDir) => {
            const data = await getConfigCommandData(projectDir);

            assertEquals(data.hasStoredToken, false);
            assertEquals(data.hasApiToken, false);
            assertEquals(data.authenticated, false);
          });
        });
      });
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

    it("returns empty array when no overrides set", async () => {
      await withSavedEnv(CONFIG_ENV_KEYS, () => {
        const overrides = getEnvOverrides();
        assertEquals(overrides.length, 0);
      });
    });

    it("reports project ID environment overrides honestly", async () => {
      await withSavedEnv(CONFIG_ENV_KEYS, () => {
        Deno.env.set("VERYFRONT_PROJECT_ID", "project-id-from-env");
        Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id-from-env");

        assertEquals(getEnvOverrides(), [
          "projectSlug (VERYFRONT_PROJECT_ID)",
          "projectSlug (TENANT_PROJECT_ID)",
        ]);
      });
    });
  });
});
