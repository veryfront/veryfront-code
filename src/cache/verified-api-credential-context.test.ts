import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import {
  getVerifiedCacheApiCredential,
  runWithVerifiedCacheApiCredential,
} from "./verified-api-credential-context.ts";

async function createVerifiedClaims(token?: string) {
  const rawBody = JSON.stringify(
    token ? { credentials: { authToken: token } } : {},
  );
  const { jws, publicKeyPem } = await createControlPlaneSignature(rawBody);
  const signingKeyEnv = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
  const originalSigningKey = Deno.env.get(signingKeyEnv);
  Deno.env.set(signingKeyEnv, publicKeyPem);

  try {
    return await verifyControlPlaneRequest(
      new Request("https://example.test/api/control-plane/runs/run-1/stream", {
        headers: { "x-veryfront-control-plane-jws": jws },
      }),
      createCtx(publicKeyPem),
      rawBody,
    );
  } finally {
    if (originalSigningKey === undefined) Deno.env.delete(signingKeyEnv);
    else Deno.env.set(signingKeyEnv, originalSigningKey);
  }
}

describe("verified cache API credential context", () => {
  it("keeps the credential private to its async scope", async () => {
    const verifiedClaims = await createVerifiedClaims("signed-body-token");
    const credentiallessClaims = await createVerifiedClaims();
    assertEquals(getVerifiedCacheApiCredential(), undefined);

    await runWithVerifiedCacheApiCredential(verifiedClaims, async () => {
      await Promise.resolve();
      const credential = getVerifiedCacheApiCredential();
      assertEquals(credential?.token, "signed-body-token");
      assertEquals(credential?.projectId, "proj-1");
      assertEquals(credential?.projectSlug, "demo-project");
      assertEquals(Object.isFrozen(credential), true);

      await runWithVerifiedCacheApiCredential(credentiallessClaims, async () => {
        assertEquals(getVerifiedCacheApiCredential(), undefined);
      });

      assertEquals(getVerifiedCacheApiCredential()?.token, "signed-body-token");
    });

    assertEquals(getVerifiedCacheApiCredential(), undefined);
    await runWithVerifiedCacheApiCredential(verifiedClaims, async () => {
      assertEquals(getVerifiedCacheApiCredential(), undefined);
    });
  });

  it("rejects copied claims and isolates concurrent credentials", async () => {
    const firstClaims = await createVerifiedClaims("first-token");
    const secondClaims = await createVerifiedClaims("second-token");
    const credentiallessClaims = await createVerifiedClaims();
    const copiedClaims = { ...firstClaims } as typeof firstClaims;

    await runWithVerifiedCacheApiCredential(copiedClaims, async () => {
      assertEquals(getVerifiedCacheApiCredential(), undefined);
    });

    const observed = await Promise.all([
      runWithVerifiedCacheApiCredential(firstClaims, async () => {
        await Promise.resolve();
        return getVerifiedCacheApiCredential()?.token;
      }),
      runWithVerifiedCacheApiCredential(secondClaims, async () => {
        await Promise.resolve();
        return getVerifiedCacheApiCredential()?.token;
      }),
      runWithVerifiedCacheApiCredential(credentiallessClaims, async () => {
        await Promise.resolve();
        return getVerifiedCacheApiCredential()?.token;
      }),
    ]);

    assertEquals(observed, ["first-token", "second-token", undefined]);
    assertEquals(getVerifiedCacheApiCredential(), undefined);
  });

  it("preserves the scope in delayed stream work created inside it", async () => {
    const verifiedClaims = await createVerifiedClaims("stream-token");
    let observedToken: string | undefined;

    const stream = runWithVerifiedCacheApiCredential(
      verifiedClaims,
      () =>
        new ReadableStream<void>({
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            observedToken = getVerifiedCacheApiCredential()?.token;
            controller.close();
          },
        }),
    );

    assertEquals(getVerifiedCacheApiCredential(), undefined);
    await stream.getReader().read();
    assertEquals(observedToken, "stream-token");
    assertEquals(getVerifiedCacheApiCredential(), undefined);
  });
});
