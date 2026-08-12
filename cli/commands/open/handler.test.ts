import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import { parseCliArgs } from "#cli/shared/args";
import { buildUrl, parseOpenArgs } from "./command.ts";
import { createSuccessEnvelope, setJsonMode } from "../../shared/json-output.ts";
import { reportProjectNotFound, resolveOpenProjectSlug } from "./handler.ts";

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

const PROJECT_REFERENCE_ENV_KEYS = [
  "VERYFRONT_PROJECT_SLUG",
  "TENANT_PROJECT_SLUG",
  "VERYFRONT_PROJECT_ID",
  "TENANT_PROJECT_ID",
  "VERYFRONT_API_URL",
  "VERYFRONT_API_BASE_URL",
] as const;

async function withSavedEnv(fn: () => Promise<void> | void): Promise<void> {
  const saved = new Map(
    PROJECT_REFERENCE_ENV_KEYS.map((key) => [key, Deno.env.get(key)]),
  );
  try {
    for (const key of PROJECT_REFERENCE_ENV_KEYS) Deno.env.delete(key);
    await fn();
  } finally {
    for (const key of PROJECT_REFERENCE_ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

async function withTempProject(
  fn: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  try {
    await fn(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

/** The link `push`/`deploy` write into a project directory. */
async function writeProjectLink(
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

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

describe("Open Command", () => {
  describe("buildUrl", () => {
    it("builds dashboard URL", () => {
      const url = buildUrl("my-app", { studio: false });
      assertEquals(url, "https://veryfront.com/projects/my-app");
    });

    it("builds studio URL", () => {
      const url = buildUrl("my-app", { studio: true });
      assertEquals(url, "https://veryfront.com/studio/my-app");
    });

    it("builds environment URL that opens the Environments panel", () => {
      // `/projects/<slug>/environments/<name>` is not a Studio route — it is a
      // hard 404. Environments are a panel on the project page, addressed by the
      // `?panels=` query param.
      const url = buildUrl("my-app", { env: "staging", studio: false });
      assertEquals(
        url,
        "https://veryfront.com/projects/my-app?panels=environments",
      );
    });

    it("never builds an /environments/ path segment for any env name", () => {
      // Regression guard: the dashboard has no `/environments/` route at all,
      // so no env name may produce one.
      for (const env of ["production", "staging", "preview"]) {
        const url = buildUrl("my-app", { env, studio: false });
        assertEquals(url.includes("/environments/"), false, `env=${env}`);
      }
    });

    it("studio flag takes precedence over env", () => {
      const url = buildUrl("my-app", { env: "staging", studio: true });
      assertEquals(url, "https://veryfront.com/studio/my-app");
    });

    it("uses project slug with --project override", () => {
      const url = buildUrl("custom-slug", { studio: false });
      assertEquals(url, "https://veryfront.com/projects/custom-slug");
    });

    it("builds the deployed site URL with --site", () => {
      const url = buildUrl("my-app", { studio: false, site: true });
      assertEquals(url, "https://my-app.production.veryfront.com");
    });

    it("builds the deployed site URL for a named environment", () => {
      const url = buildUrl("my-app", { env: "staging", studio: false, site: true });
      assertEquals(url, "https://my-app.staging.veryfront.com");
    });

    it("keeps --site on the deployed site rather than a dashboard page", () => {
      const url = buildUrl("my-app", { studio: true, site: true });
      assertEquals(url, "https://my-app.production.veryfront.com");
    });

    it("refuses a project slug that would change the site origin", () => {
      // `--site` is the only `open` path that interpolates into the URL
      // authority, so a slug carrying `/`, `?`, or `#` pushes the hard-coded
      // `.veryfront.com` suffix into the path and leaves an origin Veryfront
      // does not own. The slug can come from a cloned repo's `veryfront.json`,
      // so it is never trusted.
      for (const slug of ["evil.example/x", "evil.example?x", "evil.example#x"]) {
        assertThrows(
          () => buildUrl(slug, { studio: false, site: true }),
          Error,
          "DNS label",
        );
      }
    });

    it("refuses an environment that would change the site origin", () => {
      for (const env of ["attacker.example/", "a?b", "a#b"]) {
        assertThrows(
          () => buildUrl("my-app", { env, studio: false, site: true }),
          Error,
          "DNS label",
        );
      }
    });

    it("still builds dashboard URLs for a slug --site would reject", () => {
      // Dashboard URLs put the slug in the path, where it cannot move the
      // origin, so validation is scoped to `--site` and does not change them.
      const url = buildUrl("evil.example/x", { studio: false });
      assertEquals(url, "https://veryfront.com/projects/evil.example/x");
    });
  });

  describe("JSON output", () => {
    it("creates envelope with URL", () => {
      const url = buildUrl("my-app", { studio: false });
      const envelope = createSuccessEnvelope("open", { url });
      assertEquals(envelope.success, true);
      assertEquals(envelope.command, "open");
      assertEquals(envelope.data.url, "https://veryfront.com/projects/my-app");
    });
  });

  describe("parseOpenArgs", () => {
    it("parses -p as project slug from raw open argv", () => {
      const result = parseOpenArgs(parseCliArgs(["open", "-p", "my-project"]));
      assertSuccess(result);
      assertEquals(result.data.projectSlug, "my-project");
    });

    it("keeps --project-slug as a compatibility alias", () => {
      const result = parseOpenArgs(parseCliArgs(["open", "--project-slug", "my-project"]));
      assertSuccess(result);
      assertEquals(result.data.projectSlug, "my-project");
    });

    it("parses --site from raw open argv", () => {
      const result = parseOpenArgs(parseCliArgs(["open", "--site"]));
      assertSuccess(result);
      assertEquals(result.data.site, true);
    });
  });

  describe("resolveOpenProjectSlug", () => {
    it("resolves the project push and deploy linked in this directory", async () => {
      await withSavedEnv(async () => {
        await withTempProject(async (projectDir) => {
          await writeProjectLink(projectDir, "dx-dogfood-deploy");

          assertEquals(
            await resolveOpenProjectSlug(projectDir),
            "dx-dogfood-deploy",
          );
        });
      });
    });

    it("returns undefined for a directory with no project reference", async () => {
      await withSavedEnv(async () => {
        await withTempProject(async (projectDir) => {
          assertEquals(await resolveOpenProjectSlug(projectDir), undefined);
        });
      });
    });

    it("prefers --project over the local link", async () => {
      await withSavedEnv(async () => {
        await withTempProject(async (projectDir) => {
          await writeProjectLink(projectDir, "linked-project");

          assertEquals(
            await resolveOpenProjectSlug(projectDir, "flag-project"),
            "flag-project",
          );
        });
      });
    });

    it("prefers veryfront.json over the local link", async () => {
      await withSavedEnv(async () => {
        await withTempProject(async (projectDir) => {
          await writeProjectLink(projectDir, "linked-project");
          await Deno.writeTextFile(
            join(projectDir, "veryfront.json"),
            JSON.stringify({ projectSlug: "json-config-project" }),
          );

          assertEquals(
            await resolveOpenProjectSlug(projectDir),
            "json-config-project",
          );
        });
      });
    });

    it("prefers a tenant project reference over the local link", async () => {
      await withSavedEnv(async () => {
        Deno.env.set("TENANT_PROJECT_SLUG", "tenant-project");
        await withTempProject(async (projectDir) => {
          await writeProjectLink(projectDir, "linked-project");

          assertEquals(
            await resolveOpenProjectSlug(projectDir),
            "tenant-project",
          );
        });
      });
    });

    it("skips an ID-only reference rather than opening /projects/<id>", async () => {
      // `buildUrl` pastes what it is given into the dashboard path, and the
      // dashboard wants the canonical slug — `push` calls the API to turn a
      // project ID into one. `open` has no token, so the ID must not be used.
      await withSavedEnv(async () => {
        Deno.env.set("VERYFRONT_PROJECT_ID", "project-123");
        await withTempProject(async (projectDir) => {
          await writeProjectLink(projectDir, "linked-project");

          assertEquals(
            await resolveOpenProjectSlug(projectDir),
            "linked-project",
          );
        });
      });
    });

    it("reports no project when only a project ID is set", async () => {
      await withSavedEnv(async () => {
        Deno.env.set("TENANT_PROJECT_ID", "project-123");
        await withTempProject(async (projectDir) => {
          assertEquals(await resolveOpenProjectSlug(projectDir), undefined);
        });
      });
    });

    it("rejects a local link that targets a different control plane", async () => {
      await withSavedEnv(async () => {
        await withTempProject(async (projectDir) => {
          await writeProjectLink(
            projectDir,
            "linked-project",
            "https://api.other.veryfront.com",
          );

          await assertRejects(
            () => resolveOpenProjectSlug(projectDir),
            Error,
            ".veryfront/project.json",
          );
        });
      });
    });
  });

  describe("reportProjectNotFound", () => {
    it("emits a JSON error envelope in --json mode", async () => {
      setJsonMode(true);
      try {
        const output = await captureStdout(() => reportProjectNotFound());
        const parsed = JSON.parse(output);

        assertEquals(parsed.success, false);
        assertEquals(parsed.command, "open");
        assertEquals(parsed.error.code, "PROJECT_NOT_FOUND");
        assertEquals(parsed.error.message, "No project found.");
      } finally {
        setJsonMode(false);
      }
    });
  });
});
