import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readBoundedModuleSource } from "./module-source-reader.ts";

describe("modules/server/module-source-reader", () => {
  it("reads exact bounded bytes and decodes strict UTF-8", async () => {
    const limits: number[] = [];
    const source = await readBoundedModuleSource(
      (_path, byteLimit) => {
        limits.push(byteLimit);
        return Promise.resolve(new TextEncoder().encode("é"));
      },
      "/module.ts",
      2,
    );
    assertEquals(source, "é");
    assertEquals(limits, [2]);
  });

  it("fails closed when the exact bounded capability is unavailable", async () => {
    await assertRejects(
      () => readBoundedModuleSource(undefined, "/module.ts", 10),
      TypeError,
      "requires an exact bounded byte reader",
    );
  });

  it("rejects a dishonest oversized reader result before decoding", async () => {
    await assertRejects(
      () =>
        readBoundedModuleSource(
          () => Promise.resolve(new Uint8Array(2)),
          "/module.ts",
          1,
        ),
      RangeError,
      "exceeds 1 bytes",
    );
  });

  it("rejects malformed UTF-8", async () => {
    await assertRejects(
      () =>
        readBoundedModuleSource(
          () => Promise.resolve(new Uint8Array([0xc3, 0x28])),
          "/module.ts",
          10,
        ),
      TypeError,
      "valid UTF-8",
    );
  });

  it("propagates operational reader failures", async () => {
    const denied = new Deno.errors.PermissionDenied("denied");
    await assertRejects(
      () =>
        readBoundedModuleSource(
          () => Promise.reject(denied),
          "/module.ts",
          10,
        ),
      Deno.errors.PermissionDenied,
      "denied",
    );
  });

  it("rejects a non-positive byte boundary", async () => {
    await assertRejects(
      () =>
        readBoundedModuleSource(
          () => Promise.resolve(new Uint8Array([1])),
          "/module.ts",
          0,
        ),
      RangeError,
      "positive safe integer",
    );
  });
});
