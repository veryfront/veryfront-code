import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for shared config
 * @module cli/shared/config.test
 */

import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createApiClient,
  isRetryableApiReadError,
  isUntrustedApiUrlCredentialError,
  readConfigFile,
  resolveApiCredentialCandidatesForAuth,
  resolveConfig,
  resolveConfigWithAuth,
  resolveConfigWithAuthDetails,
} from "./config.ts";
import type { ResolvedConfig } from "./config.ts";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";
import { withTempDir } from "#veryfront/testing/deno-compat";
import { __resetEnvLoaderForTests, loadEnv } from "veryfront/utils/env-loader";
import { deleteToken, saveToken } from "../auth/token-store.ts";

describe("isRetryableApiReadError", () => {
  it("retries gateway and connection failures but not authoritative client statuses", () => {
    assertEquals(isRetryableApiReadError({ status: 503 }), true);
    assertEquals(
      isRetryableApiReadError(Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      })),
      true,
    );
    assertEquals(
      isRetryableApiReadError(Object.assign(new Error("unauthorized"), {
        cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
        status: 401,
      })),
      false,
    );
    assertEquals(isRetryableApiReadError(new DOMException("cancelled", "AbortError")), false);
  });
});

function createMockEnv(overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig {
  return {
    apiUrl: overrides.apiUrl,
    apiToken: overrides.apiToken,
    projectSlug: overrides.projectSlug,
    isDev: false,
    isProduction: true,
    ...overrides,
  } as EnvironmentConfig;
}

/** Put a process variable back the way the test found it. */
function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) Deno.env.delete(key);
  else Deno.env.set(key, original);
}

function projectIdOf(config: ResolvedConfig): string | undefined {
  return (config as ResolvedConfig & { projectId?: string }).projectId;
}

async function writeRawProjectLink(
  projectDir: string,
  link: {
    controlPlane?: string;
    projectId?: string;
    projectSlug?: string;
  } = {},
): Promise<void> {
  await Deno.mkdir(join(projectDir, ".veryfront"), { recursive: true });
  await Deno.writeTextFile(
    join(projectDir, ".veryfront", "project.json"),
    JSON.stringify({
      version: 1,
      controlPlane: "https://api.veryfront.com",
      projectId: "linked-project-id",
      projectSlug: "linked-project",
      ...link,
    }),
  );
}

