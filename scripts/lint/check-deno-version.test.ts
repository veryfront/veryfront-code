import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readActionDenoVersions, readPinnedDenoVersion } from "./check-deno-version.ts";

describe("pinned Deno version", () => {
  it("is the only version the CI setup action installs or caches", async () => {
    const pinned = await readPinnedDenoVersion();
    const inAction = await readActionDenoVersions();

    // The action names the version in its install step and twice more in cache
    // keys. If any drifts from .tool-versions, contributors and CI silently
    // generate different files from identical sources.
    assertEquals(
      inAction.filter((version) => version !== pinned),
      [],
      `.tool-versions pins deno ${pinned}; the setup action must not name another version.`,
    );
    assertEquals(inAction.length > 0, true, "the setup action should name the pinned version");
  });
});
