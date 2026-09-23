import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveCacheRequestAuthority } from "#veryfront/cache/request-authority.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  getRuntimeRequestContext,
  runWithRuntimeRequestContext,
} from "#veryfront/platform/runtime-request-context.ts";

describe("platform/runtime-request-context", () => {
  it("does not expose execution credentials to a replaced Object.freeze", () => {
    const original = Object.freeze;
    let intercepted = false;
    Object.freeze = ((value: unknown) => {
      intercepted = true;
      return value;
    }) as typeof Object.freeze;
    try {
      runWithRuntimeRequestContext({
        projectSlug: "consumer",
        token: "consumer-token",
        productionMode: false,
      }, () => {
        assertEquals(getRuntimeRequestContext()?.projectSlug, "consumer");
      });
    } finally {
      Object.freeze = original;
    }
    assertEquals(intercepted, false);
  });

  it("separates concurrent consuming identities from the shared file source", async () => {
    await runWithRequestContext({
      projectSlug: "source-project",
      token: "release-read-token",
      productionMode: true,
      releaseId: "release-1",
    }, async () => {
      await Promise.all(
        ["consumer-a", "consumer-c"].map((projectSlug) =>
          runWithRuntimeRequestContext({
            projectSlug,
            token: `${projectSlug}-token`,
            productionMode: false,
          }, async () => {
            await Promise.resolve();
            assertEquals(getRuntimeRequestContext()?.projectSlug, projectSlug);
            assertEquals(getRuntimeRequestContext()?.token, `${projectSlug}-token`);
            assertEquals(resolveCacheRequestAuthority().projectRef, projectSlug);
            assertEquals(resolveCacheRequestAuthority().token, `${projectSlug}-token`);
            assertEquals(getRuntimeRequestContext()?.releaseId, undefined);
            assertEquals(getCurrentRequestContext()?.projectSlug, "source-project");
            assertEquals(getCurrentRequestContext()?.releaseId, "release-1");
          })
        ),
      );
      assertEquals(getRuntimeRequestContext(), getCurrentRequestContext());
    });
    assertEquals(getRuntimeRequestContext(), null);
  });
});
