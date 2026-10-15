import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { stub } from "#std/testing/mock";
import {
  connectedDevApiBaseUrl,
  connectedDevStudioBaseUrl,
  createConnectedDevControlPlane,
  prepareConnectedDev,
} from "../../../../../../cli/commands/dev/connected-dev.ts";

describe("connected local development", () => {
  it("leaves unlinked projects standalone without authentication", async () => {
    assertEquals(
      await prepareConnectedDev(undefined, "preview", {
        authenticate: () => {
          throw new Error("must not authenticate");
        },
        resolve: () => {
          throw new Error("must not resolve");
        },
      }),
      undefined,
    );
  });

  it("requires login before a linked server starts", async () => {
    await assertRejects(
      () =>
        prepareConnectedDev("demo", "preview", {
          authenticate: () => Promise.resolve(false),
          resolve: () => {
            throw new Error("must not resolve");
          },
        }),
      Error,
      "veryfront login",
    );
  });

  it("passes explicit environment selection to the project resolver", async () => {
    const calls: string[][] = [];
    const result = await prepareConnectedDev("demo", "staging", {
      authenticate: () => Promise.resolve(true),
      resolve: (project, environment) => {
        calls.push([project, environment]);
        return Promise.resolve({
          projectId: "p",
          projectSlug: "demo",
          environmentId: "e",
          environmentName: "staging",
        });
      },
    });
    assertEquals(calls, [["demo", "staging"]]);
    assertEquals(result?.environmentId, "e");
  });
});

it("uses the official API for an implicitly qualified default credential", () => {
  assertEquals(connectedDevApiBaseUrl(), "https://api.veryfront.com");
  assertEquals(connectedDevApiBaseUrl("http://localhost:4400"), "http://localhost:4400");
});

it("excludes proxy projects from local Cloud admission", async () => {
  assertEquals(
    await prepareConnectedDev("proxy-project", "preview", {
      authenticate: () => {
        throw new Error("must not authenticate local Cloud runtime");
      },
      resolve: () => {
        throw new Error("must not resolve or mutate association");
      },
    }, true),
    undefined,
  );
});

it("stops MCP and dev servers even when connected runtime disposal rejects", async () => {
  const { stopDevServices } = await import("../../../../../../cli/commands/dev/connected-dev.ts");
  const stopped: string[] = [];
  const failure = new Error("runtime disposal rejected");
  let caught: unknown;
  try {
    await stopDevServices([
      () => Promise.reject(failure),
      () => {
        stopped.push("mcp");
      },
      () => {
        stopped.push("dev");
      },
    ]);
  } catch (error) {
    caught = error;
  }
  assertEquals(stopped, ["mcp", "dev"]);
  assertEquals(caught instanceof AggregateError, true);
  assertEquals((caught as AggregateError).errors, [failure]);
});

it("connected preflight ignores a project-replaced global fetch", async () => {
  let hostRequests = 0;
  let projectRequests = 0;
  await withMockFetch(() => {
    hostRequests++;
    throw new Error("host transport reached");
  }, async () => {
    // Fault injection models project config replacing the global, not a network stub.
    const poisoned = stub(globalThis, "fetch", () => {
      projectRequests++;
      throw new Error("project transport reached");
    });
    try {
      const controlPlane = createConnectedDevControlPlane({
        apiUrl: "https://api.example.com",
        apiToken: "fake-private-token",
        projectSlug: "demo",
      });
      await assertRejects(() => controlPlane.getProject("demo"), Error, "host transport reached");
      assertEquals(hostRequests, 1);
      assertEquals(projectRequests, 0);
    } finally {
      poisoned.restore();
    }
  });
});

it("resolves the Studio origin for the connected API without an override", () => {
  assertEquals(connectedDevStudioBaseUrl("http://localhost:4400"), "http://localhost:3000");
  assertEquals(connectedDevStudioBaseUrl("http://127.0.0.1:4000"), "http://localhost:3000");
  assertEquals(connectedDevStudioBaseUrl("http://[::1]:4000"), "http://localhost:3000");
  assertEquals(connectedDevStudioBaseUrl("https://api.veryfront.com"), "https://veryfront.com");
  assertEquals(connectedDevStudioBaseUrl("https://api.veryfront.org/api"), "https://veryfront.org");
});

it("keeps an explicit Studio override for any connected API", () => {
  assertEquals(
    connectedDevStudioBaseUrl("https://api.example.com", "http://localhost:3440"),
    "http://localhost:3440",
  );
  assertEquals(
    connectedDevStudioBaseUrl("http://localhost:4400", "http://localhost:3440"),
    "http://localhost:3440",
  );
});

it("requires a Studio override for an unsupported connected API", () => {
  assertThrows(
    () => connectedDevStudioBaseUrl("https://api.example.com"),
    Error,
    "Set STUDIO_URL",
  );
});

