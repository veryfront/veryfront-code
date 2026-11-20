import "#veryfront/schemas/_test-setup.ts";
/**
 * The `project-api-url` refusal: a project `.env` (or a hydrated
 * `veryfront.json`) chose the API endpoint, so the CLI won't mint a login for it.
 *
 * Covers the error's registry identity, what it may echo, that both remedies it
 * prints actually clear it, its CLI rendering and JSON classification, and the
 * sibling paths that raise the same error class.
 */

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { deleteHostSecret } from "#cli/process-env";
import {
  _resetEnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import {
  __resetEnvLoaderForTests,
  loadEnv,
  markConfigFileSource,
} from "veryfront/utils/env-loader";
import { ERROR_REGISTRY, formatCLIError, PROJECT_API_URL, VeryfrontError } from "veryfront/errors";
import { detachBoundaryError } from "#veryfront/errors/middleware/wrap-unknown.ts";
import { applyQualifiedRuntimeAuth } from "#cli/shared/runtime-auth";
import {
  assertApiUrlAcceptsNewCredential,
  isUntrustedApiUrlCredentialError,
  resolveConfig,
  UntrustedApiUrlCredentialError,
} from "../../../../../cli/shared/config.ts";
import { classifyCliError } from "../../../../../cli/router.ts";

/** Variables a case may set; cleared before every simulated CLI start. */
const ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_KEY",
  "VERYFRONT_API_URL",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_SERVICE_LAYER",
  "VF_TEST_SHELL_SECRET",
] as const;
const RESTORED_KEYS = [...ENV_KEYS, "XDG_CONFIG_HOME"] as const;

/** A value that must never reach the refusal text. */
const MARKER = "s3cret-marker";

let saved: Map<string, string | undefined>;
let tempDirs: string[];

function clearEnv(): void {
  for (const key of ENV_KEYS) deleteEnv(key);
  deleteHostSecret("VERYFRONT_API_TOKEN");
  deleteHostSecret("VERYFRONT_API_KEY");
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await makeTempDir({ prefix });
  tempDirs.push(dir);
  return dir;
}

/**
 * Start the CLI fresh in a project folder whose `.env` holds `envFile`, with
 * `shell` as the only Veryfront variables the developer exported. Clearing
 * first matters: `loadEnv` writes `.env` values into the process environment,
 * and a value left over from an earlier load would read as a shell export.
 */
async function loadProject(
  envFile?: string,
  shell: Record<string, string> = {},
): Promise<string> {
  const projectDir = await tempDir("vf-project-api-url-");
  if (envFile !== undefined) await Deno.writeTextFile(join(projectDir, ".env"), envFile);
  clearEnv();
  for (const [key, value] of Object.entries(shell)) setEnv(key, value);
  __resetEnvLoaderForTests();
  await loadEnv({ cwd: projectDir });
  _resetEnvironmentConfig();
  return projectDir;
}

/** The refusal `login` raises for this folder, or undefined when it may proceed. */
async function loginRefusal(projectDir: string): Promise<VeryfrontError | undefined> {
  try {
    await assertApiUrlAcceptsNewCredential(getEnvironmentConfig(), projectDir);
    return undefined;
  } catch (error) {
    assert(isUntrustedApiUrlCredentialError(error), `unexpected error: ${error}`);
    assertInstanceOf(error, VeryfrontError);
    return error;
  }
}

async function expectLoginRefusal(projectDir: string): Promise<VeryfrontError> {
  const error = await loginRefusal(projectDir);
  assert(error !== undefined, "login must refuse a project-chosen API host");
  return error;
}

/** Parse the `KEY=VALUE npx veryfront login` command the refusal prints. */
function printedOverride(message: string): { key: string; value: string } {
  const match = / run: ([A-Z_]+)=(<its URL>|\S+) npx veryfront login$/.exec(message);
  assert(match !== null, `refusal must end with a runnable command: ${message}`);
  return { key: match[1]!, value: match[2]! };
}

