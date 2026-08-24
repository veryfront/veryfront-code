import { assertStrictEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { openKv, polyfillDenoKv } from "#veryfront/platform/compat/kv/factory.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

// Installing and removing globalThis.Deno is a host mutation the unit boundary
// forbids, so the non-Deno polyfill lane is exercised here.
describe("integration/runtime/compat/kv-polyfill", () => {
  it("installs openKv only on non-Deno hosts and never clobbers a host-provided one", () => {
    const g = globalThis as { Deno?: { openKv?: unknown } };
    const originalDeno = g.Deno;
    if (isDeno) {
      polyfillDenoKv();
      assertStrictEquals(
        g.Deno,
        originalDeno,
        "the Deno lane leaves the native namespace untouched",
      );
      return;
    }

    try {
      delete g.Deno;
      polyfillDenoKv();
      const installed = (globalThis as { Deno?: { openKv?: unknown } }).Deno;
      assertStrictEquals(
        installed?.openKv,
        openKv,
        "polyfillDenoKv installs openKv on a non-Deno host",
      );

      const sentinel = () => Promise.reject(new Error("host kv"));
      installed!.openKv = sentinel;
      polyfillDenoKv();
      assertStrictEquals(installed!.openKv, sentinel, "a host-provided openKv is never clobbered");
    } finally {
      g.Deno = originalDeno;
    }
  });
});
