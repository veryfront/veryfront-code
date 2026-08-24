/**
 * Integration coverage for the sandbox permission system's fail-closed branches.
 *
 * These cases cannot live in the colocated unit test at
 * `src/security/sandbox/permission-system.test.ts`: the module resolves the
 * runtime permission API through `globalThis.Deno.permissions` on every call
 * (see `getDenoPermissions()` in `src/security/sandbox/permission-system.ts`),
 * and deliberately exposes no injection point — `requestPermission` takes only a
 * `PermissionRequest`, and the module exports no factory or testing hook. That
 * is intentional for a permission-sensitive module: an overridable permissions
 * API would itself be a sandbox-escape seam.
 *
 * Observing the denied / two-call / throwing-API branches therefore requires
 * swapping the real `Deno.permissions` global, which is a host (process) effect
 * and is only permitted at the integration level. The suite itself runs under
 * --allow-all, where those branches never trigger on their own.
 */
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import {
  type Permission,
  type PermissionResult,
  requestPermission,
} from "#veryfront/security/sandbox/permission-system.ts";

const denoOnlyIt = isDeno ? it : it.skip;

type StubbedDescriptor = { name: string; host?: string; path?: string };

/**
 * Swap the runtime permission API for a stub so the fail-closed branches can be
 * observed; the suite itself runs under --allow-all, where they never trigger.
 */
async function withStubbedDenoPermissions<T>(
  request: (descriptor: StubbedDescriptor) => Promise<{ state: PermissionResult["state"] }>,
  fn: () => Promise<T>,
): Promise<T> {
  const deno = (globalThis as { Deno?: Record<string, unknown> }).Deno!;
  const original = Object.getOwnPropertyDescriptor(deno, "permissions");
  Object.defineProperty(deno, "permissions", {
    configurable: true,
    writable: true,
    enumerable: true,
    value: { request },
  });

  try {
    return await fn();
  } finally {
    if (original) {
      Object.defineProperty(deno, "permissions", original);
    } else {
      delete deno.permissions;
    }
  }
}

describe("Permission System (runtime permission API)", () => {
  denoOnlyIt("fs fails closed when read is denied", async () => {
    const asked: string[] = [];

    await withStubbedDenoPermissions(
      (descriptor) => {
        asked.push(descriptor.name);
        return Promise.resolve({
          state: descriptor.name === "read" ? "denied" as const : "granted" as const,
        });
      },
      async () => {
        const result = await requestPermission({ name: "fs", path: "/tmp" });
        assertEquals(result.state, "denied", "fs must report the denied read status");
        assertEquals(asked, ["read"], "fs must not request write once read is denied");
      },
    );
  });

  denoOnlyIt("fs reports the write status once read is granted", async () => {
    const asked: string[] = [];

    await withStubbedDenoPermissions(
      (descriptor) => {
        asked.push(descriptor.name);
        return Promise.resolve({
          state: descriptor.name === "read" ? "granted" as const : "denied" as const,
        });
      },
      async () => {
        const result = await requestPermission({ name: "fs", path: "/tmp" });
        assertEquals(result.state, "denied", "fs must report the denied write status");
        assertEquals(
          asked,
          ["read", "write"],
          "fs must request read first and only then write",
        );
      },
    );
  });

  denoOnlyIt(
    "an off-contract permission name never reaches the runtime permission API",
    async () => {
      const asked: StubbedDescriptor[] = [];

      await withStubbedDenoPermissions(
        (descriptor) => {
          asked.push(descriptor);
          return Promise.resolve({ state: "granted" as const });
        },
        async () => {
          for (const name of ["sys", "ffi", "import"]) {
            const result = await requestPermission({ name: name as Permission });
            assertEquals(
              result.state,
              "denied",
              `${name} is outside this module's contract and must be denied, never forwarded to the runtime permission API`,
            );
          }

          assertEquals(
            asked,
            [],
            "an off-contract permission name must never reach the runtime permission API",
          );
        },
      );
    },
  );

  denoOnlyIt("fails closed when the permission API throws", async () => {
    await withStubbedDenoPermissions(
      () => {
        throw new Error("permission API unavailable");
      },
      async () => {
        assertEquals(
          (await requestPermission({ name: "net" })).state,
          "denied",
          "a throwing permission API must fail closed rather than auto-granting",
        );
        assertEquals(
          (await requestPermission({ name: "fs", path: "/tmp" })).state,
          "denied",
          "the two-call fs path must fail closed on a throwing permission API too",
        );
      },
    );
  });
});
