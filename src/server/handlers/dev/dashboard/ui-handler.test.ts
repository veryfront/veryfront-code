import "#veryfront/schemas/_test-setup.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __getDashboardUICacheSizeForTests,
  __injectDashboardUIDepsForTests,
  __resetDashboardUICacheForTests,
  handleDashboardUI,
} from "./ui-handler.ts";

function injectContainedFilesystem(
  transform: (filePath: string, source: string, relativePath: string) => Promise<string> = (
    filePath,
  ) => Promise.resolve(`export default ${JSON.stringify(filePath)};`),
): void {
  __injectDashboardUIDepsForTests({
    getUiDirectory: () => "/safe/ui",
    readTextFile: () => Promise.resolve("export default true;"),
    realPath: (path) => Promise.resolve(path.replace("/safe/ui", "/canonical/ui")),
    stat: () => Promise.resolve({ isFile: true, size: 20 }),
    transformUiModule: transform,
  });
}

afterEach(() => {
  __injectDashboardUIDepsForTests(null);
  __resetDashboardUICacheForTests();
});

describe("handleDashboardUI", () => {
  it("rejects encoded traversal before reading the filesystem", async () => {
    let reads = 0;
    __injectDashboardUIDepsForTests({
      getUiDirectory: () => "/safe/ui",
      readTextFile: () => {
        reads++;
        return Promise.resolve("secret");
      },
    });

    const response = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/..%2fsecret.js"),
    );

    assertEquals(response?.status, 400);
    assertEquals(reads, 0);
  });

  it("allows only GET", async () => {
    const response = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/index.js", { method: "POST" }),
    );

    assertEquals(response?.status, 405);
    assertEquals(response?.headers.get("allow"), "GET");
  });

  it("rejects a filesystem module whose canonical path escapes the UI directory", async () => {
    let reads = 0;
    __injectDashboardUIDepsForTests({
      getUiDirectory: () => "/safe/ui",
      realPath: (path) =>
        Promise.resolve(path === "/safe/ui" ? "/canonical/ui" : "/private/secret.tsx"),
      readTextFile: () => {
        reads++;
        return Promise.resolve("secret");
      },
    });

    const response = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/components/Card.js"),
    );

    assertEquals(response?.status, 400);
    assertEquals(reads, 0);
  });

  it("distinguishes unavailable source metadata from a missing source tree", async () => {
    __injectDashboardUIDepsForTests({
      getUiDirectory: () => "/safe/ui",
      realPath: (path) => {
        if (path === "/safe/ui") return Promise.resolve("/canonical/ui");
        return Promise.reject(new Deno.errors.PermissionDenied("denied at /private/source"));
      },
    });

    const unavailable = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/index.js"),
    );

    __injectDashboardUIDepsForTests({
      getUiDirectory: () => "/missing/ui",
      realPath: () => Promise.reject(FILE_NOT_FOUND.create({ message: "missing" })),
      transformUiModule: (_filePath, _source, relativePath) =>
        Promise.resolve(`export default ${JSON.stringify(relativePath)};`),
    });
    const manifestFallback = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/index.js"),
    );

    assertEquals(unavailable?.status, 500);
    assertEquals(await unavailable?.text(), "// Dashboard module unavailable");
    assertEquals(manifestFallback?.status, 200);
  });

  it("rejects oversized source before transforming or caching it", async () => {
    let transforms = 0;
    __injectDashboardUIDepsForTests({
      getUiDirectory: () => "/safe/ui",
      readTextFile: () => Promise.resolve("x".repeat(1_048_577)),
      realPath: (path) => Promise.resolve(path.replace("/safe/ui", "/canonical/ui")),
      stat: () => Promise.resolve({ isFile: true, size: 1 }),
      transformUiModule: () => {
        transforms++;
        return Promise.resolve("export default true;");
      },
    });

    const response = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/index.js"),
    );

    assertEquals(response?.status, 500);
    assertEquals(transforms, 0);
    assertEquals(__getDashboardUICacheSizeForTests(), 0);
  });

  it("passes only a logical module path to the transformer and trace", async () => {
    let transformPath = "";
    injectContainedFilesystem((filePath) => {
      transformPath = filePath;
      return Promise.resolve("export default true;");
    });

    const response = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/index.js"),
    );

    assertEquals(response?.status, 200);
    assertEquals(transformPath, "dashboard/index.tsx");
    assertEquals(transformPath.includes("/safe/"), false);
    assertEquals(response?.headers.get("cache-control"), "no-store");
    assertEquals(response?.headers.get("x-content-type-options"), "nosniff");
  });

  it("does not expose transform errors or filesystem paths", async () => {
    injectContainedFilesystem(() => {
      throw new Error("transform failed at /private/workspace/dashboard/index.tsx");
    });

    const response = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/index.js"),
    );
    const body = await response?.text();

    assertEquals(response?.status, 500);
    assertEquals(body, "// Dashboard module transform failed");
  });

  it("bounds transformed modules retained in memory", async () => {
    injectContainedFilesystem();

    for (let index = 0; index < 160; index++) {
      const response = await handleDashboardUI(
        new Request(`http://localhost/_dev/ui/module-${index}.js`),
      );
      assertEquals(response?.status, 200);
    }

    assertEquals(__getDashboardUICacheSizeForTests(), 128);
  });

  it("rejects oversized transform output without caching it", async () => {
    injectContainedFilesystem(() => Promise.resolve("x".repeat(2_097_153)));

    const response = await handleDashboardUI(
      new Request("http://localhost/_dev/ui/index.js"),
    );

    assertEquals(response?.status, 500);
    assertEquals(__getDashboardUICacheSizeForTests(), 0);
  });
});
