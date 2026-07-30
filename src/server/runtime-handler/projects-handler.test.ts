import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { createDevUiAssetProvider } from "#veryfront/extensions/dev-ui";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { ProjectsHandler } from "../handlers/dev/projects/index.ts";
import { createVeryfrontHandler } from "./index.ts";
import { ProjectDiscoveryCache } from "./local-project-discovery.ts";
import {
  createLocalProjectsDiscoveryService,
  handleProjectsRequest,
  type LocalProjectsDiscoveryService,
} from "./projects-handler.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

const BUNDLE = "globalThis.__runtimeProjectsUi = true;";
const PROVIDER = createDevUiAssetProvider(BUNDLE);
const CONTEXT = {
  projectSlug: undefined,
  parsedDomain: { isVeryfrontDomain: true },
} as HandlerContext;
const EMPTY_DISCOVERY: LocalProjectsDiscoveryService = {
  list: () => Promise.resolve([]),
};

function projectsDependencies(
  discoveryService: LocalProjectsDiscoveryService = EMPTY_DISCOVERY,
) {
  return {
    projectsHandler: new ProjectsHandler(PROVIDER),
    discoveryService,
  };
}

Deno.test("runtime projects route uses the generation-captured Dev UI assets", async () => {
  const shell = await handleProjectsRequest(
    new Request("https://veryfront.test/_projects"),
    new URL("https://veryfront.test/_projects"),
    CONTEXT,
    projectsDependencies(),
  );
  assertEquals(shell?.status, 200);
  assertStringIncludes(await shell!.text(), 'data-veryfront-dev-ui="projects"');

  const asset = await handleProjectsRequest(
    new Request("https://veryfront.test/_projects/ui/index.js"),
    new URL("https://veryfront.test/_projects/ui/index.js"),
    CONTEXT,
    projectsDependencies(),
  );
  assertEquals(asset?.status, 200);
  assertEquals(await asset!.text(), BUNDLE);
});

Deno.test("runtime projects route has no source or missing-extension fallback", async () => {
  const unavailableDependencies = {
    projectsHandler: new ProjectsHandler(),
    discoveryService: EMPTY_DISCOVERY,
  };
  for (const path of ["/_projects", "/_projects/ui/index.js"]) {
    const response = await handleProjectsRequest(
      new Request(`https://veryfront.test${path}`),
      new URL(`https://veryfront.test${path}`),
      CONTEXT,
      unavailableDependencies,
    );
    assertEquals(response?.status, 503, path);
    assertStringIncludes(await response!.text(), "@veryfront/ext-dev-ui-react");
  }

  const nested = await handleProjectsRequest(
    new Request("https://veryfront.test/_projects/ui/components/App.js"),
    new URL("https://veryfront.test/_projects/ui/components/App.js"),
    CONTEXT,
    projectsDependencies(),
  );
  assertEquals(nested?.status, 404);
});

Deno.test("runtime projects route delegates UI behavior to its injected handler", async () => {
  let calls = 0;
  const response = await handleProjectsRequest(
    new Request("https://veryfront.test/_projects"),
    new URL("https://veryfront.test/_projects"),
    CONTEXT,
    {
      projectsHandler: {
        metadata: { name: "ProjectsHandler", priority: 100 },
        handle: () => {
          calls++;
          return Promise.resolve({ response: new Response("injected") });
        },
      },
      discoveryService: {
        list: () => {
          throw new Error("discovery must not run for UI requests");
        },
      },
    },
  );

  assertEquals(calls, 1);
  assertEquals(await response?.text(), "injected");
});

Deno.test("local project discovery uses only the configured root and filesystem", async () => {
  const adapter = createMockAdapter();
  for (
    const directory of [
      "/configured/data/projects/alpha",
      "/configured/data/projects/alpha/app",
      "/configured/projects/beta",
      "/configured/projects/beta/components",
      "/ambient/projects/leak",
      "/ambient/projects/leak/pages",
    ]
  ) {
    adapter.fs.directories.add(directory);
  }

  const response = await handleProjectsRequest(
    new Request("https://veryfront.test/_vf/api/projects"),
    new URL("https://veryfront.test/_vf/api/projects"),
    CONTEXT,
    projectsDependencies(
      createLocalProjectsDiscoveryService({
        projectRoot: "/configured",
        fileSystem: adapter.fs,
        cache: new ProjectDiscoveryCache(),
      }),
    ),
  );

  assertEquals(response?.status, 200);
  assertEquals(response?.headers.get("cache-control"), "no-store");
  assertEquals(await response?.json(), {
    data: [
      { id: "alpha", name: "alpha", slug: "alpha" },
      { id: "beta", name: "beta", slug: "beta" },
    ],
  });
});

