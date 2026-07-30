import { assertEquals } from "#veryfront/testing/assert.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { ProjectDiscoveryCache } from "./local-project-discovery.ts";
import {
  createLocalProjectsDiscoveryService,
  handleProjectsRequest,
  type LocalProjectsDiscoveryService,
} from "./projects-handler.ts";

const CONTEXT = {
  projectSlug: undefined,
  parsedDomain: { isVeryfrontDomain: true },
} as HandlerContext;

function projectsDependencies(discoveryService: LocalProjectsDiscoveryService) {
  return {
    projectsHandler: {
      metadata: { name: "unused-projects-handler", priority: 100 },
      handle: () => Promise.reject(new Error("UI handler must not run for discovery API tests")),
    },
    discoveryService,
  };
}

Deno.test("local discovery replaces its stale generation and preserves injected cache entries", async () => {
  const adapter = createMockAdapter();
  const cache = new ProjectDiscoveryCache();
  cache.projects.set("injected", "/external/injected");
  adapter.fs.directories.add("/configured/projects/old");
  adapter.fs.directories.add("/configured/projects/old/app");

  const service = createLocalProjectsDiscoveryService({
    projectRoot: "/configured",
    fileSystem: adapter.fs,
    cache,
  });
  assertEquals((await service.list()).map((project) => project.slug), ["injected", "old"]);

  adapter.fs.directories.delete("/configured/projects/old/app");
  adapter.fs.directories.delete("/configured/projects/old");
  adapter.fs.directories.add("/configured/projects/new");
  adapter.fs.directories.add("/configured/projects/new/pages");

  assertEquals((await service.list()).map((project) => project.slug), ["injected", "new"]);
  assertEquals(
    Array.from(cache.projects.entries()).sort(([left], [right]) => left.localeCompare(right)),
    [
      ["injected", "/external/injected"],
      ["new", "/configured/projects/new"],
    ],
  );
});

Deno.test("local discovery rejects a physical project path outside its configured root", async () => {
  const fileSystem = createMockAdapter().fs;
  Object.defineProperty(fileSystem, "symlinkSemantics", {
    configurable: true,
    value: undefined,
  });
  const existingPaths = new Set([
    "/configured/projects",
    "/configured/projects/escape",
  ]);
  fileSystem.exists = (path) => Promise.resolve(existingPaths.has(path));
  fileSystem.lstat = () =>
    Promise.resolve({
      size: 0,
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      mtime: null,
    });
  fileSystem.realPath = (path) => {
    const canonicalPaths = new Map([
      ["/configured", "/physical/configured"],
      ["/configured/projects", "/physical/configured/projects"],
      ["/configured/projects/escape", "/outside/escape"],
    ]);
    const canonical = canonicalPaths.get(path);
    return canonical === undefined
      ? Promise.reject(new Error("unexpected realPath input"))
      : Promise.resolve(canonical);
  };
  fileSystem.readDir = async function* (path) {
    if (path === "/configured/projects") {
      yield { name: "escape", isFile: false, isDirectory: true, isSymlink: false };
    }
  };
  const cache = new ProjectDiscoveryCache();
  const response = await handleProjectsRequest(
    new Request("http://veryfront.me/_vf/api/projects"),
    new URL("http://veryfront.me/_vf/api/projects"),
    CONTEXT,
    projectsDependencies(
      createLocalProjectsDiscoveryService({
        projectRoot: "/configured",
        fileSystem,
        cache,
      }),
    ),
  );

  assertEquals(response?.status, 503);
  const body = await response!.text();
  assertEquals(body.includes("/outside/escape"), false);
  assertEquals(Array.from(cache.projects.entries()), []);
});

Deno.test("projects discovery API admits only GET and HEAD and cancels rejected bodies", async () => {
  let listCalls = 0;
  const discoveryService: LocalProjectsDiscoveryService = {
    list() {
      listCalls++;
      return Promise.resolve([{ id: "one", name: "one", slug: "one" }]);
    },
  };
  let bodyCancelled = false;
  let releaseCancellation!: () => void;
  const cancellationGate = new Promise<void>((resolve) => {
    releaseCancellation = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      bodyCancelled = true;
      return cancellationGate;
    },
  });
  const postRequest = new Request("http://veryfront.me/_vf/api/projects", {
    method: "POST",
    body,
  });
  let postResponseSettled = false;
  const postResponsePromise = handleProjectsRequest(
    postRequest,
    new URL(postRequest.url),
    CONTEXT,
    projectsDependencies(discoveryService),
  );
  void postResponsePromise.then(() => {
    postResponseSettled = true;
  });
  await Promise.resolve();
  assertEquals(postResponseSettled, true);
  releaseCancellation();
  const postResponse = await postResponsePromise;
  assertEquals(postResponse?.status, 405);
  assertEquals(postResponse?.headers.get("allow"), "GET, HEAD");
  assertEquals(bodyCancelled, true);
  assertEquals(listCalls, 0);

  const getRequest = new Request("http://veryfront.me/_vf/api/projects");
  const getResponse = await handleProjectsRequest(
    getRequest,
    new URL(getRequest.url),
    CONTEXT,
    projectsDependencies(discoveryService),
  );
  const headRequest = new Request("http://veryfront.me/_vf/api/projects", { method: "HEAD" });
  const headResponse = await handleProjectsRequest(
    headRequest,
    new URL(headRequest.url),
    CONTEXT,
    projectsDependencies(discoveryService),
  );

  assertEquals(getResponse?.status, 200);
  assertEquals(headResponse?.status, 200);
  assertEquals(
    headResponse?.headers.get("content-length"),
    getResponse?.headers.get("content-length"),
  );
  assertEquals(await headResponse!.text(), "");
  assertEquals(listCalls, 2);
});
