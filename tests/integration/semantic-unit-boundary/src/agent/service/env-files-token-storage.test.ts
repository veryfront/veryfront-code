/**
 * The agent service's env loader and the token storage adapter.
 *
 * `startAgentService()` loads the project's `.env` with its own loader. A
 * credential from that file must reach token storage with the same
 * provenance whichever name holds it, `VERYFRONT_API_KEY` or
 * `VERYFRONT_API_TOKEN`, so a self-hosted key goes to the `.env`'s
 * `VERYFRONT_API_URL` and never to the hosted default API. Proving that needs
 * a real `.env` on disk, a global env-loader reset and a replaced ambient
 * `fetch`, all process-global effects, so it lives in the semantic
 * integration suite.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearEnvFileValueSource } from "#veryfront/platform/compat/process/env.ts";
import { deleteEnv, getEnv, setEnv, withTempDir } from "#veryfront/testing/deno-compat.ts";
import {
  __resetEnvLoaderForTests,
  __setEnvLoaderExistingEnvReaderForTests,
  __setEnvLoaderOsTypeForTests,
  getEnvSource,
} from "#veryfront/utils/env-loader.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { loadAgentServiceEnvFiles } from "#veryfront/agent/service/env-files.ts";
import {
  getTokenStorageAdapter,
  resetTokenStorageAdapter,
} from "#veryfront/platform/adapters/token/integration.ts";

const ENV_KEYS = [
  "VERYFRONT_API_KEY",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_TOKEN_FILE",
  "VERYFRONT_API_URL",
  "VERYFRONT_PROJECT_SLUG",
  "veryfront_api_key",
] as const;

const SELF_HOSTED_API = "https://self-hosted-api.example.test";

function clearEnvKeys(): void {
  for (const key of ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
    clearEnvFileValueSource(key);
  }
}

async function loadServiceEnvAndCaptureTokenRequests(
  envFile: string,
): Promise<Array<{ origin: string; authorization: string }>> {
  const requests: Array<{ origin: string; authorization: string }> = [];
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/.env`, envFile);
    await loadAgentServiceEnvFiles({ cwd: dir, files: [".env"] });

    await withMockFetch(
      ((input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          origin: new URL(String(input)).origin,
          authorization: new Headers(init?.headers).get("authorization") ?? "",
        });
        return Promise.resolve(Response.json({ keys: [] }));
      }) as typeof fetch,
      async () => {
        await getTokenStorageAdapter();
      },
    );
  });
  return requests;
}

describe("agent service env files and token storage", () => {
  afterEach(() => {
    resetTokenStorageAdapter();
    clearEnvKeys();
    __resetEnvLoaderForTests();
  });

  it("sends a VERYFRONT_API_KEY from the service .env to that file's API URL", async () => {
    clearEnvKeys();
    const requests = await loadServiceEnvAndCaptureTokenRequests([
      "VERYFRONT_API_KEY=self-hosted-key",
      `VERYFRONT_API_URL=${SELF_HOSTED_API}`,
      "VERYFRONT_PROJECT_SLUG=self-hosted-project",
    ].join("\n"));

    assertEquals(requests, [{
      origin: SELF_HOSTED_API,
      authorization: "Bearer self-hosted-key",
    }]);
  });

  it("sends a VERYFRONT_API_TOKEN from the service .env to that file's API URL", async () => {
    clearEnvKeys();
    const requests = await loadServiceEnvAndCaptureTokenRequests([
      "VERYFRONT_API_TOKEN=self-hosted-token",
      `VERYFRONT_API_URL=${SELF_HOSTED_API}`,
      "VERYFRONT_PROJECT_SLUG=self-hosted-project",
    ].join("\n"));

    assertEquals(requests, [{
      origin: SELF_HOSTED_API,
      authorization: "Bearer self-hosted-token",
    }]);
  });

  it("gives a key from the service .env the token slot with that file's provenance", async () => {
    clearEnvKeys();
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(
        `${dir}/.env`,
        "VERYFRONT_API_KEY=self-hosted-key\nVERYFRONT_PROJECT_SLUG=self-hosted-project\n",
      );
      await loadAgentServiceEnvFiles({ cwd: dir, files: [".env"] });

      assertEquals(getEnv("VERYFRONT_API_TOKEN"), "self-hosted-key");
      assertEquals(getEnvSource("VERYFRONT_API_TOKEN"), {
        source: "env-file",
        file: `${dir}/.env`,
        expandedFromProcessEnv: false,
      });
      assertEquals(getEnvSource("VERYFRONT_API_KEY"), getEnvSource("VERYFRONT_API_TOKEN"));
    });
  });

  it("keeps the expansion taint of a key that names a shell variable", async () => {
    clearEnvKeys();
    setEnv("VF_AGENT_ENV_FILE_SHELL_SECRET", "shell-secret");
    try {
      await withTempDir(async (dir) => {
        await Deno.writeTextFile(
          `${dir}/.env`,
          "VERYFRONT_API_KEY=$VF_AGENT_ENV_FILE_SHELL_SECRET\n",
        );
        await loadAgentServiceEnvFiles({ cwd: dir, files: [".env"] });

        assertEquals(getEnv("VERYFRONT_API_TOKEN"), "shell-secret");
        assertEquals(getEnvSource("VERYFRONT_API_TOKEN"), {
          source: "env-file",
          file: `${dir}/.env`,
          expandedFromProcessEnv: true,
        });
      });
    } finally {
      deleteEnv("VF_AGENT_ENV_FILE_SHELL_SECRET");
    }
  });

  it("keeps an exported VERYFRONT_API_KEY over a differently-cased file entry on Windows", async () => {
    clearEnvKeys();
    setEnv("VERYFRONT_API_KEY", "operator-key");
    // Windows reads the environment case-insensitively.
    __setEnvLoaderOsTypeForTests("windows");
    __setEnvLoaderExistingEnvReaderForTests((name) => getEnv(name) ?? getEnv(name.toUpperCase()));
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(
        `${dir}/.env`,
        "veryfront_api_key=repository-key\nVERYFRONT_PROJECT_SLUG=self-hosted-project\n",
      );
      const result = await loadAgentServiceEnvFiles({ cwd: dir, files: [".env"] });

      // On Windows a write to `veryfront_api_key` replaces the operator's key.
      assertEquals(getEnv("veryfront_api_key"), undefined);
      assertEquals(result.loadedVariables, 1);
      assertEquals(getEnv("VERYFRONT_API_TOKEN"), "operator-key");
      assertEquals(getEnvSource("VERYFRONT_API_TOKEN"), { source: "process" });
    });
  });

  it("lets a later service env file replace a differently-cased entry of an earlier one on Windows", async () => {
    clearEnvKeys();
    __setEnvLoaderOsTypeForTests("windows");
    __setEnvLoaderExistingEnvReaderForTests((name) => getEnv(name) ?? getEnv(name.toUpperCase()));
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(`${dir}/.env`, "VERYFRONT_API_KEY=key-from-env\n");
      await Deno.writeTextFile(`${dir}/.env.local`, "veryfront_api_key=key-from-local\n");
      const result = await loadAgentServiceEnvFiles({ cwd: dir });

      assertEquals(result.loadedVariables, 2);
      assertEquals(getEnv("veryfront_api_key"), "key-from-local");
    });
  });

  it("lets a token in a later service env file win over a key in an earlier one", async () => {
    clearEnvKeys();
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(`${dir}/.env`, "VERYFRONT_API_KEY=key-from-env\n");
      await Deno.writeTextFile(`${dir}/.env.local`, "VERYFRONT_API_TOKEN=token-from-local\n");
      await loadAgentServiceEnvFiles({ cwd: dir });

      assertEquals(getEnv("VERYFRONT_API_TOKEN"), "token-from-local");
      assertEquals(getEnvSource("VERYFRONT_API_TOKEN"), {
        source: "env-file",
        file: `${dir}/.env.local`,
        expandedFromProcessEnv: false,
      });
    });
  });

  it("never lets a key from the service .env stand in for a token file", async () => {
    clearEnvKeys();
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(
        `${dir}/.env`,
        "VERYFRONT_API_KEY=self-hosted-key\nVERYFRONT_API_TOKEN_FILE=\n",
      );
      await loadAgentServiceEnvFiles({ cwd: dir, files: [".env"] });

      assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
    });
  });
});