Deno.test("local project discovery fails atomically when its adapter scan fails", async () => {
  const cache = new ProjectDiscoveryCache();
  const fileSystem = createMockAdapter().fs;
  fileSystem.exists = () => Promise.resolve(true);
  fileSystem.readDir = async function* () {
    yield { name: "partial", isFile: false, isDirectory: true, isSymlink: false };
    throw new Error("sensitive adapter failure");
  };
  fileSystem.stat = () =>
    Promise.resolve({
      size: 0,
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      mtime: null,
    });

  const response = await handleProjectsRequest(
    new Request("https://veryfront.test/_vf/api/projects"),
    new URL("https://veryfront.test/_vf/api/projects"),
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
  assertEquals(response?.headers.get("content-type"), "application/problem+json; charset=utf-8");
  const body = await response?.text();
  assertStringIncludes(body ?? "", "Local project discovery unavailable");
  assertEquals(body?.includes("sensitive adapter failure"), false);
  assertEquals(Array.from(cache.projects.entries()), []);
});

Deno.test("local project discovery rejects an over-limit scan without partial results", async () => {
  const cache = new ProjectDiscoveryCache();
  const fileSystem = createMockAdapter().fs;
  fileSystem.exists = () => Promise.resolve(true);
  fileSystem.readDir = async function* () {
    for (const name of ["one", "two", "three"]) {
      yield { name, isFile: false, isDirectory: true, isSymlink: false };
    }
  };
  fileSystem.stat = () =>
    Promise.resolve({
      size: 0,
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      mtime: null,
    });

  const response = await handleProjectsRequest(
    new Request("https://veryfront.test/_vf/api/projects"),
    new URL("https://veryfront.test/_vf/api/projects"),
    CONTEXT,
    projectsDependencies(
      createLocalProjectsDiscoveryService({
        projectRoot: "/configured",
        fileSystem,
        cache,
        limits: { maxEntriesScanned: 2 },
      }),
    ),
  );

  assertEquals(response?.status, 503);
  assertEquals(Array.from(cache.projects.entries()), []);
});

Deno.test("local project discovery coalesces concurrent scans", async () => {
  const fileSystem = createMockAdapter().fs;
  fileSystem.directories.add("/configured/projects/one");
  fileSystem.directories.add("/configured/projects/one/app");
  const originalReadDir = fileSystem.readDir.bind(fileSystem);
  let readDirCalls = 0;
  let releaseScan!: () => void;
  const scanGate = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  fileSystem.readDir = async function* (path) {
    readDirCalls++;
    await scanGate;
    yield* originalReadDir(path);
  };
  const service = createLocalProjectsDiscoveryService({
    projectRoot: "/configured",
    fileSystem,
    cache: new ProjectDiscoveryCache(),
  });

  const first = service.list();
  const second = service.list();
  releaseScan();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assertEquals(readDirCalls, 1);
  assertEquals(firstResult, secondResult);
  assertEquals(firstResult.map((project) => project.slug), ["one"]);
});

Deno.test("live runtime composes project discovery from its root and adapter", async () => {
  const adapter = createMockAdapter();
  for (
    const directory of [
      "/configured/projects/owned",
      "/configured/projects/owned/app",
      "/ambient/projects/leak",
      "/ambient/projects/leak/pages",
    ]
  ) {
    adapter.fs.directories.add(directory);
  }
  const handler = createVeryfrontHandler("/configured", adapter, {
    projectDir: "/configured",
    config: {},
  });

  try {
    await handler.ready;
    const remoteRequest = new Request("http://veryfront.me/_vf/api/projects", {
      headers: { host: "veryfront.me" },
    });
    recordRequestPeerFromTransport(remoteRequest, {
      runtime: "node",
      transport: "tcp",
      hostname: "192.168.1.25",
    });
    const remoteResponse = await handler(remoteRequest);
    assertEquals(remoteResponse.status, 403);
    assertEquals(remoteResponse.headers.get("cache-control"), "no-store");
    assertEquals((await remoteResponse.text()).includes("/configured"), false);

    let cancelled = false;
    const cancellationNeverSettles = new Promise<void>(() => {});
    const remotePost = new Request("http://veryfront.me/_vf/api/projects", {
      method: "POST",
      headers: { host: "veryfront.me" },
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
          return cancellationNeverSettles;
        },
      }),
    });
    recordRequestPeerFromTransport(remotePost, {
      runtime: "deno",
      transport: "tcp",
      hostname: "203.0.113.8",
    });
    const remotePostResponse = await handler(remotePost);
    assertEquals(remotePostResponse.status, 403);
    assertEquals(remotePostResponse.headers.get("cache-control"), "no-store");
    assertEquals(cancelled, true);

    const localRequest = new Request("http://veryfront.me/_vf/api/projects", {
      headers: { host: "veryfront.me" },
    });
    recordRequestPeerFromTransport(localRequest, {
      runtime: "node",
      transport: "tcp",
      hostname: "::ffff:127.0.0.1",
    });
    const response = await handler(
      localRequest,
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(await response.json(), {
      data: [{
        id: "owned",
        name: "owned",
        slug: "owned",
      }],
    });
  } finally {
    await handler.dispose();
  }
});
