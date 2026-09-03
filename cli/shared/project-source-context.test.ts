import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { VeryfrontConfig } from "veryfront/config";
import { deleteHostSecret, getHostEnv, setHostSecret } from "#cli/process-env";
import { saveToken } from "../auth/token-store.ts";
import {
  applyProjectSourceRuntimeAuth,
  getProxyProjectSourceContext,
  withProjectSourceContext,
} from "./project-source-context.ts";

const ENV_KEYS = [
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_SERVICE_LAYER",
  "VERYFRONT_PROJECT_ID",
  "VERYFRONT_BRANCH_REF",
  "TENANT_BRANCH_ID",
  "XDG_CONFIG_HOME",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, Deno.env.get(key)]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  deleteHostSecret("VERYFRONT_API_TOKEN");
}

describe("getProxyProjectSourceContext", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("uses VERYFRONT_BRANCH_REF when it is set", () => {
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "example-project");
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_PROJECT_ID", "project-id");
    Deno.env.set("VERYFRONT_BRANCH_REF", "preview");
    Deno.env.set("TENANT_BRANCH_ID", "branch-id");

    assertEquals(getProxyProjectSourceContext(), {
      projectSlug: "example-project",
      token: "test-token",
      projectId: "project-id",
      branchRef: "preview",
    });
  });

  it("normalizes the stored login token without a mutable String.prototype hook", () => {
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "example-project");
    Deno.env.delete("VERYFRONT_API_TOKEN");
    Deno.env.delete("VERYFRONT_PROJECT_ID");
    Deno.env.delete("VERYFRONT_BRANCH_REF");
    Deno.env.delete("TENANT_BRANCH_ID");
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
    Deno.env.set("VERYFRONT_PROJECT_SLUG", "example-project");
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("TENANT_BRANCH_ID", "branch-id");

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
    const projectDir = await Deno.makeTempDir({ prefix: "vf-project-source-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-project-source-auth-" });

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_SERVICE_LAYER");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");

      const config = {
        fs: { veryfront: { projectSlug: "configured-fs-project" } },
      } satisfies VeryfrontConfig;

      await applyProjectSourceRuntimeAuth(projectDir, config);

      // The stored login token stays out of the process environment that
      // locally imported project modules can read.
      assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), undefined);
      assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
      assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "configured-fs-project");
      assertEquals(Deno.env.get("VERYFRONT_SERVICE_LAYER"), "cloud");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("hydrates runtime auth before invoking project source callbacks", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-project-source-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-project-source-auth-" });

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_SERVICE_LAYER");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        'export default { projectSlug: "configured-source-project" };\n',
      );

      await withProjectSourceContext(projectDir, async () => {
        assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), undefined);
        assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
        assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "configured-source-project");
      });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });
});