Deno.test("connected project and environment reads carry onboarding deadlines", async () => {
  const paths: string[] = [];
  await withMockFetch((_input, init) => {
    assertEquals(init?.signal instanceof AbortSignal, true);
    const path = new URL(String(_input)).pathname;
    paths.push(path);
    return Promise.resolve(
      Response.json(
        path.endsWith("/environments")
          ? { data: [{ id: "environment", name: "preview" }] }
          : { id: "project", slug: "demo", name: "Demo" },
      ),
    );
  }, async () => {
    const controlPlane = createConnectedDevControlPlane({
      apiUrl: "https://api.veryfront.com",
      apiToken: "test",
      projectSlug: "demo",
    });
    await controlPlane.getProject("demo");
    await controlPlane.getEnvironment("project", "preview");
  });
  assertEquals(paths.length, 2);
});

Deno.test("connected development resolves a renamed linked project by canonical ID", async () => {
  const { writeProjectLink, readProjectLink } = await import(
    "../../../../../../cli/shared/project-link.ts"
  );
  const { resolveConnectedDevProject } = await import(
    "../../../../../../cli/commands/dev/connected-dev.ts"
  );
  const projectDir = await Deno.makeTempDir();
  try {
    await writeProjectLink(projectDir, {
      controlPlane: "https://api.veryfront.com",
      projectId: "52e9f7ea-5c06-4f9b-b04d-352f31484c54",
      projectSlug: "old-slug",
    });
    const config = {
      apiUrl: "https://api.veryfront.com",
      apiToken: "test",
      projectSlug: "old-slug",
    };
    let canonicalSlug = "renamed";
    await withMockFetch((input) => {
      assertEquals(
        new URL(String(input)).pathname,
        "/projects/52e9f7ea-5c06-4f9b-b04d-352f31484c54",
      );
      return Promise.resolve(
        Response.json({
          id: "52e9f7ea-5c06-4f9b-b04d-352f31484c54",
          slug: canonicalSlug,
          name: "Renamed",
        }),
      );
    }, async () => {
      const project = await resolveConnectedDevProject(
        createConnectedDevControlPlane(config),
        projectDir,
        config,
      );
      assertEquals(project.slug, "renamed");
      assertEquals((await readProjectLink(projectDir))?.projectSlug, "renamed");
      canonicalSlug = "renamed-again";
      await resolveConnectedDevProject(createConnectedDevControlPlane(config), projectDir, {
        ...config,
        projectSlug: "renamed",
      });
      const repeated = await resolveConnectedDevProject(
        createConnectedDevControlPlane(config),
        projectDir,
        config,
      );
      assertEquals(repeated.slug, "renamed-again");
      const override = await resolveConnectedDevProject(
        {
          getProject: (reference) => {
            assertEquals(reference, "explicit-other");
            return Promise.resolve({ id: "other", slug: "explicit-other", name: "Other" });
          },
        },
        projectDir,
        { ...config, projectSlug: "explicit-other" },
      );
      assertEquals(override.id, "other");
      assertEquals((await readProjectLink(projectDir))?.projectSlug, "renamed-again");
      assertEquals((await readProjectLink(projectDir))?.previousProjectSlugs, [
        "old-slug",
        "renamed",
      ]);
    });
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

Deno.test("connected development resolves shared configuration without a private link", async () => {
  const { resolveConnectedDevProject } = await import(
    "../../../../../../cli/commands/dev/connected-dev.ts"
  );
  const projectDir = await Deno.makeTempDir();
  try {
    const project = await resolveConnectedDevProject(
      {
        getProject: (reference) => {
          assertEquals(reference, "shared");
          return Promise.resolve({ id: "shared-id", slug: "shared", name: "Shared" });
        },
      },
      projectDir,
      { apiUrl: "https://api.veryfront.com", apiToken: "test", projectSlug: "shared" },
    );
    assertEquals(project.id, "shared-id");
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

Deno.test("canonical connected identity reaches inference environment and runtime context", async () => {
  const { applyConnectedDevProjectSlug } = await import(
    "../../../../../../cli/commands/dev/connected-dev.ts"
  );
  const { getEnv, setEnv, deleteEnv } = await import("#cli/process-env");
  const { refreshEnvironmentConfig } = await import("#cli/environment-config");
  const { getEnvironmentConfig } = await import("veryfront/config");
  const previous = getEnv("VERYFRONT_PROJECT_SLUG");
  setEnv("VERYFRONT_PROJECT_SLUG", "old-slug");
  refreshEnvironmentConfig();
  try {
    const context = applyConnectedDevProjectSlug({ projectSlug: "old-slug" }, "canonical-slug");
    assertEquals(context.projectSlug, "canonical-slug");
    assertEquals(getEnv("VERYFRONT_PROJECT_SLUG"), "canonical-slug");
    assertEquals(getEnvironmentConfig().projectSlug, "canonical-slug");
  } finally {
    if (previous === undefined) deleteEnv("VERYFRONT_PROJECT_SLUG");
    else setEnv("VERYFRONT_PROJECT_SLUG", previous);
    refreshEnvironmentConfig();
  }
});
