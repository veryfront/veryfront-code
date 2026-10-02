import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import {
  clearReactVersionCache,
  readProjectDependencyVersions,
} from "#veryfront/transforms/esm/package-registry.ts";

describe("mock dependency capture consistency", () => {
  let previousFlag: string | undefined;
  beforeEach(() => {
    previousFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    clearReactVersionCache();
  });
  afterEach(() => {
    if (previousFlag === undefined) deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
    else setEnv(DEPENDENCY_PINNING_ENV_FLAG, previousFlag);
    clearReactVersionCache();
  });

  for (const mutates of [false, true]) {
    it(
      mutates
        ? "rejects package.json that changes during every capture attempt"
        : "captures unchanged package.json while the clock advances during reads",
      async () => {
        using time = new FakeTime(1_000);
        const adapter = createMockAdapter();
        const path = "/mock-capture/package.json";
        const packageJson = (version: string) =>
          JSON.stringify({ dependencies: { react: version } });
        adapter.fs.files.set(path, packageJson("19.2.4"));
        let reads = 0;
        const result = await readProjectDependencyVersions({
          projectDir: "/mock-capture",
          cacheNamespace: `mock-capture-${mutates}`,
          fs: {
            stat: adapter.fs.stat,
            readFile: async (file) => {
              const content = await adapter.fs.readFile(file);
              reads++;
              time.tick(100);
              if (mutates) {
                await adapter.fs.writeFile(file, packageJson(`19.2.${reads + 4}`));
              }
              return content;
            },
          },
        });
        assertEquals(result.dependencies?.react, mutates ? undefined : "19.2.4");
        assertEquals(result.dependencyState, mutates ? "unknown" : "verified");
        assertEquals(reads, mutates ? 3 : 1);
      },
    );
  }
});
