import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertMatch, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { dirname, fromFileUrl, join } from "#veryfront/compat/path";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { nodeAdapter } from "#veryfront/platform/adapters/runtime/node/adapter.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { ProjectWorker } from "#veryfront/security/sandbox/project-worker.ts";
import { buildWorkerPermissions } from "#veryfront/security/sandbox/worker-permissions.ts";
import type { PreparedWorkerModule } from "#veryfront/security/sandbox/worker-types.ts";
import { computeIntegrity } from "#veryfront/utils";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";
import { prepareHandlerModule } from "./loader.ts";

const testSuite = isDeno ? describe : describe.skip;
const SOURCE_POLICY = { schemaVersion: 1, mode: "unrestricted" } as const;
const repositoryRoot = dirname(
  dirname(dirname(dirname(dirname(fromFileUrl(import.meta.url))))),
);

interface PreparedFixture {
  projectDir: string;
  modulePath: string;
  prepared: PreparedWorkerModule;
  cleanupDir: string;
}

async function installRepositoryDependency(
  projectDir: string,
  name: string,
): Promise<string> {
  const dependencyPath = join(repositoryRoot, "node_modules", name);
  const installedPath = join(projectDir, "node_modules", name);
  await Deno.mkdir(dirname(installedPath), { recursive: true });
  await Deno.symlink(dependencyPath, installedPath, { type: "dir" });
  const pkg = JSON.parse(
    await Deno.readTextFile(join(dependencyPath, "package.json")),
  ) as { version?: string };
  if (typeof pkg.version !== "string") {
    throw new TypeError(`Test dependency ${name} has no installed version`);
  }
  return pkg.version;
}

async function prepareFixture(options: {
  source: string;
  dependencies?: Record<string, string>;
  install?: string[];
}): Promise<PreparedFixture> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-prepared-runtime-" });
  const modulePath = join(projectDir, "route.ts");
  await Deno.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify({
      name: "prepared-worker-fixture",
      private: true,
      dependencies: options.dependencies ?? {},
    }),
  );
  for (const dependency of options.install ?? []) {
    await installRepositoryDependency(projectDir, dependency);
  }
  await Deno.writeTextFile(modulePath, options.source);

  try {
    return {
      projectDir,
      modulePath,
      prepared: await prepareHandlerModule({
        projectDir,
        modulePath,
        adapter: nodeAdapter,
      }),
      cleanupDir: projectDir,
    };
  } catch (error) {
    await Deno.remove(projectDir, { recursive: true });
    throw error;
  }
}

async function executePreparedFixture(fixture: PreparedFixture): Promise<string> {
  const worker = new ProjectWorker({
    projectId: `prepared-runtime-${crypto.randomUUID()}`,
    permissions: buildWorkerPermissions([fixture.projectDir]),
    requestTimeoutMs: 30_000,
  });
  worker.start();

  try {
    assertEquals(await worker.isHealthy(30_000), true);
    const response = await worker.execute({
      type: "execute-app-route",
      id: crypto.randomUUID(),
      module: fixture.prepared,
      modulePath: fixture.modulePath,
      method: "GET",
      request: {
        url: "http://localhost/api/prepared-runtime",
        method: "GET",
        headers: [],
        body: null,
      },
      params: {},
      projectDir: fixture.projectDir,
      sourceIntegrationPolicy: SOURCE_POLICY,
    });
    if (response.type === "error") {
      throw new Error(`${response.error.name}: ${response.error.message}`);
    }
    assertEquals(response.type, "result");
    if (response.type !== "result") throw new Error("Expected worker route result");
    return new TextDecoder().decode(response.response.body ?? new Uint8Array());
  } finally {
    worker.terminate();
  }
}

async function removeFixture(fixture: PreparedFixture): Promise<void> {
  await Deno.remove(fixture.cleanupDir, { recursive: true });
}

