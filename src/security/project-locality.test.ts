import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isSharedProjectRuntime } from "./project-locality.ts";

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
