import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontError } from "veryfront/errors";
import type { VeryfrontConfig } from "veryfront/config";
import {
  deleteHostSecret,
  getHostEnv,
  getHostEnvExcludingEnvFile,
  setHostSecret,
} from "#cli/process-env";
import { saveToken } from "../auth/token-store.ts";
import {
  _resetEnvironmentConfig,
  createTestEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import {
  deleteEnv,
  getEnv,
  makeTempDir,
  remove,
  setEnv,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import {
  applyProjectSourceRuntimeAuth,
  getProxyProjectSourceContext,
  withProjectSourceContext,
} from "./project-source-context.ts";

const ENV_KEYS = [
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
  "VERYFRONT_SERVICE_LAYER",
  "VERYFRONT_PROJECT_ID",
  "VERYFRONT_BRANCH_REF",
  "TENANT_BRANCH_ID",
  "XDG_CONFIG_HOME",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));

/** Answers the stored-login check with `status`, recording each request URL. */
function installStoredLoginCheck(status: number): string[] {
  const urls: string[] = [];
  installMockFetch(
    ((input: URL | Request | string, init?: RequestInit) => {
      urls.push(new Request(input, init).url);
      return Promise.resolve(
        status === 200 ? Response.json({ id: "user-1" }) : new Response(null, { status }),
      );
    }) as typeof fetch,
  );
  return urls;
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      deleteEnv(key);
    } else {
      setEnv(key, value);
    }
  }
  deleteHostSecret("VERYFRONT_API_TOKEN");
  _resetEnvironmentConfig();
}

describe("getProxyProjectSourceContext", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("uses VERYFRONT_BRANCH_REF when it is set", () => {
    setEnv("VERYFRONT_PROJECT_SLUG", "example-project");
    setEnv("VERYFRONT_API_TOKEN", "test-token");
    setEnv("VERYFRONT_PROJECT_ID", "project-id");
    setEnv("VERYFRONT_BRANCH_REF", "preview");
    setEnv("TENANT_BRANCH_ID", "branch-id");

    assertEquals(getProxyProjectSourceContext(), {
      projectSlug: "example-project",
      token: "test-token",
      projectId: "project-id",
      branchRef: "preview",
    });
  });

  it("normalizes the stored login token without a mutable String.prototype hook", () => {
    setEnv("VERYFRONT_PROJECT_SLUG", "example-project");
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_ID");
    deleteEnv("VERYFRONT_BRANCH_REF");
    deleteEnv("TENANT_BRANCH_ID");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    // Project code served by `veryfront dev` runs in this realm and can
    // replace `String.prototype.trim`. Normalizing the host-private credential
    // must never hand it to such a hook as its method receiver.
    const originalTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim")!;
    let observedCredential = 0;
    Object.defineProperty(String.prototype, "trim", {
      configurable: true,
      writable: true,
      value: function (this: unknown): string {
        if (this === "stored-login-token") observedCredential += 1;
        return Reflect.apply(originalTrim.value, this, []);
      },
    });

    try {
      assertEquals(getProxyProjectSourceContext(), {
        projectSlug: "example-project",
        token: "stored-login-token",
        projectId: undefined,
        branchRef: null,
      });
    } finally {
      Object.defineProperty(String.prototype, "trim", originalTrim);
    }

    assertEquals(observedCredential, 0);
  });

  it("uses TENANT_BRANCH_ID when VERYFRONT_BRANCH_REF is not set", () => {
    setEnv("VERYFRONT_PROJECT_SLUG", "example-project");
    setEnv("VERYFRONT_API_TOKEN", "test-token");
    setEnv("TENANT_BRANCH_ID", "branch-id");

    assertEquals(getProxyProjectSourceContext(), {
      projectSlug: "example-project",
      token: "test-token",
      projectId: undefined,
      branchRef: "branch-id",
    });
  });
});

