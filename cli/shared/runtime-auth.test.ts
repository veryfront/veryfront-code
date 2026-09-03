import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, env, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { deleteHostSecret, getHostEnv } from "#cli/process-env";
import { join } from "veryfront/platform/path";
import { saveToken } from "../auth/token-store.ts";
import {
  applyRuntimeAuthContext,
  resolveLinkedProjectSlug,
  resolveRuntimeAuthContext,
} from "./runtime-auth.ts";

const ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
  "XDG_CONFIG_HOME",
] as const;
let tempDirs: string[] = [];

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
  deleteHostSecret("VERYFRONT_API_TOKEN");
}

async function writeRawProjectLink(projectDir: string, projectSlug: string): Promise<void> {
  await Deno.mkdir(join(projectDir, ".veryfront"), { recursive: true });
  await Deno.writeTextFile(
    join(projectDir, ".veryfront", "project.json"),
    JSON.stringify({
      version: 1,
      controlPlane: "https://api.veryfront.com",
      projectId: "linked-project-id",
      projectSlug,
    }),
  );
}

async function useTempConfigHome(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "vf-runtime-auth-" });
  tempDirs.push(dir);
  setEnv("XDG_CONFIG_HOME", dir);
  return dir;
}

describe("cli/shared/runtime-auth", () => {
  afterEach(async () => {
    clearEnv();
    for (const dir of tempDirs) {
      try {
        await Deno.remove(dir, { recursive: true });
      } catch {
        // expected: temp directory may already be gone
      }
    }
    tempDirs = [];
  });

  it("prefers explicit environment auth over the token store", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    setEnv("VERYFRONT_API_TOKEN", "env-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "env-project");
    setEnv("VERYFRONT_SERVICE_LAYER", "local");

    const context = await resolveRuntimeAuthContext({
      linkedProjectSlug: "config-project",
    });

    assertEquals(context, {
      apiToken: "env-token",
      projectSlug: "env-project",
      serviceLayer: "local",
    });
  });

  it("uses stored login auth without claiming an unlinked project", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");

    const context = await applyRuntimeAuthContext({});

    assertEquals(context, {
      apiToken: "stored-token",
      serviceLayer: "cloud",
    });
    assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), undefined);
    assertEquals(getEnv("VERYFRONT_SERVICE_LAYER"), "cloud");
  });

  it("keeps the stored login token out of the environment project code reads", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");

    await applyRuntimeAuthContext({ linkedProjectSlug: "linked-project" });

    // `dev` and `start` import project route modules into this process, so a
    // process-wide token would be readable by project-authored code.
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
    assertEquals(env()["VERYFRONT_API_TOKEN"], undefined);
    // Framework code still resolves it through the host-scoped reader.
    assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
  });

  it("leaves an explicitly exported token in the environment", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    setEnv("VERYFRONT_API_TOKEN", "env-token");

    const context = await applyRuntimeAuthContext({});

    assertEquals(context.apiToken, "env-token");
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), "env-token");
    assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "env-token");
  });

  it("resolves the stored login token past a blank exported token", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    setEnv("VERYFRONT_API_TOKEN", "   ");

    const context = await applyRuntimeAuthContext({});

    // A blank export is normalized to "unset", so the stored token is the one
    // registered — and the blank value must not shadow it for consumers.
    assertEquals(context.apiToken, "stored-token");
    assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
  });

  it("keeps an explicitly linked project scoped to cloud requests", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");

    const context = await applyRuntimeAuthContext({
      linkedProjectSlug: "linked-project",
    });

    assertEquals(context, {
      apiToken: "stored-token",
      projectSlug: "linked-project",
      serviceLayer: "cloud",
    });
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), "linked-project");
  });

  it("reads the persisted project link without inferring from the directory name", async () => {
    const linkedDir = await Deno.makeTempDir({ prefix: "vf-linked-project-" });
    const unlinkedDir = await Deno.makeTempDir({ prefix: "vf-unlinked-project-" });
    tempDirs.push(linkedDir, unlinkedDir);
    await writeRawProjectLink(linkedDir, "persisted-project");
    await Deno.writeTextFile(
      join(unlinkedDir, "package.json"),
      JSON.stringify({ name: "unlinked" }),
    );

    assertEquals(await resolveLinkedProjectSlug(linkedDir), "persisted-project");
    assertEquals(await resolveLinkedProjectSlug(unlinkedDir), undefined);
  });

  it("does not inject project or service-layer auth without a token", async () => {
    await useTempConfigHome();

    const context = await applyRuntimeAuthContext({});

    assertEquals(context, {});
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
    assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), undefined);
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), undefined);
    assertEquals(getEnv("VERYFRONT_SERVICE_LAYER"), undefined);
  });
});