describe("cli/shared/config project-api-url refusal", () => {
  beforeEach(async () => {
    saved = new Map(RESTORED_KEYS.map((key) => [key, getEnv(key)]));
    tempDirs = [];
    clearEnv();
    // Keep the developer's real stored login out of every case.
    setEnv("XDG_CONFIG_HOME", await tempDir("vf-project-api-url-home-"));
  });

  afterEach(async () => {
    clearEnv();
    deleteEnv("XDG_CONFIG_HOME");
    for (const [key, value] of saved) if (value !== undefined) setEnv(key, value);
    __resetEnvLoaderForTests();
    _resetEnvironmentConfig();
    for (const dir of tempDirs) await Deno.remove(dir, { recursive: true });
  });

  describe("error identity", () => {
    it("is the registered project-api-url error, not an unclassified one", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://api.veryfront.org\n");

      const error = await expectLoginRefusal(projectDir);

      assertInstanceOf(error, UntrustedApiUrlCredentialError);
      assertEquals(error.name, "UntrustedApiUrlCredentialError");
      assertEquals(error.slug, "project-api-url");
      assertEquals(error.category, "CONFIG");
      assertEquals(error.status, 400);
      assertEquals(error.title, "This project uses a different Veryfront API");
      assertEquals(error.suggestion, PROJECT_API_URL.suggestion);
      assertEquals(error.detail, error.message);
      assertEquals(ERROR_REGISTRY["project-api-url"], PROJECT_API_URL);
    });

    it("keeps a constructed refusal recognisable to every caller that must not fall back", () => {
      const error = new UntrustedApiUrlCredentialError("detail");

      assertEquals(isUntrustedApiUrlCredentialError(error), true);
      assertEquals(error.slug, "project-api-url");
      assertEquals(error.detail, "detail");
      assertEquals(isUntrustedApiUrlCredentialError(new Error("unrelated")), false);
      assertEquals(
        isUntrustedApiUrlCredentialError(
          new VeryfrontError("other", {
            slug: "config-invalid",
            category: "CONFIG",
            status: 400,
            title: "Other",
          }),
        ),
        false,
      );
    });
  });

  describe("production first, then the project's API", () => {
    it("offers removing the setting before the shell override for a .env VERYFRONT_API_URL", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://api.veryfront.org\n");

      const { message } = await expectLoginRefusal(projectDir);

      assertEquals(
        message,
        ".env sets VERYFRONT_API_URL to https://api.veryfront.org, so your login isn't sent there. " +
          "To use production, remove VERYFRONT_API_URL from .env. " +
          "To use https://api.veryfront.org, run: " +
          "VERYFRONT_API_URL=https://api.veryfront.org npx veryfront login",
      );
    });

    it("names the env file, never its path", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://attacker.example\n");

      const { message } = await expectLoginRefusal(projectDir);

      assertEquals(message.includes(projectDir), false);
      assertStringIncludes(message, "remove VERYFRONT_API_URL from .env.");
    });

    it("names VERYFRONT_API_BASE_URL when that is the key the .env sets", async () => {
      const projectDir = await loadProject(
        "VERYFRONT_API_BASE_URL=https://api.veryfront.org\n",
      );

      const { message } = await expectLoginRefusal(projectDir);

      assertStringIncludes(message, ".env sets VERYFRONT_API_BASE_URL to ");
      assertStringIncludes(message, "To use production, remove VERYFRONT_API_BASE_URL from .env.");
      assertEquals(printedOverride(message).key, "VERYFRONT_API_BASE_URL");
      assert(message.indexOf("To use production") < message.indexOf(" run: "));
    });

    it("explains a veryfront.json endpoint hydrated from another project in its own terms", async () => {
      const projectDir = await loadProject();
      markConfigFileSource("VERYFRONT_API_BASE_URL", "/different-project/veryfront.json");

      const error = await assertRejects(
        () =>
          assertApiUrlAcceptsNewCredential(
            { apiBaseUrl: "https://attacker.example/api" } as ReturnType<
              typeof getEnvironmentConfig
            >,
            projectDir,
          ),
        UntrustedApiUrlCredentialError,
      ) as UntrustedApiUrlCredentialError;

      assertEquals(
        error.message,
        "veryfront.json sets apiUrl to a different API, so your login isn't sent there. " +
          "To use production, remove apiUrl from veryfront.json. " +
          "To use the API this project sets, run: VERYFRONT_API_URL=<its URL> npx veryfront login",
      );
      assertEquals(error.message.includes("different-project"), false);
      assertEquals(error.slug, "project-api-url");
    });
  });

  describe("what the refusal may echo", () => {
    for (
      const [envValue, echoed] of [
        ["https://api.veryfront.org", "https://api.veryfront.org"],
        ["https://api.veryfront.org/", "https://api.veryfront.org"],
        ["HTTPS://API.VERYFRONT.ORG", "https://api.veryfront.org"],
        ["https://api.veryfront.org:443", "https://api.veryfront.org"],
      ] as const
    ) {
      it(`echoes Veryfront's own host for ${envValue}`, async () => {
        const projectDir = await loadProject(`VERYFRONT_API_URL=${envValue}\n`);

        const { message } = await expectLoginRefusal(projectDir);

        assertStringIncludes(message, `sets VERYFRONT_API_URL to ${echoed},`);
        assertEquals(printedOverride(message), { key: "VERYFRONT_API_URL", value: echoed });
      });
    }

    for (
      const [label, envValue] of [
        ["another host", "https://attacker.example"],
        ["a lookalike suffix", "https://api.veryfront.org.attacker.example"],
        ["a Veryfront name in userinfo", "https://api.veryfront.org@attacker.example"],
        ["plain http", "http://api.veryfront.org"],
        ["a non-default port", "https://api.veryfront.org:8443"],
        ["credentials in userinfo", `https://user:${MARKER}@api.veryfront.org`],
        ["a query", `https://api.veryfront.org/?token=${MARKER}`],
        ["a fragment", `https://api.veryfront.org/#${MARKER}`],
        ["a path", `https://api.veryfront.org/${MARKER}`],
        ["an unparseable value", `not a url ${MARKER}`],
      ] as const
    ) {
      it(`never echoes ${label}`, async () => {
        const projectDir = await loadProject(`VERYFRONT_API_URL=${envValue}\n`);

        const error = await expectLoginRefusal(projectDir);
        const rendered = formatCLIError(detachBoundaryError(error), { color: false });

        for (const text of [error.message, rendered]) {
          assertEquals(text.includes(MARKER), false, text);
          assertEquals(text.includes("attacker"), false, text);
          assertEquals(text.includes("veryfront.org"), false, text);
        }
        assertStringIncludes(error.message, "sets VERYFRONT_API_URL to a different API,");
        assertEquals(printedOverride(error.message), {
          key: "VERYFRONT_API_URL",
          value: "<its URL>",
        });
      });
    }

    it("never echoes a shell secret the .env value expands", async () => {
      const projectDir = await loadProject(
        "VERYFRONT_API_URL=https://api.veryfront.org/${VF_TEST_SHELL_SECRET}\n",
        { VF_TEST_SHELL_SECRET: MARKER },
      );

      const { message } = await expectLoginRefusal(projectDir);

      assertEquals(message.includes(MARKER), false, message);
      assertEquals(printedOverride(message).value, "<its URL>");
    });
  });

  describe("both printed remedies clear the refusal", () => {
    for (const key of ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"] as const) {
      it(`running the printed ${key} override lets login proceed`, async () => {
        const envFile = `${key}=https://api.veryfront.org\n`;
        const refused = await expectLoginRefusal(await loadProject(envFile));
        const override = printedOverride(refused.message);

        const projectDir = await loadProject(envFile, { [override.key]: override.value });

        assertEquals(await loginRefusal(projectDir), undefined);
      });

      it(`removing ${key} from .env lets login proceed against production`, async () => {
        await expectLoginRefusal(await loadProject(`${key}=https://api.veryfront.org\n`));

        const projectDir = await loadProject("OTHER_SETTING=1\n");

        assertEquals(await loginRefusal(projectDir), undefined);
        assertEquals(getEnvironmentConfig().apiUrl, undefined);
      });
    }

    it("does not refuse a .env that names production itself", async () => {
      for (const value of ["https://api.veryfront.com", "https://api.veryfront.com/"]) {
        const projectDir = await loadProject(`VERYFRONT_API_URL=${value}\n`);
        assertEquals(await loginRefusal(projectDir), undefined, value);
      }
    });

    it("does not refuse when the shell already sets a different endpoint than the .env", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://attacker.example\n", {
        VERYFRONT_API_URL: "https://api.veryfront.com",
      });

      assertEquals(getEnvironmentConfig().apiUrl, "https://api.veryfront.com");
      assertEquals(await loginRefusal(projectDir), undefined);
    });
  });

  describe("CLI rendering and JSON classification", () => {
    it("renders with its own code, title, detail, suggestion, and docs anchor", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://api.veryfront.org\n");
      const error = await expectLoginRefusal(projectDir);

      const vfError = detachBoundaryError(error);
      const rendered = formatCLIError(vfError, { color: false });

      assertEquals(vfError.slug, "project-api-url");
      assertEquals(vfError.detail, error.message);
      assertStringIncludes(
        rendered,
        "[project-api-url] This project uses a different Veryfront API",
      );
      assertStringIncludes(rendered, "To use production, remove VERYFRONT_API_URL from .env.");
      assertStringIncludes(rendered, PROJECT_API_URL.suggestion!);
      assertStringIncludes(rendered, "errors#project-api-url");
      assertEquals(rendered.includes("unknown-error"), false);
    });

    it("keeps the placeholder text intact through the boundary", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://attacker.example\n");
      const error = await expectLoginRefusal(projectDir);

      const vfError = detachBoundaryError(error);

      assertEquals(vfError.detail, error.message);
      assertStringIncludes(
        formatCLIError(vfError, { color: false }),
        "VERYFRONT_API_URL=<its URL> npx veryfront login",
      );
    });

    it("classifies as a runtime failure that exits 1, with the registry slug alongside", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://api.veryfront.org\n");
      const vfError = detachBoundaryError(await expectLoginRefusal(projectDir));

      // The router puts the stable classification in `slug` and the registry
      // entry in `registrySlug`.
      assertEquals(classifyCliError(vfError), {
        code: "RUNTIME_ERROR",
        slug: "command-failed",
        exitCode: 1,
      });
      assertEquals(vfError.slug, "project-api-url");
    });
  });

  describe("sibling paths that raise the same error", () => {
    it("keeps the existing-credential refusal's wording while giving it the registered code", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://attacker.example\n", {
        VERYFRONT_API_TOKEN: "shell-token",
      });

      const error = await assertRejects(
        () => resolveConfig(projectDir, getEnvironmentConfig()),
        UntrustedApiUrlCredentialError,
      ) as UntrustedApiUrlCredentialError;

      assertStringIncludes(
        error.message,
        "The project .env file sets VERYFRONT_API_URL to a repository-configured API endpoint.",
      );
      assertEquals(error.message.includes("attacker"), false);
      assertEquals(error.slug, "project-api-url");
    });

    it("refuses runtime auth for dev and start with the registered code when nothing may be sent", async () => {
      const projectDir = await loadProject("VERYFRONT_API_URL=https://attacker.example\n");

      const error = await assertRejects(
        () => applyQualifiedRuntimeAuth(projectDir),
        UntrustedApiUrlCredentialError,
      ) as UntrustedApiUrlCredentialError;

      assertEquals(error.slug, "project-api-url");
      assertStringIncludes(error.message, "To use production, remove VERYFRONT_API_URL from .env.");
      assertEquals(error.message.includes("attacker"), false);
    });
  });
});
