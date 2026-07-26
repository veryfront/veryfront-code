import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  StudioBridgeBundleLoader,
  type StudioBridgeLoaderDependencies,
} from "./studio-bridge-bundle.ts";

function dependencies(
  overrides: Partial<StudioBridgeLoaderDependencies> = {},
): StudioBridgeLoaderDependencies {
  return {
    prebuiltBundle: "prebuilt bridge",
    isCompiled: () => false,
    sourceAvailable: () => Promise.resolve(true),
    readCoordinator: () => Promise.resolve("source bridge"),
    buildSource: (source) => Promise.resolve(`built:${source}`),
    computeEtag: (source) => Promise.resolve(`etag:${source}`),
    ...overrides,
  };
}

describe("StudioBridgeBundleLoader", () => {
  it("coalesces concurrent source builds without caching later source requests", async () => {
    const started = Promise.withResolvers<void>();
    const build = Promise.withResolvers<string>();
    let reads = 0;
    let builds = 0;
    const loader = new StudioBridgeBundleLoader(
      dependencies({
        readCoordinator: () => {
          reads++;
          return Promise.resolve("source bridge");
        },
        buildSource: (source) => {
          builds++;
          started.resolve();
          return builds === 1 ? build.promise : Promise.resolve(`built:${source}`);
        },
      }),
    );

    const first = loader.load(true);
    const second = loader.load(true);
    await started.promise;
    assertEquals(reads, 1);
    assertEquals(builds, 1);
    build.resolve("built bridge");
    assertEquals(await Promise.all([first, second]), [
      { js: "built bridge", etag: "etag:built bridge" },
      { js: "built bridge", etag: "etag:built bridge" },
    ]);

    assertEquals(await loader.load(true), {
      js: "built:source bridge",
      etag: "etag:built:source bridge",
    });
    assertEquals(reads, 2);
    assertEquals(builds, 2);
  });

  it("computes and caches the immutable prebuilt bundle once", async () => {
    let hashes = 0;
    const loader = new StudioBridgeBundleLoader(
      dependencies({
        isCompiled: () => true,
        sourceAvailable: () => Promise.reject(new Error("must not inspect source")),
        computeEtag: () => {
          hashes++;
          return Promise.resolve("prebuilt-etag");
        },
      }),
    );

    const expected = { js: "prebuilt bridge", etag: "prebuilt-etag" };
    assertEquals(await Promise.all([loader.load(true), loader.load(false)]), [expected, expected]);
    assertEquals(await loader.load(true), expected);
    assertEquals(hashes, 1);
  });

  it("clears failed source work so a later request can retry", async () => {
    let builds = 0;
    const loader = new StudioBridgeBundleLoader(
      dependencies({
        buildSource: () => {
          builds++;
          return builds === 1
            ? Promise.reject(new Error("temporary build failure"))
            : Promise.resolve("recovered bridge");
        },
      }),
    );

    await assertRejects(() => loader.load(true), Error, "temporary build failure");
    assertEquals(await loader.load(true), {
      js: "recovered bridge",
      etag: "etag:recovered bridge",
    });
    assertEquals(builds, 2);
  });
});
