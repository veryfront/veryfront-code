import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { DevServer, initializeDevCaches } from "./server.ts";

describe("initializeDevCaches", () => {
  it("initializes the selected cache backend exactly once", async () => {
    let calls = 0;
    await initializeDevCaches(() => {
      calls += 1;
      return Promise.resolve();
    });
    assertEquals(calls, 1);
  });

  it("propagates configured cache initialization failures", async () => {
    await assertRejects(
      () => initializeDevCaches(() => Promise.reject(new Error("configured cache unavailable"))),
      Error,
      "configured cache unavailable",
    );
  });
});

function createHandlerOnlyServer(projectDir: string): DevServer {
  return new DevServer({
    projectDir,
    port: 30_333,
    enableHMR: false,
    enableFastRefresh: false,
    handlerOnly: true,
  });
}

function createHMRHandlerOnlyServer(projectDir: string, port: number): DevServer {
  return new DevServer({
    projectDir,
    port,
    enableHMR: true,
    enableFastRefresh: true,
    handlerOnly: true,
  });
}

describe("DevServer lifecycle", { sanitizeOps: false, sanitizeResources: false }, () => {
  it("invalidates request-scoped caches during shutdown", async () => {
    const server = createHandlerOnlyServer("fixtures/dev-server-shutdown");
    let invalidations = 0;
    (server as unknown as {
      requestHandler: { invalidateRuntimeHandler(): Promise<void> };
    }).requestHandler = {
      invalidateRuntimeHandler() {
        invalidations++;
        return Promise.resolve();
      },
    };

    await server.stop();

    assertEquals(invalidations, 1);
  });

  it("stops once when cleanup is concurrent or repeated", async () => {
    await withTempDir(async (projectDir) => {
      const server = createHandlerOnlyServer(projectDir);
      await server.start();

      await Promise.all([server.stop(), server.stop()]);
      await server.stop();

      assertThrows(() => server.handler, Error, "DevServer not started");
    }, { prefix: "vf-dev-server-lifecycle-" });
  });

  it("cleans up bootstrap resources after configured discovery fails", async () => {
    await withTempDir(async (projectDir) => {
      await writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `export default { ai: { tools: { discovery: { paths: ["tools"] } } } };`,
      );
      await mkdir(`${projectDir}/tools`, { recursive: true });
      await writeTextFile(`${projectDir}/tools/broken.ts`, "export const broken = ;");

      const server = createHandlerOnlyServer(projectDir);
      await assertRejects(() => server.start(), Error, "Primitive discovery failed");
      await server.stop();
      assertThrows(() => server.handler, Error, "DevServer not started");
    }, { prefix: "vf-dev-server-discovery-failure-" });
  });

  it("keeps a second HMR server operational when the first server stops", async () => {
    await withTempDir(async (firstProjectDir) => {
      await withTempDir(async (secondProjectDir) => {
        const first = createHMRHandlerOnlyServer(firstProjectDir, 30_334);
        const second = createHMRHandlerOnlyServer(secondProjectDir, 30_335);
        try {
          await first.start();
          await second.start();

          await first.stop();

          const response = await second.handler(new Request("http://localhost/_ws"));
          assertThrows(() => first.handler, Error, "DevServer not started");
          if (!(response instanceof Response) || response.status !== 200) {
            throw new Error("The remaining HMR server did not handle the status request");
          }
        } finally {
          await Promise.allSettled([first.stop(), second.stop()]);
        }
      }, { prefix: "vf-dev-server-hmr-second-" });
    }, { prefix: "vf-dev-server-hmr-first-" });
  });
});
