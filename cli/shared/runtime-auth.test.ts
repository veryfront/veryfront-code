import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { saveToken } from "../auth/token-store.ts";
import {
  applyRuntimeAuthContext,
  inferRuntimeProjectSlug,
  resolveRuntimeAuthContext,
} from "./runtime-auth.ts";

const ENV_KEYS = ["VERYFRONT_API_TOKEN", "VERYFRONT_PROJECT_SLUG", "XDG_CONFIG_HOME"] as const;
let tempDirs: string[] = [];

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
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

  it("infers a project slug from the project directory", () => {
    assertEquals(inferRuntimeProjectSlug("/workspace/My Test"), "my-test");
  });

  it("prefers explicit environment auth over the token store", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    setEnv("VERYFRONT_API_TOKEN", "env-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "env-project");

    const context = await resolveRuntimeAuthContext({
      projectDir: "/workspace/my-test",
      projectSlug: "config-project",
    });

    assertEquals(context, {
      apiToken: "env-token",
      projectSlug: "env-project",
    });
  });

  it("uses the stored login token when runtime env auth is absent", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");

    const context = await applyRuntimeAuthContext({
      projectDir: "/workspace/My Test",
    });

    assertEquals(context, {
      apiToken: "stored-token",
      projectSlug: "my-test",
    });
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), "stored-token");
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), "my-test");
  });

  it("does not inject an inferred project slug without a token", async () => {
    await useTempConfigHome();

    const context = await applyRuntimeAuthContext({
      projectDir: "/workspace/my-test",
    });

    assertEquals(context, { projectSlug: "my-test" });
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), undefined);
  });
});
