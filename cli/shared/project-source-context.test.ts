import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { VeryfrontConfig } from "veryfront/config";
import { saveToken } from "../auth/token-store.ts";
import {
  applyProjectSourceRuntimeAuth,
  getProxyProjectSourceContext,
  withProjectSourceContext,
} from "./project-source-context.ts";

const ENV_KEYS = [
  "VERYFRONT_PROJECT_SLUG",
  "VERYFRONT_API_TOKEN",
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
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");

      const config = {
        fs: { veryfront: { projectSlug: "configured-fs-project" } },
      } satisfies VeryfrontConfig;

      await applyProjectSourceRuntimeAuth(projectDir, config);

      assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), "stored-token");
      assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "configured-fs-project");
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
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        'export default { projectSlug: "configured-source-project" };\n',
      );

      await withProjectSourceContext(projectDir, async () => {
        assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), "stored-token");
        assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "configured-source-project");
      });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });
});
