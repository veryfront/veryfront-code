import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { anchorCacheDirToProject } from "./command.ts";

function recordingEnv(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    values,
    read: (key: string) => values[key],
    write: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

describe("veryfront dev cache directory anchor", () => {
  it("points the framework cache root at the project being served", () => {
    const env = recordingEnv();

    const anchored = anchorCacheDirToProject("/projects/site", env.read, env.write);

    assertEquals(anchored, true);
    assertEquals(env.values["VERYFRONT_CACHE_DIR"], join("/projects/site", ".cache"));
  });

  it("keeps an explicitly configured cache directory", () => {
    const env = recordingEnv({ VERYFRONT_CACHE_DIR: "/elsewhere/cache" });

    const anchored = anchorCacheDirToProject("/projects/site", env.read, env.write);

    assertEquals(anchored, false);
    assertEquals(env.values["VERYFRONT_CACHE_DIR"], "/elsewhere/cache");
  });

  it("keeps the legacy cache directory variable", () => {
    const env = recordingEnv({ VF_CACHE_DIR: "/elsewhere/cache" });

    const anchored = anchorCacheDirToProject("/projects/site", env.read, env.write);

    assertEquals(anchored, false);
    assertEquals(env.values["VERYFRONT_CACHE_DIR"], undefined);
  });
});
