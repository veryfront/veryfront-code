import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

    it("builds environment URL", () => {
      const url = buildUrl("my-app", { env: "staging", studio: false });
      assertEquals(
        url,
        "https://veryfront.com/projects/my-app/environments/staging",
      );
    });

    it("studio flag takes precedence over env", () => {
      const url = buildUrl("my-app", { env: "staging", studio: true });
      assertEquals(url, "https://veryfront.com/studio/my-app");
    });

    it("uses project slug with --project override", () => {
      const url = buildUrl("custom-slug", { studio: false });
      assertEquals(url, "https://veryfront.com/projects/custom-slug");
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