describe("project source runtime auth", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("hydrates runtime auth from fs.veryfront.projectSlug", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-project-source-" });
    const configHome = await makeTempDir({ prefix: "vf-project-source-auth-" });

    try {
      deleteEnv("VERYFRONT_API_TOKEN");
      deleteEnv("VERYFRONT_PROJECT_SLUG");
      deleteEnv("VERYFRONT_SERVICE_LAYER");
      setEnv("XDG_CONFIG_HOME", configHome);
      _resetEnvironmentConfig();
      await saveToken("stored-token", createTestEnvironmentConfig({ xdgConfigHome: configHome }));

      const config = {
        fs: { veryfront: { projectSlug: "configured-fs-project" } },
      } satisfies VeryfrontConfig;
      const requests = installStoredLoginCheck(200);

      await applyProjectSourceRuntimeAuth(projectDir, config);

      // The stored login token stays out of the process environment that
      // locally imported project modules can read.
      assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
      assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
      assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), "configured-fs-project");
      assertEquals(getEnv("VERYFRONT_SERVICE_LAYER"), "cloud");
      // The linked project's stored login is checked before the command runs.
      assertEquals(requests, ["https://api.veryfront.com/me"]);
    } finally {
      restoreMockFetch();
      await remove(projectDir, { recursive: true });
      await remove(configHome, { recursive: true });
    }
  });

  it("hydrates runtime auth before invoking project source callbacks", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-project-source-" });
    const configHome = await makeTempDir({ prefix: "vf-project-source-auth-" });

    try {
      deleteEnv("VERYFRONT_API_TOKEN");
      deleteEnv("VERYFRONT_PROJECT_SLUG");
      deleteEnv("VERYFRONT_SERVICE_LAYER");
      setEnv("XDG_CONFIG_HOME", configHome);
      _resetEnvironmentConfig();
      await saveToken("stored-token", createTestEnvironmentConfig({ xdgConfigHome: configHome }));
      await writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        'export default { projectSlug: "configured-source-project" };\n',
      );

      installStoredLoginCheck(200);

      await withProjectSourceContext(projectDir, async () => {
        assertEquals(getEnv("VERYFRONT_API_TOKEN"), undefined);
        assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
        assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), "configured-source-project");
      });
    } finally {
      restoreMockFetch();
      await remove(projectDir, { recursive: true });
      await remove(configHome, { recursive: true });
    }
  });

  it("stops before the project callback runs when a linked project's stored login expired", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-project-source-" });
    const configHome = await makeTempDir({ prefix: "vf-project-source-auth-" });

    try {
      deleteEnv("VERYFRONT_API_TOKEN");
      deleteEnv("VERYFRONT_PROJECT_SLUG");
      deleteEnv("VERYFRONT_SERVICE_LAYER");
      setEnv("XDG_CONFIG_HOME", configHome);
      _resetEnvironmentConfig();
      // A rejection is remembered per process, so this case stores its own login.
      await saveToken(
        `expired-${crypto.randomUUID()}`,
        createTestEnvironmentConfig({ xdgConfigHome: configHome }),
      );
      await writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        'export default { projectSlug: "configured-source-project" };\n',
      );
      const requests = installStoredLoginCheck(401);
      let callbackRan = false;

      const error = await assertRejects(
        () =>
          withProjectSourceContext(projectDir, () => {
            callbackRan = true;
            return Promise.resolve();
          }),
        VeryfrontError,
      ) as VeryfrontError;

      assertEquals(error.slug, "authentication-required");
      assertEquals(error.detail, "Your Veryfront login expired. Run `veryfront login`.");
      // `task`, `workflow`, schedules and webhooks run inside this callback.
      assertEquals(callbackRan, false);
      assertEquals(requests, ["https://api.veryfront.com/me"]);
    } finally {
      restoreMockFetch();
      await remove(projectDir, { recursive: true });
      await remove(configHome, { recursive: true });
    }
  });

  it("captures host API routing before project config executes", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-project-source-route-" });
    const configHome = await makeTempDir({ prefix: "vf-project-source-route-auth-" });

    try {
      deleteEnv("VERYFRONT_API_TOKEN");
      setEnv("VERYFRONT_API_URL", "https://trusted-api.example");
      setEnv("XDG_CONFIG_HOME", configHome);
      _resetEnvironmentConfig();
      await saveToken("stored-token", createTestEnvironmentConfig({ xdgConfigHome: configHome }));
      await writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `${["Deno", "env", "set"].join(".")}(` +
          '"VERYFRONT_API_URL", "https://attacker.example");\n' +
          'export default { projectSlug: "configured-source-project" };\n',
      );

      const requests = installStoredLoginCheck(200);

      await withProjectSourceContext(projectDir, async () => {
        assertEquals(
          getHostEnvExcludingEnvFile("VERYFRONT_API_URL"),
          "https://trusted-api.example",
        );
      });

      // Project config moved the API URL, so the linked project's login check
      // does not send the stored login anywhere.
      assertEquals(requests, []);
    } finally {
      restoreMockFetch();
      await remove(projectDir, { recursive: true });
      await remove(configHome, { recursive: true });
    }
  });
});
