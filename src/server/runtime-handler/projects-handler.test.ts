import "#veryfront/schemas/_test-setup.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { ProjectDiscoveryCache } from "./local-project-discovery.ts";
import {
  __injectProjectsHandlerDepsForTests,
  handleProjectsRequest,
  serializeDiscoveredProjects,
  shouldHandleProjectsUI,
} from "./projects-handler.ts";

function createFileSystem(
  overrides: Partial<FileSystem> = {},
): FileSystem {
  return {
    exists: () => Promise.resolve(false),
    realPath: (path: string) => Promise.resolve(path.replace("/workspace", "/canonical/workspace")),
    readDir: async function* () {},
    ...overrides,
  } as unknown as FileSystem;
}

function injectFileSystem(
  fs: FileSystem,
  discoveryCache = new ProjectDiscoveryCache(),
): ProjectDiscoveryCache {
  __injectProjectsHandlerDepsForTests({
    createFileSystem: () => fs,
    cwd: () => "/workspace",
    discoveryCache,
  });
  return discoveryCache;
}

function createContext(): HandlerContext {
  return {
    adapter: { fs: {} },
    isLocalProject: true,
    securityConfig: null,
  } as unknown as HandlerContext;
}

afterEach(() => {
  __injectProjectsHandlerDepsForTests(null);
});

