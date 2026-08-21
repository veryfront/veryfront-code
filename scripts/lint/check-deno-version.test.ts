import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  denoVersionMismatchMessage,
  readActionDenoVersions,
  readPinnedDenoVersion,
} from "./check-deno-version.ts";

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
    assertEquals(
      inAction.length,
      3,
      "expected one install version and two cache-key versions; a lower count means\n" +
        "the pattern stopped matching and drift would go undetected",
    );
  });
});

describe("running Deno version guard", () => {
  it("says nothing when the running Deno is the pinned one", () => {
    assertEquals(denoVersionMismatchMessage("2.7.7", "2.7.7"), null);
  });

  it("names both versions and every supported way to switch", () => {
    const message = denoVersionMismatchMessage("2.7.12", "2.7.7");

    assertEquals(typeof message, "string");
    assertEquals(message!.includes("2.7.12"), true);
    assertEquals(message!.includes("2.7.7"), true);
    // Recovery has to work off the pinned version for every toolchain, not just
    // the one the author happened to use.
    assertEquals(message!.includes("mise install"), true);
    assertEquals(message!.includes("asdf install"), true);
    assertEquals(message!.includes("deno upgrade 2.7.7"), true);
    // No hand-rolled archive URL: those bake in an OS and architecture.
    assertEquals(message!.includes("apple-darwin"), false);
    assertEquals(message!.includes("linux-gnu"), false);
  });
});
