import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { HandlerContext } from "#veryfront/types";
import { runWithProjectEnv } from "../server/project-env/storage.ts";
import { getControlPlaneVerificationPublicKey } from "./control-plane-auth.ts";

function createCtx(envGet: (key: string) => string | undefined): HandlerContext {
  return {
    adapter: {
      env: {
        get: envGet,
        set: () => {},
        toObject: () => ({}),
      },
      fs: {},
    },
  } as unknown as HandlerContext;
}

describe("internal-agents/control-plane-auth", () => {
  it("prefers adapter-provided verification keys", () => {
    const ctx = createCtx((key) =>
      key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY" ? "adapter-key" : undefined
    );

    assertEquals(getControlPlaneVerificationPublicKey(ctx), "adapter-key");
  });

  it("falls back to host env when project overlays hide adapter env reads", () => {
    const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
    const originalValue = Deno.env.get(envKey);
    Deno.env.set(envKey, "host-key");

    try {
      const ctx = createCtx((key) => getEnv(key));
      const resolvedKey = runWithProjectEnv({}, () => getControlPlaneVerificationPublicKey(ctx));
      assertEquals(resolvedKey, "host-key");
    } finally {
      if (originalValue === undefined) {
        Deno.env.delete(envKey);
      } else {
        Deno.env.set(envKey, originalValue);
      }
    }
  });
});