describe("resolveConfig", () => {
  it("should throw when no token is available", async () => {
    const env = createMockEnv({ projectSlug: "test-project" });

    await assertRejects(
      () => resolveConfig("/tmp/test-dir", env),
      Error,
      "Missing API token",
    );
  });

  it("should use token from environment", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiToken, "env-token");
    assertEquals(config.projectSlug, "test-project");
  });

  it("should use default API URL", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://api.veryfront.com");
  });

  it("should use custom API URL from environment", async () => {
    const env = createMockEnv({
      apiUrl: "https://custom.api.com",
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfig("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://custom.api.com");
  });

  it("prefers explicit apiBaseUrl over veryfront.json apiUrl", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://api.from-file.test",
        }),
      );

      const env = createMockEnv({
        apiBaseUrl: "https://api.from-env.test",
        apiToken: "env-token",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiUrl, "https://api.from-env.test");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("uses veryfront.json apiUrl before the default apiBaseUrl", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://api.from-file.test",
          apiToken: "config-token",
        }),
      );

      const env = createMockEnv({
        apiBaseUrl: "https://api.veryfront.com",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiUrl, "https://api.from-file.test");
      assertEquals(config.apiToken, "config-token");
      assertEquals(config.apiTokenSource, "config-file");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("refuses to pair an environment token with a veryfront.json apiUrl", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://attacker.example",
        }),
      );

      const env = createMockEnv({ apiToken: "env-token" });

      await assertRejects(
        () => resolveConfig(tempDir, env),
        Error,
        "veryfront.json selects a repository-configured API endpoint",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("refuses to pair a stored login token with a veryfront.json apiUrl", async () => {
    const tempDir = await makeTempDir();
    const configHome = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://attacker.example",
        }),
      );

      const env = createMockEnv({ xdgConfigHome: configHome });
      await saveToken("stored-user-token", env);

      await assertRejects(
        () => resolveConfig(tempDir, env),
        Error,
        "veryfront.json selects a repository-configured API endpoint",
      );
    } finally {
      await deleteToken(createMockEnv({ xdgConfigHome: configHome }));
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("allows an environment token when VERYFRONT_API_URL confirms the veryfront.json apiUrl", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://api.self-hosted.test",
        }),
      );

      const env = createMockEnv({
        apiUrl: "https://api.self-hosted.test",
        apiToken: "env-token",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiUrl, "https://api.self-hosted.test");
      assertEquals(config.apiToken, "env-token");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("accepts an equivalent spelling of the default endpoint as the same host", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://API.VERYFRONT.COM:443",
        }),
      );

      const env = createMockEnv({
        apiBaseUrl: "https://api.veryfront.com",
        apiToken: "env-token",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiToken, "env-token");
      assertEquals(config.apiTokenSource, "env");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("redacts userinfo from the refusal instead of echoing the credential", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://operator:hunter2@attacker.example",
        }),
      );

      const env = createMockEnv({ apiToken: "env-token" });

      const error = await assertRejects(() => resolveConfig(tempDir, env), Error);
      assertInstanceOf(error, Error);

      assertEquals(error.message.includes("hunter2"), false);
      assertEquals(error.message.includes("attacker.example"), false);
      assertEquals(error.message.includes("repository-configured API endpoint"), true);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("refuses to pair a shell token with a VERYFRONT_API_URL read from a project .env", async () => {
    const tempDir = await makeTempDir();
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_URL");
      await Deno.writeTextFile(
        join(tempDir, ".env"),
        "VERYFRONT_API_URL=https://attacker.example\n",
      );
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiUrl: "https://attacker.example",
        apiToken: "shell-token",
      });

      await assertRejects(
        () => resolveConfig(tempDir, env),
        Error,
        "The project .env file sets VERYFRONT_API_URL to a repository-configured API endpoint",
      );
    } finally {
      __resetEnvLoaderForTests();
      await Deno.remove(tempDir, { recursive: true });

      if (originalApiUrl === undefined) {
        Deno.env.delete("VERYFRONT_API_URL");
      } else {
        Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      }
    }
  });

  it("allows a token that the same project .env supplied alongside the API URL", async () => {
    const tempDir = await makeTempDir();
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_URL");
      Deno.env.delete("VERYFRONT_API_TOKEN");
      await Deno.writeTextFile(
        join(tempDir, ".env"),
        "VERYFRONT_API_URL=https://api.self-hosted.test\nVERYFRONT_API_TOKEN=env-file-token\n",
      );
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiUrl: "https://api.self-hosted.test",
        apiToken: "env-file-token",
        projectSlug: "test-project",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiUrl, "https://api.self-hosted.test");
      assertEquals(config.apiToken, "env-file-token");
    } finally {
      __resetEnvLoaderForTests();
      await Deno.remove(tempDir, { recursive: true });

      if (originalApiUrl === undefined) {
        Deno.env.delete("VERYFRONT_API_URL");
      } else {
        Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      }
      if (originalApiToken === undefined) {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } else {
        Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      }
    }
  });

  it("accepts a project .env that names the default endpoint in another spelling", async () => {
    const tempDir = await makeTempDir();
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_URL");
      await Deno.writeTextFile(
        join(tempDir, ".env"),
        "VERYFRONT_API_URL=https://API.VERYFRONT.COM:443\n",
      );
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiUrl: "https://API.VERYFRONT.COM:443",
        apiToken: "shell-token",
        projectSlug: "test-project",
      });

      // The env file redirects nothing, so the shell token still travels.
      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiToken, "shell-token");
      assertEquals(config.apiTokenSource, "env");
    } finally {
      __resetEnvLoaderForTests();
      await Deno.remove(tempDir, { recursive: true });

      if (originalApiUrl === undefined) {
        Deno.env.delete("VERYFRONT_API_URL");
      } else {
        Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      }
    }
  });

  it("keeps a shell token expanded into the .env URL out of the refusal", async () => {
    const tempDir = await makeTempDir();
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const shellToken = "vf_shell_token_do_not_echo";

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_URL");
      // The shell holds the credential; the repository's .env interpolates it
      // into a URL path, where userinfo stripping alone would never find it.
      Deno.env.set("VERYFRONT_API_TOKEN", shellToken);
      await Deno.writeTextFile(
        join(tempDir, ".env"),
        "VERYFRONT_API_URL=https://$VERYFRONT_API_TOKEN.attacker.example\n",
      );
      await loadEnv({ cwd: tempDir });

      const steeredUrl = Deno.env.get("VERYFRONT_API_URL");
      assertEquals(steeredUrl?.includes(shellToken), true);

      const env = createMockEnv({ apiUrl: steeredUrl, apiToken: shellToken });

      const error = await assertRejects(() => resolveConfig(tempDir, env), Error);
      assertInstanceOf(error, Error);

      assertEquals(error.message.includes(shellToken), false);
      assertEquals(error.message.includes("attacker.example"), false);
      assertEquals(error.message.includes("repository-configured API endpoint"), true);
    } finally {
      __resetEnvLoaderForTests();
      await Deno.remove(tempDir, { recursive: true });

      if (originalApiUrl === undefined) {
        Deno.env.delete("VERYFRONT_API_URL");
      } else {
        Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
      }
      if (originalApiToken === undefined) {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } else {
        Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      }
    }
  });

  it("refuses an env-file token whose value was expanded from a shell secret", async () => {
    const tempDir = await makeTempDir();
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalCiSecret = Deno.env.get("GITHUB_TOKEN");
    const ciSecret = "ghs_shell_secret_do_not_forward";

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_URL");
      Deno.env.delete("VERYFRONT_API_TOKEN");
      // The repository names the host and names which of the operator's
      // secrets to spend on it. `loadEnv` expands the reference, so the token
      // reads as env-file supplied while its value is the shell's.
      Deno.env.set("GITHUB_TOKEN", ciSecret);
      await Deno.writeTextFile(
        join(tempDir, ".env"),
        "VERYFRONT_API_URL=https://attacker.example\nVERYFRONT_API_TOKEN=$GITHUB_TOKEN\n",
      );
      await loadEnv({ cwd: tempDir });

      assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), ciSecret);

      const env = createMockEnv({
        apiUrl: "https://attacker.example",
        apiToken: ciSecret,
        projectSlug: "test-project",
      });

      const error = await assertRejects(() => resolveConfig(tempDir, env), Error);
      assertInstanceOf(error, Error);

      assertEquals(isUntrustedApiUrlCredentialError(error), true);
      assertEquals(error.message.includes(ciSecret), false);
      assertEquals(error.message.includes("attacker.example"), false);
      assertEquals(error.message.includes("repository-configured API endpoint"), true);
    } finally {
      __resetEnvLoaderForTests();
      await Deno.remove(tempDir, { recursive: true });

      restoreEnv("VERYFRONT_API_URL", originalApiUrl);
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("GITHUB_TOKEN", originalCiSecret);
    }
  });

  it("still accepts an env-file token written literally beside the API URL", async () => {
    const tempDir = await makeTempDir();
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalOther = Deno.env.get("SELF_HOSTED_TOKEN_PART");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_URL");
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("SELF_HOSTED_TOKEN_PART");
      // Expansion against an entry in the same file keeps the value repository
      // content, so the self-hosted layout must keep working.
      await Deno.writeTextFile(
        join(tempDir, ".env"),
        "SELF_HOSTED_TOKEN_PART=file-part\n" +
          "VERYFRONT_API_URL=https://api.self-hosted.test\n" +
          "VERYFRONT_API_TOKEN=vf-$SELF_HOSTED_TOKEN_PART\n",
      );
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiUrl: "https://api.self-hosted.test",
        apiToken: "vf-file-part",
        projectSlug: "test-project",
      });

      const config = await resolveConfig(tempDir, env);

      assertEquals(config.apiUrl, "https://api.self-hosted.test");
      assertEquals(config.apiToken, "vf-file-part");
    } finally {
      __resetEnvLoaderForTests();
      await Deno.remove(tempDir, { recursive: true });

      restoreEnv("VERYFRONT_API_URL", originalApiUrl);
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("SELF_HOSTED_TOKEN_PART", originalOther);
    }
  });

  it("names the confirmation variable without echoing the configured endpoint", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ apiUrl: "https://control.example/api" }),
      );

      const env = createMockEnv({ apiToken: "shell-token", projectSlug: "test-project" });

      const error = await assertRejects(() => resolveConfig(tempDir, env), Error);
      assertInstanceOf(error, Error);

      // Repository-controlled endpoint text is omitted entirely. The message
      // still names the shell variable the developer can set independently.
      assertEquals(error.message.includes("VERYFRONT_API_URL=https://control.example"), false);
      assertEquals(error.message.includes("VERYFRONT_API_URL"), true);
      assertEquals(error.message.includes("repository-configured API endpoint"), true);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("marks the refusal so callers cannot rebuild the configuration around it", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projects: ["one", "two"],
          apiUrl: "https://attacker.example",
        }),
      );

      const env = createMockEnv({ apiToken: "env-token" });

      const error = await assertRejects(() => resolveConfig(tempDir, env), Error);

      assertEquals(isUntrustedApiUrlCredentialError(error), true);
      assertEquals(isUntrustedApiUrlCredentialError(new Error("unrelated")), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("resolveApiCredentialCandidatesForAuth", () => {
  it("keeps ambient credentials on the default host when veryfront.json steers", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://attacker.example",
        }),
      );

      const env = createMockEnv({ apiToken: "shell-token" });

      const candidates = await resolveApiCredentialCandidatesForAuth(env, tempDir, false);

      assertEquals(candidates.length, 1);
      assertEquals(candidates[0]?.apiToken, "shell-token");
      assertEquals(candidates[0]?.validationEnv.apiUrl, "https://api.veryfront.com");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("still offers a token that the same veryfront.json supplied", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projectSlug: "from-json",
          apiUrl: "https://attacker.example",
          apiToken: "config-file-token",
        }),
      );

      const env = createMockEnv({ apiToken: "shell-token" });

      const candidates = await resolveApiCredentialCandidatesForAuth(env, tempDir, false);

      assertEquals(candidates.map((candidate) => candidate.apiToken), [
        "shell-token",
        "config-file-token",
      ]);
      assertEquals(candidates[0]?.validationEnv.apiUrl, "https://api.veryfront.com");
      assertEquals(candidates[1]?.validationEnv.apiUrl, "https://attacker.example");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("leaves the shell token in place when the repository steers nothing", async () => {
    const tempDir = await makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "from-json" }),
      );

      const env = createMockEnv({ apiToken: "shell-token" });

      const candidates = await resolveApiCredentialCandidatesForAuth(env, tempDir, false);

      assertEquals(candidates[0]?.apiToken, "shell-token");
      assertEquals(candidates[0]?.apiTokenSource, "env");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("resolveConfigWithAuth", () => {
  it("should use token from environment without prompting", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfigWithAuth("/tmp/test-dir", env);

    assertEquals(config.apiToken, "env-token");
    assertEquals(config.projectSlug, "test-project");
  });

  it("should throw when auth fails in non-TTY", async () => {
    // In non-TTY mode without a token, ensureAuthenticated returns null
    const env = createMockEnv({ projectSlug: "test-project" });

    await assertRejects(
      () => resolveConfigWithAuth("/tmp/test-dir", env),
      Error,
      "Authentication required",
    );
  });

  it("should use default API URL", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: "test-project",
    });

    const config = await resolveConfigWithAuth("/tmp/test-dir", env);

    assertEquals(config.apiUrl, "https://api.veryfront.com");
  });

  it("prefers the token store over a project .env API token for management commands", async () => {
    const tempDir = await Deno.makeTempDir();
    const configHome = await Deno.makeTempDir();
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_TOKEN");
      await Deno.writeTextFile(join(tempDir, ".env"), "VERYFRONT_API_TOKEN=runtime-token\n");
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiToken: "runtime-token",
        projectSlug: "test-project",
        xdgConfigHome: configHome,
      });
      await saveToken("stored-user-token", env);

      const config = await resolveConfigWithAuth(tempDir, env);

      assertEquals(config.apiToken, "stored-user-token");
    } finally {
      await deleteToken(createMockEnv({ xdgConfigHome: configHome }));
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
      __resetEnvLoaderForTests();

      if (originalApiToken === undefined) {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } else {
        Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      }
    }
  });

  it("prefers veryfront.json token over project .env and token store for management commands", async () => {
    const tempDir = await Deno.makeTempDir();
    const configHome = await Deno.makeTempDir();
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      __resetEnvLoaderForTests();
      Deno.env.delete("VERYFRONT_API_TOKEN");
      await Deno.writeTextFile(join(tempDir, ".env"), "VERYFRONT_API_TOKEN=runtime-token\n");
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ apiToken: "config-token", projectSlug: "test-project" }),
      );
      await loadEnv({ cwd: tempDir });

      const env = createMockEnv({
        apiToken: "runtime-token",
        projectSlug: "test-project",
        xdgConfigHome: configHome,
      });
      await saveToken("stored-user-token", env);

      const config = await resolveConfigWithAuth(tempDir, env);

      assertEquals(config.apiToken, "config-token");
      assertEquals(config.apiTokenSource, "config-file");
    } finally {
      await deleteToken(createMockEnv({ xdgConfigHome: configHome }));
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
      __resetEnvLoaderForTests();

      if (originalApiToken === undefined) {
        Deno.env.delete("VERYFRONT_API_TOKEN");
      } else {
        Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
      }
    }
  });

  it("uses tenant project context when explicit project slug is absent", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");

    try {
      Deno.env.set("TENANT_PROJECT_SLUG", "tenant-project");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth("/tmp/test-dir", env);

      assertEquals(config.projectSlug, "tenant-project");
    } finally {
      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });

  it("prefers repo config projectSlug over tenant fallback", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");
    const tempDir = await Deno.makeTempDir();

    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "repo-config-project" }),
      );
      Deno.env.set("TENANT_PROJECT_SLUG", "tenant-project");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth(tempDir, env);

      assertEquals(config.projectSlug, "repo-config-project");
    } finally {
      await Deno.remove(tempDir, { recursive: true });

      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });

  it("prefers module config projectSlug over a local project link", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.config.js"),
        'export default { projectSlug: "from-module" };\n',
      );
      await writeRawProjectLink(tempDir, {
        controlPlane: "https://api.other.veryfront.com",
        projectSlug: "from-link",
      });

      const details = await resolveConfigWithAuthDetails(
        tempDir,
        createMockEnv({ apiToken: "env-token", projectSlug: undefined }),
      );

      assertEquals(details.config.projectSlug, "from-module");
      assertEquals(projectIdOf(details.config), undefined);
      assertEquals(details.projectReferenceSource, {
        kind: "module-config",
        name: "veryfront.config.js",
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("prefers veryfront.json projectSlug over a local project link", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "from-json" }),
      );
      await writeRawProjectLink(tempDir, {
        controlPlane: "https://api.other.veryfront.com",
        projectSlug: "from-link",
      });

      const details = await resolveConfigWithAuthDetails(
        tempDir,
        createMockEnv({ apiToken: "env-token", projectSlug: undefined }),
      );

      assertEquals(details.config.projectSlug, "from-json");
      assertEquals(projectIdOf(details.config), undefined);
      assertEquals(details.projectReferenceSource, {
        kind: "json-config",
        name: "veryfront.json",
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("prefers tenant project context over a local project link", async () => {
    const tempDir = await Deno.makeTempDir();
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    try {
      await writeRawProjectLink(tempDir, {
        controlPlane: "https://api.other.veryfront.com",
        projectSlug: "from-link",
      });
      Deno.env.set("TENANT_PROJECT_SLUG", "from-tenant");

      const details = await resolveConfigWithAuthDetails(
        tempDir,
        createMockEnv({ apiToken: "env-token", projectSlug: undefined }),
      );

      assertEquals(details.config.projectSlug, "from-tenant");
      assertEquals(projectIdOf(details.config), undefined);
      assertEquals(details.projectReferenceSource, {
        kind: "tenant-environment",
        name: "TENANT_PROJECT_SLUG",
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }
    }
  });

  it("uses a matching local project link before inferred project names", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(tempDir, "package.json"), JSON.stringify({ name: "inferred" }));
      await writeRawProjectLink(tempDir, {
        controlPlane: "https://api.veryfront.com/",
        projectId: "project-123",
        projectSlug: "from-link",
      });

      const details = await resolveConfigWithAuthDetails(
        tempDir,
        createMockEnv({ apiToken: "env-token", projectSlug: undefined }),
      );

      assertEquals(details.config.projectSlug, "from-link");
      assertEquals(projectIdOf(details.config), "project-123");
      assertEquals(details.projectReferenceSource, {
        kind: "local-link",
        name: ".veryfront/project.json",
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects a local project link for a different control plane", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(tempDir, "package.json"), JSON.stringify({ name: "inferred" }));
      await writeRawProjectLink(tempDir, {
        controlPlane: "https://api.other.veryfront.com",
        projectSlug: "from-link",
      });

      await assertRejects(
        () =>
          resolveConfigWithAuthDetails(
            tempDir,
            createMockEnv({ apiToken: "env-token", projectSlug: undefined }),
          ),
        Error,
        ".veryfront/project.json",
      );
      await assertRejects(
        () =>
          resolveConfigWithAuthDetails(
            tempDir,
            createMockEnv({ apiToken: "env-token", projectSlug: undefined }),
          ),
        Error,
        "https://api.other.veryfront.com",
      );
      await assertRejects(
        () =>
          resolveConfigWithAuthDetails(
            tempDir,
            createMockEnv({ apiToken: "env-token", projectSlug: undefined }),
          ),
        Error,
        "https://api.veryfront.com",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("uses tenant project id when no project slug is available", async () => {
    const env = createMockEnv({
      apiToken: "env-token",
      projectSlug: undefined,
    });
    const previousTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const previousTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");

    try {
      Deno.env.delete("TENANT_PROJECT_SLUG");
      Deno.env.set("TENANT_PROJECT_ID", "tenant-project-id");

      const config = await resolveConfigWithAuth("/tmp/test-dir", env);

      assertEquals(config.projectSlug, "tenant-project-id");
      assertEquals(config.projectId, "tenant-project-id");
    } finally {
      if (previousTenantProjectSlug === undefined) {
        Deno.env.delete("TENANT_PROJECT_SLUG");
      } else {
        Deno.env.set("TENANT_PROJECT_SLUG", previousTenantProjectSlug);
      }

      if (previousTenantProjectId === undefined) {
        Deno.env.delete("TENANT_PROJECT_ID");
      } else {
        Deno.env.set("TENANT_PROJECT_ID", previousTenantProjectId);
      }
    }
  });
});

describe("createApiClient", () => {
  it("uses problem JSON detail and suggestion in API errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            title: "Validation failed",
            status: 400,
            detail: "Project slug is reserved.",
            suggestion: "Choose another project name.",
            slug: "validation-failed",
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        ),
      )) as typeof fetch;

    try {
      const client = createApiClient(
        {
          apiUrl: "https://api.test.veryfront.com",
          apiToken: "token",
          projectSlug: "admin",
        } satisfies ResolvedConfig,
      );

      await assertRejects(
        () => client.get("/projects/admin"),
        Error,
        "Project slug is reserved. Choose another project name.",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// createApiClient tests
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    apiUrl: "https://api.veryfront.com",
    apiToken: "test-token",
    projectSlug: "test-project",
    ...overrides,
  };
}

describe("createApiClient", () => {
  describe("x-veryfront-client-version header", () => {
    it("sends x-veryfront-client-version on GET requests", async () => {
      let capturedHeaders: Headers | undefined;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await client.get("/test");
        const version = capturedHeaders?.get("x-veryfront-client-version");
        assertEquals(typeof version, "string");
        assertEquals(version!.length > 0, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("sends x-veryfront-client-version on POST requests", async () => {
      let capturedHeaders: Headers | undefined;

      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers as HeadersInit);
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await client.post("/test", { foo: "bar" });
        const version = capturedHeaders?.get("x-veryfront-client-version");
        assertEquals(typeof version, "string");
        assertEquals(version!.length > 0, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("explains project .env token shadowing on auth-like management API failures", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
      return Promise.resolve(
        new Response(JSON.stringify({ message: "API request failed: 403 Forbidden" }), {
          status: 403,
          statusText: "Forbidden",
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      const client = createApiClient(makeConfig({
        apiToken: "runtime-token",
        apiTokenSource: "env-file",
      }));

      await assertRejects(
        () => client.get("/projects/test/files"),
        Error,
        "VERYFRONT_API_TOKEN was loaded from a project .env file",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe("retry on transient failures for idempotent requests", () => {
    it("retries GET on 502 and succeeds on second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("bad gateway", { status: 502 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.get<{ data: string }>("/test");
        assertEquals(result.data, "ok");
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries GET on 503 and succeeds on second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("service unavailable", { status: 503 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.get<{ data: string }>("/test");
        assertEquals(result.data, "ok");
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries GET on connection error and succeeds on second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("connection reset by peer"));
        }
        return Promise.resolve(new Response(JSON.stringify({ data: "ok" }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.get<{ data: string }>("/test");
        assertEquals(result.data, "ok");
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("exhausts retries and throws after 3 consecutive 502 responses", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        return Promise.resolve(new Response("bad gateway", { status: 502 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.get("/test"),
          Error,
          "502",
        );
        assertEquals(callCount, 3);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries PUT after a nested ECONNRESET and preserves the request body", async () => {
      let callCount = 0;
      const requestBodies: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
        callCount++;
        requestBodies.push(String(init?.body));
        if (callCount === 1) {
          const cause = Object.assign(new Error("read failed"), { code: "ECONNRESET" });
          return Promise.reject(new TypeError("fetch failed", { cause }));
        }
        return Promise.resolve(new Response(JSON.stringify({ updated: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.put<{ updated: boolean }>("/test", { content: "same" });
        assertEquals(result.updated, true);
        assertEquals(callCount, 2);
        assertEquals(requestBodies, [
          JSON.stringify({ content: "same" }),
          JSON.stringify({ content: "same" }),
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries PUT on 502 and succeeds on the second attempt", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("bad gateway", { status: 502 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ updated: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.put<{ updated: boolean }>("/test", { content: "same" });
        assertEquals(result.updated, true);
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not retry PUT when the caller disables retries", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response("bad gateway", { status: 502 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ updated: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.put("/test", { content: "same" }, { retryPolicy: "none" }),
          Error,
          "502",
        );
        assertEquals(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("retry behavior for non-idempotent requests", () => {
    it("does NOT retry POST on 502", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        return Promise.resolve(new Response("bad gateway", { status: 502 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.post("/test", {}),
          Error,
          "502",
        );
        assertEquals(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries POST on connection-refused error (request never reached server)", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("connection refused (os error 111)"));
        }
        return Promise.resolve(new Response(JSON.stringify({ created: true }), { status: 200 }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        const result = await client.post<{ created: boolean }>("/test", {});
        assertEquals(result.created, true);
        assertEquals(callCount, 2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does NOT retry POST on connection-reset (request may have reached server)", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        return Promise.reject(new Error("connection reset by peer"));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.post("/test", {}),
          Error,
          "connection reset",
        );
        assertEquals(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does NOT retry POST when fetch wraps ECONNRESET in a cause", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
        callCount++;
        const cause = Object.assign(new Error("read failed"), { code: "ECONNRESET" });
        return Promise.reject(new TypeError("fetch failed", { cause }));
      }) as typeof fetch;

      try {
        const client = createApiClient(makeConfig());
        await assertRejects(
          () => client.post("/test", {}),
          TypeError,
          "fetch failed",
        );
        assertEquals(callCount, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

describe("readConfigFile", () => {
  it("merges veryfront.json apiUrl with the module config projectSlug", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.config.js"),
        'export default { projectSlug: "from-module" };\n',
      );
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "from-json", apiUrl: "https://api.veryfront.org" }),
      );

      const config = await readConfigFile(tempDir);

      assertEquals(config?.projectSlug, "from-module");
      assertEquals(config?.apiUrl, "https://api.veryfront.org");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("reads veryfront.json alone when no module config exists", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({ projectSlug: "json-only", apiUrl: "https://api.veryfront.org" }),
      );

      const config = await readConfigFile(tempDir);

      assertEquals(config?.projectSlug, "json-only");
      assertEquals(config?.apiUrl, "https://api.veryfront.org");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

describe("resolveApiCredentialCandidatesForAuth", () => {
  it("keeps a project veryfront.json apiUrl away from non-config credentials", async () => {
    await withTempDir(async (tempDir) => {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          apiUrl: "https://attacker.example",
          apiToken: "config-token",
        }),
      );
      const env = createMockEnv({ apiToken: "shell-token" });

      const candidates = await resolveApiCredentialCandidatesForAuth(env, tempDir, false);

      const envCandidate = candidates.find((candidate) => candidate.apiTokenSource === "env");
      assertEquals(envCandidate?.apiToken, "shell-token");
      for (const candidate of candidates) {
        if (candidate.apiTokenSource === "config-file") continue;
        assertEquals(candidate.validationEnv.apiUrl, "https://api.veryfront.com");
      }
    });
  });

  it("still validates the config-file token against its own apiUrl", async () => {
    await withTempDir(async (tempDir) => {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          apiUrl: "https://api.veryfront.org",
          apiToken: "config-token",
        }),
      );
      const env = createMockEnv({});

      const candidates = await resolveApiCredentialCandidatesForAuth(env, tempDir, false);

      const configCandidate = candidates.find(
        (candidate) => candidate.apiTokenSource === "config-file",
      );
      assertEquals(configCandidate?.apiToken, "config-token");
      assertEquals(configCandidate?.validationEnv.apiUrl, "https://api.veryfront.org");
    });
  });
});
