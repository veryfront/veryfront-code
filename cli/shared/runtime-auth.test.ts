import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { join } from "veryfront/platform/path";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { saveToken } from "../auth/token-store.ts";
import {
  _resetEnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { __resetEnvLoaderForTests, getEnvSource, loadEnv } from "veryfront/utils/env-loader";
import {
  applyQualifiedRuntimeAuth,
  applyRuntimeAuthContext,
  resolveLinkedProjectSlug,
  resolveRuntimeAuthContext,
} from "./runtime-auth.ts";

const ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
  "VERYFRONT_API_BASE_URL",
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
  const dir = await makeTempDir({ prefix: "vf-runtime-auth-" });
  tempDirs.push(dir);
  setEnv("XDG_CONFIG_HOME", dir);
  return dir;
}

describe("cli/shared/runtime-auth", () => {
  afterEach(async () => {
    _resetEnvironmentConfig();
    __resetEnvLoaderForTests();
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
      apiToken: "env-token",
      linkedProjectSlug: "config-project",
    });

    assertEquals(context, {
      apiToken: "env-token",
      projectSlug: "env-project",
      serviceLayer: "local",
    });
  });

  it("does not let the low-level context resolver consult the token store", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");

    assertEquals(await resolveRuntimeAuthContext({ apiToken: null }), {});
  });

  it("applies a qualified token and endpoint atomically", async () => {
    setEnv("VERYFRONT_API_TOKEN", "unqualified-token");

    await applyRuntimeAuthContext({
      apiToken: "qualified-token",
      apiBaseUrl: "https://runtime.example",
    });

    assertEquals(getEnv("VERYFRONT_API_TOKEN"), "qualified-token");
    assertEquals(getEnv("VERYFRONT_API_BASE_URL"), "https://runtime.example");
  });

  it("uses stored login auth without claiming an unlinked project", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-project-" });
    tempDirs.push(projectDir);

    const context = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(context, {
      apiToken: "stored-token",
      serviceLayer: "cloud",
    });
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), "stored-token");
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), undefined);
    assertEquals(getEnv("VERYFRONT_SERVICE_LAYER"), "cloud");
  });

  it("keeps an explicitly linked project scoped to cloud requests", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-linked-" });
    tempDirs.push(projectDir);

    const context = await applyQualifiedRuntimeAuth(projectDir, "linked-project");

    assertEquals(context, {
      apiToken: "stored-token",
      projectSlug: "linked-project",
      serviceLayer: "cloud",
    });
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), "linked-project");
  });

  it("applies a project credential together with its configured API base", async () => {
    await useTempConfigHome();
    setEnv("VERYFRONT_API_TOKEN", "shell-token");
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-config-" });
    tempDirs.push(projectDir);
    await Deno.writeTextFile(
      join(projectDir, "veryfront.json"),
      JSON.stringify({
        apiUrl: "https://runtime.example/graphql",
        apiToken: "project-token",
      }),
    );

    const context = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(context, {
      apiToken: "project-token",
      apiBaseUrl: "https://runtime.example/api",
      serviceLayer: "cloud",
    });
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), "project-token");
    assertEquals(getEnv("VERYFRONT_API_BASE_URL"), "https://runtime.example/api");
    assertEquals(getEnvSource("VERYFRONT_API_BASE_URL").source, "config-file");
    assertEquals(getEnvironmentConfig().apiToken, "project-token");
    assertEquals(getEnvironmentConfig().apiBaseUrl, "https://runtime.example/api");
  });

  it("preserves stored credential provenance when config only supplies an API URL", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-config-url-" });
    tempDirs.push(projectDir);
    await Deno.writeTextFile(
      join(projectDir, "veryfront.json"),
      JSON.stringify({ apiUrl: "https://runtime.example/graphql" }),
    );

    const first = await applyQualifiedRuntimeAuth(projectDir);
    _resetEnvironmentConfig();
    const second = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(first.apiToken, "stored-token");
    assertEquals(first.apiBaseUrl, undefined);
    assertEquals(second.apiToken, "stored-token");
    assertEquals(second.apiBaseUrl, undefined);
    assertEquals(getEnvSource("VERYFRONT_API_TOKEN").source, "process");
    assertEquals(getEnvSource("VERYFRONT_API_BASE_URL").source, "unset");
  });

  it("resets a config-derived API base when its matching token is removed", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-config-removed-token-" });
    tempDirs.push(projectDir);
    const configPath = join(projectDir, "veryfront.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({
        apiUrl: "https://runtime.example/graphql",
        apiToken: "project-token",
      }),
    );

    const first = await applyQualifiedRuntimeAuth(projectDir);
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({ apiUrl: "https://runtime.example/graphql" }),
    );
    _resetEnvironmentConfig();
    const second = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(first.apiToken, "project-token");
    assertEquals(first.apiBaseUrl, "https://runtime.example/api");
    assertEquals(second.apiToken, "stored-token");
    assertEquals(second.apiBaseUrl, undefined);
    assertEquals(getEnvSource("VERYFRONT_API_TOKEN").source, "process");
    assertEquals(getEnvSource("VERYFRONT_API_BASE_URL").source, "unset");
  });

  it("preserves the REST path when config-derived auth is applied twice", async () => {
    await useTempConfigHome();
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-config-repeat-" });
    tempDirs.push(projectDir);
    await Deno.writeTextFile(
      join(projectDir, "veryfront.json"),
      JSON.stringify({ apiUrl: "https://runtime.example/graphql", apiToken: "project-token" }),
    );

    const first = await applyQualifiedRuntimeAuth(projectDir);
    const second = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(first.apiBaseUrl, "https://runtime.example/api");
    assertEquals(second.apiBaseUrl, "https://runtime.example/api");
    assertEquals(getEnv("VERYFRONT_API_BASE_URL"), "https://runtime.example/api");
  });

  it("drops config base provenance when its URL is removed but its token remains", async () => {
    await useTempConfigHome();
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-config-removed-url-" });
    tempDirs.push(projectDir);
    const configPath = join(projectDir, "veryfront.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({ apiUrl: "https://runtime.example/graphql", apiToken: "project-token" }),
    );
    await applyQualifiedRuntimeAuth(projectDir);
    await Deno.writeTextFile(configPath, JSON.stringify({ apiToken: "project-token" }));
    _resetEnvironmentConfig();

    const context = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(context.apiToken, "project-token");
    assertEquals(context.apiBaseUrl, undefined);
    assertEquals(getEnvSource("VERYFRONT_API_TOKEN").source, "config-file");
    assertEquals(getEnvSource("VERYFRONT_API_BASE_URL").source, "unset");
  });

  it("clears config-derived auth when its token becomes blank", async () => {
    await useTempConfigHome();
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-config-cleared-" });
    tempDirs.push(projectDir);
    const configPath = join(projectDir, "veryfront.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({ apiUrl: "https://runtime.example/graphql", apiToken: "project-token" }),
    );
    await applyQualifiedRuntimeAuth(projectDir);
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({ apiUrl: "https://runtime.example/graphql", apiToken: "   " }),
    );
    _resetEnvironmentConfig();

    const context = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(context, { serviceLayer: "cloud" });
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
    assertEquals(getEnv("VERYFRONT_API_BASE_URL"), undefined);
    assertEquals(getEnvSource("VERYFRONT_API_TOKEN").source, "unset");
    assertEquals(getEnvSource("VERYFRONT_API_BASE_URL").source, "unset");
  });

  it("clears a removed config token when no API base was configured", async () => {
    await useTempConfigHome();
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-token-cleared-" });
    tempDirs.push(projectDir);
    const configPath = join(projectDir, "veryfront.json");
    await Deno.writeTextFile(configPath, JSON.stringify({ apiToken: "project-token" }));
    await applyQualifiedRuntimeAuth(projectDir);
    await Deno.writeTextFile(configPath, JSON.stringify({}));
    _resetEnvironmentConfig();

    const context = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(context, { serviceLayer: "cloud" });
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
    assertEquals(getEnvSource("VERYFRONT_API_TOKEN").source, "unset");
  });

  it("preserves repository provenance on a derived API base", async () => {
    await useTempConfigHome();
    await saveToken("stored-token");
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-env-pair-" });
    tempDirs.push(projectDir);
    await Deno.writeTextFile(
      join(projectDir, ".env"),
      "VERYFRONT_API_URL=https://runtime.example/graphql\n" +
        "VERYFRONT_API_TOKEN=project-token\n",
    );
    __resetEnvLoaderForTests();
    _resetEnvironmentConfig();
    await loadEnv({ cwd: projectDir, override: true });

    const context = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(context.apiToken, "project-token");
    assertEquals(context.apiBaseUrl, "https://runtime.example/api");
    assertEquals(getEnv("VERYFRONT_API_BASE_URL"), "https://runtime.example/api");
    assertEquals(getEnvSource("VERYFRONT_API_BASE_URL").source, "env-file");
    assertEquals(getEnv("VERYFRONT_API_URL"), "https://runtime.example/graphql");
  });

  it("reads the persisted project link without inferring from the directory name", async () => {
    const linkedDir = await makeTempDir({ prefix: "vf-linked-project-" });
    const unlinkedDir = await makeTempDir({ prefix: "vf-unlinked-project-" });
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
    const projectDir = await makeTempDir({ prefix: "vf-runtime-auth-empty-" });
    tempDirs.push(projectDir);

    const context = await applyQualifiedRuntimeAuth(projectDir);

    assertEquals(context, {});
    assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), undefined);
    assertEquals(getEnv("VERYFRONT_SERVICE_LAYER"), undefined);
  });
});
