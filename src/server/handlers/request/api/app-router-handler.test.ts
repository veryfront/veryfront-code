import "#veryfront/schemas/_test-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../../types.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { handleAppRouter } from "./app-router-handler.ts";

const ROUTE_IMPORT_CANARY = "__VERYFRONT_LEGACY_APP_ROUTE_IMPORT_CANARY__";

interface RouteProjectFixture {
  adapter: ReturnType<typeof createMockAdapter>;
  projectDir: string;
  accessCount(): number;
  cleanup(): Promise<void>;
}

async function createRouteProject(
  route: string,
  source: string,
): Promise<RouteProjectFixture> {
  const projectDir = await Deno.makeTempDir({ prefix: "veryfront-app-route-" });
  const routeDir = `${projectDir}/app/${route}`;
  await Deno.mkdir(routeDir, { recursive: true });
  await Deno.writeTextFile(`${routeDir}/route.ts`, source);

  let accesses = 0;
  const adapter = createMockAdapter();
  adapter.fs.stat = async (path) => {
    accesses++;
    return await Deno.stat(path);
  };
  adapter.fs.readDir = async function* (path) {
    accesses++;
    for await (const entry of Deno.readDir(path)) yield entry;
  };

  return {
    adapter,
    projectDir,
    accessCount: () => accesses,
    cleanup: () => Deno.remove(projectDir, { recursive: true }),
  };
}

function makeCtx(
  fixture: RouteProjectFixture,
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: fixture.projectDir,
    adapter: fixture.adapter,
    config: {},
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  } as HandlerContext;
}

afterEach(() => {
  Deno.env.delete("WORKER_ISOLATION_ENABLED");
  Deno.env.delete("WORKER_ISOLATION_API");
  __resetLogRecordEmitterForTests();
  delete (globalThis as Record<string, unknown>)[ROUTE_IMPORT_CANARY];
});

describe("server/handlers/request/api/app-router-handler", () => {
  it("rejects remote dispatch before route discovery even when worker flags are enabled", async () => {
    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_API", "1");
    const fixture = await createRouteProject(
      "api/canary",
      `globalThis.${ROUTE_IMPORT_CANARY} = true;\n` +
        `export function GET() { return new Response("unsafe"); }\n`,
    );

    try {
      const response = await handleAppRouter(
        new Request("https://runtime.example.com/api/canary"),
        "/api/canary",
        makeCtx(fixture, { isLocalProject: false }),
      );

      assertEquals(response?.status, 503);
      assertEquals(response?.headers.get("cache-control"), "no-store");
      assertEquals(response?.headers.get("x-content-type-options"), "nosniff");
      assertEquals(fixture.accessCount(), 0);
      assertEquals((globalThis as Record<string, unknown>)[ROUTE_IMPORT_CANARY], undefined);
    } finally {
      await fixture.cleanup();
    }
  });

  it("preserves explicitly local route dispatch", async () => {
    const fixture = await createRouteProject(
      "api/local",
      `globalThis.${ROUTE_IMPORT_CANARY} = true;\n` +
        `export function GET() { return new Response("local route"); }\n`,
    );

    try {
      const response = await handleAppRouter(
        new Request("http://localhost/api/local"),
        "/api/local",
        makeCtx(fixture, { isLocalProject: true }),
      );

      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "local route");
      assertEquals(fixture.accessCount() > 0, true);
      assertEquals((globalThis as Record<string, unknown>)[ROUTE_IMPORT_CANARY], true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not log route paths or raw failures", async () => {
    const secret = "PRIVATE_APP_ROUTE_FAILURE_CANARY";
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const fixture = await createRouteProject(
      "api/PRIVATE_ROUTE_PATH_CANARY",
      `export function GET() { throw new Error("${secret}"); }\n`,
    );

    try {
      const response = await handleAppRouter(
        new Request("http://localhost/api/PRIVATE_ROUTE_PATH_CANARY"),
        "/api/PRIVATE_ROUTE_PATH_CANARY",
        makeCtx(fixture, { isLocalProject: true }),
      );

      assertEquals(response, null);
      const failure = entries.find((entry) => entry.message === "Failed to handle request");
      assertEquals(failure?.context, { errorName: "Error" });
      const serialized = JSON.stringify(entries);
      assertEquals(serialized.includes(secret), false);
      assertEquals(serialized.includes("PRIVATE_ROUTE_PATH_CANARY"), false);
      assertEquals(serialized.includes(fixture.projectDir), false);
    } finally {
      await fixture.cleanup();
    }
  });
});
