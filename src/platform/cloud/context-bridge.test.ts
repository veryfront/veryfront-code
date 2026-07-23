import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRegisteredRuntimeConfig,
  getRegisteredVeryfrontCloudContext,
  isRegisteredRuntimeConfigInitialized,
  registerRuntimeConfigProvider,
  registerVeryfrontCloudContextProvider,
} from "./context-bridge.ts";

describe("platform/cloud/context-bridge", () => {
  it("returns an immutable allowlisted cloud-context snapshot", () => {
    let tokenReads = 0;
    registerVeryfrontCloudContextProvider(() => ({
      get apiToken() {
        tokenReads++;
        return "vf_test_token";
      },
      billingGroupId: "not-exposed",
      projectSlug: "test-project",
    }));

    const snapshot = getRegisteredVeryfrontCloudContext();

    assertEquals(snapshot, {
      apiBaseUrl: undefined,
      apiToken: "vf_test_token",
      projectSlug: "test-project",
      serviceLayer: undefined,
    });
    assertEquals(tokenReads, 1);
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals("billingGroupId" in (snapshot ?? {}), false);
  });

  it("sanitizes higher-layer context failures", () => {
    registerVeryfrontCloudContextProvider(() => {
      throw new Error("PRIVATE_CONTEXT_CANARY");
    });

    let caught: unknown;
    try {
      getRegisteredVeryfrontCloudContext();
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof Error);
    assertEquals(caught.message.includes("not readable"), true);
    assertEquals(caught.message.includes("PRIVATE_CONTEXT_CANARY"), false);
  });

  it("rejects array-shaped context instead of treating it as an empty context", () => {
    registerVeryfrontCloudContextProvider(() => []);

    assertThrows(
      () => getRegisteredVeryfrontCloudContext(),
      Error,
      "must be an object",
    );
  });

  it("does not inherit credential or service-layer fields", () => {
    registerVeryfrontCloudContextProvider(() =>
      Object.create({
        apiToken: "vf_inherited_token",
        projectSlug: "inherited-project",
        serviceLayer: "cloud",
      })
    );

    assertEquals(getRegisteredVeryfrontCloudContext(), {
      apiBaseUrl: undefined,
      apiToken: undefined,
      projectSlug: undefined,
      serviceLayer: undefined,
    });
  });

  it("snapshots and freezes the runtime config fields used by the resolver", () => {
    let configReads = 0;
    registerRuntimeConfigProvider({
      getConfig() {
        configReads++;
        return {
          fs: {
            type: "veryfront-api",
            veryfront: { apiToken: "vf_runtime_token", projectSlug: "fs-project" },
          },
          projectSlug: "runtime-project",
          unrelatedSecret: "not-exposed",
        };
      },
      isInitialized: () => true,
    });

    assertEquals(isRegisteredRuntimeConfigInitialized(), true);
    const snapshot = getRegisteredRuntimeConfig();

    assertEquals(snapshot, {
      fs: {
        type: "veryfront-api",
        veryfront: { apiToken: "vf_runtime_token", projectSlug: "fs-project" },
      },
      projectSlug: "runtime-project",
    });
    assertEquals(configReads, 1);
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.fs), true);
    assertEquals(Object.isFrozen(snapshot.fs?.veryfront), true);
    assertEquals("unrelatedSecret" in snapshot, false);
  });

  it("does not inherit runtime configuration fields", () => {
    registerRuntimeConfigProvider({
      getConfig: () => Object.create({ projectSlug: "inherited-project" }),
      isInitialized: () => true,
    });

    assertEquals(getRegisteredRuntimeConfig(), { projectSlug: undefined });
  });

  it("rejects unreadable provider capabilities with a typed sanitized error", () => {
    const provider = new Proxy({}, {
      get() {
        throw new Error("PRIVATE_PROVIDER_CANARY");
      },
    });

    assertThrows(
      () => registerRuntimeConfigProvider(provider as never),
      Error,
      "provider is not readable",
    );
  });

  it("sanitizes a revoked runtime config proxy", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    registerRuntimeConfigProvider({
      getConfig: () => revoked.proxy,
      isInitialized: () => true,
    });

    assertThrows(
      () => getRegisteredRuntimeConfig(),
      Error,
      "Runtime config is not readable",
    );
  });
});
