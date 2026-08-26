import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun } from "#veryfront/platform/compat/runtime.ts";
import { isSharedProjectRuntime, requiresIsolatedProjectRuntime } from "./project-locality.ts";

describe("security/project-locality shared runtime topology", () => {
  it("recognizes hosted-config and multi-project runtime boundaries", () => {
    assertEquals(
      isSharedProjectRuntime({ prepareHostedConfigContext: () => undefined }),
      true,
    );
    assertEquals(
      isSharedProjectRuntime({
        adapter: { fs: { isMultiProjectMode: () => true } },
      }),
      true,
    );
    assertEquals(
      isSharedProjectRuntime({
        adapter: { fs: { isMultiProjectMode: () => false } },
      }),
      false,
    );
  });

  it("recognizes production-style prototype methods", () => {
    class MultiProjectFs {
      isMultiProjectMode(): boolean {
        return true;
      }
    }
    class SingleProjectFs {
      isMultiProjectMode(): boolean {
        return false;
      }
    }

    assertEquals(
      isSharedProjectRuntime({ adapter: { fs: new MultiProjectFs() } }),
      true,
    );
    assertEquals(
      isSharedProjectRuntime({ adapter: { fs: new SingleProjectFs() } }),
      false,
    );
  });

  it("fails closed when a declared topology signal throws", () => {
    assertEquals(
      isSharedProjectRuntime({
        adapter: {
          fs: {
            isMultiProjectMode: () => {
              throw new Error("topology unavailable");
            },
          },
        },
      }),
      true,
    );
  });

  it("fails closed for accessor-backed, malformed, and ambiguous signals", () => {
    const accessorBacked = Object.create(null);
    Object.defineProperty(accessorBacked, "isMultiProjectMode", {
      get: () => () => false,
    });

    assertEquals(
      isSharedProjectRuntime({ adapter: { fs: accessorBacked } }),
      true,
    );
    assertEquals(
      isSharedProjectRuntime({ adapter: { fs: { isMultiProjectMode: true } } }),
      true,
    );
    assertEquals(
      isSharedProjectRuntime({
        adapter: { fs: { isMultiProjectMode: () => undefined } },
      }),
      true,
    );
  });
});

describe("security/project-locality isolated runtime requirement", () => {
  const sharedRuntime = { adapter: { fs: { isMultiProjectMode: () => true } } };
  const dedicatedRuntime = { adapter: { fs: { isMultiProjectMode: () => false } } };

  it("denies execution in a shared runtime without an explicit capability", () => {
    assertEquals(
      requiresIsolatedProjectRuntime(sharedRuntime),
      true,
      "a shared runtime must fail closed by default",
    );
  });

  it("allows execution once the host-owned entrypoint grants the capability", () => {
    assertEquals(
      requiresIsolatedProjectRuntime({ ...sharedRuntime, allowHostProjectCodeExecution: true }),
      isBun,
      isBun
        ? "Bun.env cannot be scoped, so a shared Bun host must remain isolated"
        : "an operator-granted shared executor may run project code",
    );
  });

  it("preserves the local-development grant", () => {
    assertEquals(
      requiresIsolatedProjectRuntime({ ...sharedRuntime, isLocalProject: true }),
      false,
      "explicitly local projects retain their historical capability",
    );
  });

  it("allows a dedicated single-project runtime with no capability set", () => {
    assertEquals(
      requiresIsolatedProjectRuntime(dedicatedRuntime),
      false,
      "a non-shared runtime was never denied",
    );
  });

  it("fails closed when the topology signal is ambiguous", () => {
    assertEquals(
      requiresIsolatedProjectRuntime({
        adapter: {
          fs: {
            isMultiProjectMode: () => {
              throw new Error("broken topology");
            },
          },
        },
      }),
      true,
      "a broken topology signal must never unlock shared host execution",
    );
    assertEquals(
      requiresIsolatedProjectRuntime({ prepareHostedConfigContext: () => undefined }),
      true,
      "a hosted-config preparation boundary marks a shared runtime",
    );
  });

  it("rejects capabilities that are not own boolean data properties", () => {
    // Defined on the object itself: spreading an accessor would invoke the
    // getter and silently produce the data property this test must reject.
    const accessorBacked = { ...sharedRuntime };
    Object.defineProperty(accessorBacked, "allowHostProjectCodeExecution", {
      get: () => true,
    });
    assertEquals(
      requiresIsolatedProjectRuntime(accessorBacked),
      true,
      "an accessor-backed capability must not grant execution",
    );

    const inherited = Object.create({ allowHostProjectCodeExecution: true });
    Object.assign(inherited, sharedRuntime);
    assertEquals(
      requiresIsolatedProjectRuntime(inherited),
      true,
      "an inherited capability must not grant execution",
    );

    for (const truthy of ["true", 1, {}]) {
      assertEquals(
        requiresIsolatedProjectRuntime({
          ...sharedRuntime,
          allowHostProjectCodeExecution: truthy,
        }),
        true,
        `a non-boolean capability (${JSON.stringify(truthy)}) must not grant execution`,
      );
    }
  });
});
