import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRscActionAuthorizationProvider,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES,
  RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS,
  RSC_ACTION_AUTHORIZATION_TIMEOUT_MS,
  RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS,
  RscActionAuthorizationProviderName,
  snapshotRscActionAuthorizationProvider,
} from "./rsc-action-authorization-provider.ts";

function authorizationRequest() {
  return Object.freeze({
    url: "https://example.test/_veryfront/rsc/action",
    method: "POST",
    headers: Object.freeze({}),
    signal: new AbortController().signal,
  });
}

describe("extensions/auth/rsc-action-authorization-provider", () => {
  it("publishes a stable extension contract name", () => {
    assertEquals(
      RscActionAuthorizationProviderName,
      "RscActionAuthorizationProvider",
    );
  });

  it("publishes the exact authorization deadline and argument limits", () => {
    assertEquals(RSC_ACTION_AUTHORIZATION_TIMEOUT_MS, 30_000);
    assertEquals(RSC_ACTION_AUTHORIZATION_TERMINATION_GRACE_MS, 1_000);
    assertEquals(RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS, 50);
    assertEquals(RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH, 64);
    assertEquals(RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES, 50_000);
    assertEquals(RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES, 100_000);
    assertEquals(RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH, 50_000);
  });

  it("captures one immutable authorize function", async () => {
    let originalCalls = 0;
    let replacementCalls = 0;
    const registration = {
      authorize: () => {
        originalCalls++;
        return true;
      },
    };
    const provider = snapshotRscActionAuthorizationProvider(registration);
    registration.authorize = () => {
      replacementCalls++;
      return false;
    };

    assertEquals(
      await provider.authorize(
        authorizationRequest(),
        Object.freeze({ id: "save", args: Object.freeze([]) }),
      ),
      true,
    );
    assertEquals(originalCalls, 1);
    assertEquals(replacementCalls, 0);
    assertEquals(Object.isFrozen(provider), true);
  });

  it("uses its captured invocation intrinsic after shared-realm poisoning", () => {
    const provider = snapshotRscActionAuthorizationProvider({
      authorize: () => false,
    });
    const request = authorizationRequest();
    const context = Object.freeze({ id: "save", args: Object.freeze([]) });
    const originalApply = Reflect.apply;
    let decision: boolean | Promise<boolean> | undefined;
    try {
      Reflect.apply = () => true;
      decision = provider.authorize(request, context);
    } finally {
      Reflect.apply = originalApply;
    }

    assertEquals(decision, false);
  });

  it("rejects accessor-backed providers without invoking the accessor", () => {
    let getterCalls = 0;
    const registration = {};
    Object.defineProperty(registration, "authorize", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => true;
      },
    });

    assertThrows(
      () => snapshotRscActionAuthorizationProvider(registration),
      TypeError,
      "authorize data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("ignores an inherited descriptor value instead of admitting an accessor", () => {
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let getterCalls = 0;
    const registration = {};
    Object.defineProperty(registration, "authorize", {
      enumerable: true,
      get() {
        getterCalls++;
        return () => false;
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: () => true,
    });
    try {
      assertThrows(
        () => snapshotRscActionAuthorizationProvider(registration),
        TypeError,
        "authorize data property",
      );
    } finally {
      if (originalValue === undefined) {
        Reflect.deleteProperty(Object.prototype, "value");
      } else {
        Object.defineProperty(Object.prototype, "value", originalValue);
      }
    }
    assertEquals(getterCalls, 0);
  });

  it("rejects Proxy registrations without invoking traps", () => {
    let descriptorTraps = 0;
    const registration = new Proxy(
      { authorize: () => true },
      {
        getOwnPropertyDescriptor() {
          descriptorTraps++;
          throw new Error("descriptor trap");
        },
      },
    );

    assertThrows(
      () => snapshotRscActionAuthorizationProvider(registration),
      TypeError,
      "must not be a Proxy",
    );
    assertEquals(descriptorTraps, 0);
  });

  it("rejects a Proxy authorize function", () => {
    const { proxy } = Proxy.revocable(() => true, {});
    assertThrows(
      () => snapshotRscActionAuthorizationProvider({ authorize: proxy }),
      TypeError,
      "non-Proxy function",
      "a revocable proxy authorizer must be rejected at capture",
    );

    let applyCalls = 0;
    assertThrows(
      () =>
        snapshotRscActionAuthorizationProvider({
          authorize: new Proxy(() => true, {
            apply() {
              applyCalls++;
              return true;
            },
          }),
        }),
      TypeError,
      "non-Proxy function",
      "an apply-trap proxy authorizer must be rejected at capture",
    );
    assertEquals(applyCalls, 0, "capture must not invoke an extension-owned apply trap");
  });

  it("rejects extra registration fields instead of retaining mutable policy", () => {
    assertThrows(
      () =>
        snapshotRscActionAuthorizationProvider({
          authorize: () => true,
          fallback: "allow",
        }),
      TypeError,
      "exactly one",
    );
  });

  it("creates the same admitted snapshot from a standalone function", async () => {
    const provider = createRscActionAuthorizationProvider(
      (_request, context) => context.id === "allowed",
    );

    assertEquals(
      await provider.authorize(
        authorizationRequest(),
        Object.freeze({ id: "allowed", args: Object.freeze([]) }),
      ),
      true,
    );
  });
});