describe("server/runtime-handler/projects-handler", () => {
  it("exposes project identity without filesystem paths", () => {
    const payload = serializeDiscoveredProjects([
      ["project-a", "<LOCAL_PROJECT_PATH>/project-a"],
    ]);

    assertEquals(payload, [{ id: "project-a", name: "project-a", slug: "project-a" }]);
    assertEquals(JSON.stringify(payload).includes("<LOCAL_PROJECT_PATH>"), false);
  });

  it("omits project names that cannot be used as local host labels", () => {
    const payload = serializeDiscoveredProjects([
      ["safe-project", "/workspace/projects/safe-project"],
      ["bad/project", "/workspace/projects/bad/project"],
      ["_private", "/workspace/projects/_private"],
      ["a".repeat(64), `/workspace/projects/${"a".repeat(64)}`],
    ]);

    assertEquals(payload, [{ id: "safe-project", name: "safe-project", slug: "safe-project" }]);
  });

  it("only exposes local project discovery on development domains", () => {
    assertEquals(
      shouldHandleProjectsUI("/", undefined, {
        slug: null,
        branch: null,
        environment: "development",
        isVeryfrontDomain: true,
        isDraft: true,
        allowIframeEmbed: true,
      }),
      true,
    );

    for (const environment of ["preview", "staging", "production"] as const) {
      assertEquals(
        shouldHandleProjectsUI("/_vf/api/projects", undefined, {
          slug: null,
          branch: null,
          environment,
          isVeryfrontDomain: true,
          isDraft: environment === "preview",
          allowIframeEmbed: true,
        }),
        false,
      );
    }

    assertEquals(
      shouldHandleProjectsUI("/_projects-private", undefined, {
        slug: null,
        branch: null,
        environment: "development",
        isVeryfrontDomain: true,
        isDraft: true,
        allowIframeEmbed: true,
      }),
      false,
    );
  });

  it("enforces loopback, exact browser origin, and GET before discovery", async () => {
    let filesystemCalls = 0;
    injectFileSystem(
      createFileSystem({
        realPath: (path) => {
          filesystemCalls++;
          return Promise.resolve(path);
        },
      }),
    );

    const remoteRequest = new Request("http://devbox.example/_vf/api/projects");
    const remote = await handleProjectsRequest(
      remoteRequest,
      new URL(remoteRequest.url),
      createContext(),
    );
    const crossOriginRequest = new Request("http://lvh.me:3000/_vf/api/projects", {
      headers: { origin: "http://localhost:3000" },
    });
    const crossOrigin = await handleProjectsRequest(
      crossOriginRequest,
      new URL(crossOriginRequest.url),
      createContext(),
    );
    const postRequest = new Request("http://lvh.me/_vf/api/projects", { method: "POST" });
    const wrongMethod = await handleProjectsRequest(
      postRequest,
      new URL(postRequest.url),
      createContext(),
    );

    assertEquals(remote?.status, 401);
    assertEquals(crossOrigin?.status, 401);
    assertEquals(wrongMethod?.status, 405);
    assertEquals(wrongMethod?.headers.get("allow"), "GET");
    assertEquals(remote?.headers.get("cache-control"), "no-store");
    assertEquals(filesystemCalls, 0);
  });

  it("validates and applies bounded local discovery query inputs", async () => {
    const cache = new ProjectDiscoveryCache();
    cache.projects.set("alpha", "/workspace/projects/alpha");
    cache.projects.set("beta", "/workspace/projects/beta");
    injectFileSystem(
      createFileSystem({
        realPath: (path) => {
          if (path === "/workspace") return Promise.resolve("/canonical/workspace");
          return Promise.reject(FILE_NOT_FOUND.create({ message: "missing" }));
        },
      }),
      cache,
    );

    const validRequest = new Request(
      "http://lvh.me/_vf/api/projects?sort_by=updated_at&sort_order=desc&limit=1&search=alp",
    );
    const valid = await handleProjectsRequest(
      validRequest,
      new URL(validRequest.url),
      createContext(),
    );

    assertExists(valid);
    assertEquals(valid.status, 200);
    assertEquals(await valid.json(), {
      data: [{ id: "alpha", name: "alpha", slug: "alpha" }],
    });
    assertEquals(valid.headers.get("cache-control"), "no-store");

    for (
      const query of [
        "limit=101",
        "limit=1&limit=2",
        "unknown=true",
        `search=${"a".repeat(129)}`,
        "sort_by=name",
        "sort_order=sideways",
      ]
    ) {
      const request = new Request(`http://lvh.me/_vf/api/projects?${query}`);
      const response = await handleProjectsRequest(request, new URL(request.url), createContext());
      assertEquals(response?.status, 400, query);
      assertEquals(await response?.text(), '{"error":"Invalid query"}', query);
    }
  });

  it("keeps discovery responses scoped to the supplied handler cache", async () => {
    const firstCache = new ProjectDiscoveryCache();
    firstCache.projects.set("first-project", "/workspace/projects/first-project");
    const secondCache = new ProjectDiscoveryCache();
    secondCache.projects.set("second-project", "/workspace/projects/second-project");
    __injectProjectsHandlerDepsForTests({
      createFileSystem: () =>
        createFileSystem({
          realPath: (path) => {
            if (path === "/workspace") return Promise.resolve("/canonical/workspace");
            return Promise.reject(FILE_NOT_FOUND.create({ message: "missing" }));
          },
        }),
      cwd: () => "/workspace",
    });
    const request = new Request("http://lvh.me/_vf/api/projects");

    const first = await handleProjectsRequest(
      request,
      new URL(request.url),
      createContext(),
      firstCache,
    );
    const second = await handleProjectsRequest(
      request,
      new URL(request.url),
      createContext(),
      secondCache,
    );

    assertEquals(await first?.json(), {
      data: [{ id: "first-project", name: "first-project", slug: "first-project" }],
    });
    assertEquals(await second?.json(), {
      data: [{ id: "second-project", name: "second-project", slug: "second-project" }],
    });
  });

  it("rejects discovered projects whose canonical path escapes the workspace", async () => {
    const cache = injectFileSystem(
      createFileSystem({
        realPath: (path) => {
          if (path === "/workspace") return Promise.resolve("/canonical/workspace");
          if (path === "/workspace/data/projects") {
            return Promise.reject(FILE_NOT_FOUND.create({ message: "missing" }));
          }
          if (path === "/workspace/projects") {
            return Promise.resolve("/canonical/workspace/projects");
          }
          if (path.endsWith("/escape")) return Promise.resolve("/private/project");
          return Promise.resolve(path);
        },
        readDir: async function* () {
          yield { name: "escape", isFile: false, isDirectory: true, isSymlink: false };
        },
      }),
    );
    const request = new Request("http://lvh.me/_vf/api/projects");

    const response = await handleProjectsRequest(request, new URL(request.url), createContext());

    assertExists(response);
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { data: [] });
    assertEquals(cache.projects.size, 0);
  });

  it("returns a generic failure for permission errors instead of a partial result", async () => {
    injectFileSystem(
      createFileSystem({
        realPath: (path) => {
          if (path === "/workspace") return Promise.resolve("/canonical/workspace");
          return Promise.reject(new Deno.errors.PermissionDenied("denied at /private/projects"));
        },
      }),
    );
    const request = new Request("http://lvh.me/_vf/api/projects");

    const response = await handleProjectsRequest(request, new URL(request.url), createContext());

    assertExists(response);
    assertEquals(response.status, 500);
    assertEquals(await response.text(), '{"error":"Projects unavailable"}');
    assertEquals(response.headers.get("cache-control"), "no-store");
  });
});