testSuite(
  "prepared API loader real-worker compatibility",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterAll(async () => {
      const { stop } = await import("veryfront/extensions/bundler");
      await stop();
    });

    it("rejects veryfront root and subpath imports before worker creation", async () => {
      for (const specifier of ["veryfront", "veryfront/fs"]) {
        await assertRejects(
          () =>
            prepareFixture({
              source: [
                `import * as framework from ${JSON.stringify(specifier)};`,
                `export function GET() {`,
                `  return new Response(String(typeof framework));`,
                `}`,
              ].join("\n"),
            }),
          Error,
          `framework import "${specifier}" is unavailable until framework modules are snapshot-owned`,
        );
      }
    });

    it("pins and executes the zod framework external under production worker permissions", async () => {
      const version = JSON.parse(
        await Deno.readTextFile(join(repositoryRoot, "node_modules", "zod", "package.json")),
      ).version as string;
      const fixture = await prepareFixture({
        source: [
          `import { z } from "zod";`,
          `export function GET() {`,
          `  return new Response(z.literal("zod-ok").parse("zod-ok"));`,
          `}`,
        ].join("\n"),
        dependencies: { zod: `^${version}` },
        install: ["zod"],
      });

      try {
        assert(fixture.prepared.source.includes(`npm:zod@${version}`));
        assertEquals(await executePreparedFixture(fixture), "zod-ok");
      } finally {
        await removeFixture(fixture);
      }
    });

    it("pins and executes an installed user npm dependency", async () => {
      const version = JSON.parse(
        await Deno.readTextFile(join(repositoryRoot, "node_modules", "semver", "package.json")),
      ).version as string;
      const fixture = await prepareFixture({
        source: [
          `import semver from "semver";`,
          `export function GET() {`,
          `  return new Response(String(semver.major("7.7.2")));`,
          `}`,
        ].join("\n"),
        dependencies: { semver: "^7.0.0" },
        install: ["semver"],
      });

      try {
        assert(fixture.prepared.source.includes(`npm:semver@${version}`));
        assertEquals(await executePreparedFixture(fixture), "7");
      } finally {
        await removeFixture(fixture);
      }
    });

    it("executes a rewritten node builtin without broadening worker permissions", async () => {
      const fixture = await prepareFixture({
        source: [
          `import { basename } from "path";`,
          `export function GET() {`,
          `  return new Response(basename("/prepared/node-ok.txt"));`,
          `}`,
        ].join("\n"),
      });

      try {
        assert(fixture.prepared.source.includes('from "node:path"'));
        assertEquals(await executePreparedFixture(fixture), "node-ok.txt");
      } finally {
        await removeFixture(fixture);
      }
    });

    it("bundles a pinned allow-listed HTTP import and executes without worker network resolution", async () => {
      const originalFetch = globalThis.fetch;
      const requestUrl = "https://esm.sh/vf-prepared-fixture@1.0.0";
      const remoteSource = `export const marker = "http-ok";`;
      let fixture: PreparedFixture | undefined;

      try {
        globalThis.fetch = (async () =>
          new Response(remoteSource, {
            status: 200,
            headers: { "content-type": "application/javascript" },
          })) as typeof fetch;
        fixture = await prepareFixture({
          source: [
            `import { marker } from ${JSON.stringify(requestUrl)};`,
            `export function GET() { return new Response(marker); }`,
          ].join("\n"),
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      if (!fixture) throw new Error("HTTP fixture was not prepared");

      try {
        const preparedImports = (await parseImports(fixture.prepared.source))
          .map((specifier) => specifier.n)
          .filter((specifier): specifier is string => typeof specifier === "string");
        assertEquals(
          preparedImports.some((specifier) =>
            specifier.startsWith("http://") || specifier.startsWith("https://")
          ),
          false,
        );
        const lockfile = JSON.parse(
          await Deno.readTextFile(join(fixture.projectDir, "veryfront.lock")),
        ) as {
          imports: Record<string, { resolved: string; integrity: string }>;
        };
        assertEquals(lockfile.imports[requestUrl]?.integrity, await computeIntegrity(remoteSource));
        assertMatch(lockfile.imports[requestUrl]?.resolved ?? "", /^https:\/\/esm\.sh\//);
        assertEquals(await executePreparedFixture(fixture), "http-ok");
      } finally {
        await removeFixture(fixture);
      }
    });

    it("rejects a changed HTTP module against its preparation lock", async () => {
      const originalFetch = globalThis.fetch;
      const requestUrl = "https://esm.sh/vf-prepared-strict@1.0.0";
      const projectDir = await Deno.makeTempDir({ prefix: "vf-prepared-http-strict-" });
      const modulePath = join(projectDir, "route.ts");
      const routeSource = [
        `import { marker } from ${JSON.stringify(requestUrl)};`,
        `export function GET() { return new Response(marker); }`,
      ].join("\n");
      await Deno.writeTextFile(
        join(projectDir, "package.json"),
        JSON.stringify({ name: "strict-http-fixture", private: true }),
      );
      await Deno.writeTextFile(modulePath, routeSource);

      try {
        globalThis.fetch = (async () =>
          new Response(`export const marker = "first";`, {
            status: 200,
          })) as typeof fetch;
        await prepareHandlerModule({ projectDir, modulePath, adapter: nodeAdapter });

        globalThis.fetch = (async () =>
          new Response(`export const marker = "changed";`, {
            status: 200,
          })) as typeof fetch;
        await assertRejects(
          () => prepareHandlerModule({ projectDir, modulePath, adapter: nodeAdapter }),
          Error,
          "Integrity mismatch",
        );
      } finally {
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects an uninstalled external dependency during preparation", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-prepared-missing-dep-" });
      const modulePath = join(projectDir, "route.ts");
      await Deno.writeTextFile(
        join(projectDir, "package.json"),
        JSON.stringify({
          name: "missing-dependency-fixture",
          dependencies: { "vf-missing-package": "^1.0.0" },
        }),
      );
      await Deno.writeTextFile(
        modulePath,
        [
          `import value from "vf-missing-package";`,
          `export function GET() { return new Response(String(value)); }`,
        ].join("\n"),
      );

      try {
        await assertRejects(
          () => prepareHandlerModule({ projectDir, modulePath, adapter: nodeAdapter }),
          Error,
          'dependency "vf-missing-package" must be installed',
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("rejects virtual filesystems before any read, write, build, or dependency lookup", async () => {
      let filesystemOperations = 0;
      const fail = (): never => {
        filesystemOperations++;
        throw new Error("virtual filesystem operation must not run");
      };
      const virtualFs = Object.assign(Object.create(nodeAdapter.fs), {
        getUnderlyingAdapter: fail,
        getAdapterType: () => "VeryfrontFSAdapter",
        isVeryfrontAdapter: () => true,
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        readFile: () => Promise.reject(fail()),
        writeFile: () => Promise.reject(fail()),
        exists: () => Promise.reject(fail()),
        readDir: () => fail(),
        stat: () => Promise.reject(fail()),
        mkdir: () => Promise.reject(fail()),
        remove: () => Promise.reject(fail()),
        makeTempDir: () => Promise.reject(fail()),
        watch: () => fail(),
      }) as FileSystemAdapter;
      const virtualAdapter = {
        ...nodeAdapter,
        fs: virtualFs,
      } as RuntimeAdapter;

      await assertRejects(
        () =>
          prepareHandlerModule({
            projectDir: "/virtual/project",
            modulePath: "/virtual/project/route.ts",
            adapter: virtualAdapter,
          }),
        Error,
        "cannot prepare remote virtual-filesystem sources",
      );
      assertEquals(filesystemOperations, 0);
    });
  },
);
