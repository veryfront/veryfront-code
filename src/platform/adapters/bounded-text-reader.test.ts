import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { captureBoundedTextReader } from "./bounded-text-reader.ts";

describe("platform/adapters/bounded-text-reader", () => {
  it("passes the accepted maximum directly to an exact bounded reader", async () => {
    let receivedLimit = 0;
    const reader = captureBoundedTextReader({
      readFileBytesWithinLimit: (_path: string, byteLimit: number) => {
        receivedLimit = byteLimit;
        return Promise.resolve(new TextEncoder().encode("safe"));
      },
    });

    assertEquals(await reader.readUtf8("safe.css", 4, "CSS input"), {
      content: "safe",
      byteLength: 4,
    });
    assertEquals(receivedLimit, 4);
  });

  it("accepts a whole reader only when its fixed upstream ceiling fits", async () => {
    const bytes = new TextEncoder().encode("safe");
    const reader = captureBoundedTextReader({
      maxWholeFileReadBytes: 16,
      readFileBytes: () => Promise.resolve(bytes),
    });

    assertEquals(await reader.readUtf8("safe.css", 16, "CSS input"), {
      content: "safe",
      byteLength: 4,
    });
  });

  it("rejects a 64 MiB whole-reader ceiling for a 16 MiB source without reading", async () => {
    let reads = 0;
    const reader = captureBoundedTextReader({
      maxWholeFileReadBytes: 64 * 1024 * 1024,
      readFileBytes: () => {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    });

    await assertRejects(
      () => reader.readUtf8("source.tsx", 16 * 1024 * 1024, "CSS source file"),
      TypeError,
      "exact bounded byte reader",
    );
    assertEquals(reads, 0);
  });

  it("rejects proxied capability objects without invoking traps", () => {
    let trapCalls = 0;
    const reader = new Proxy({
      readFileBytesWithinLimit: () => Promise.resolve(new Uint8Array()),
    }, {
      getOwnPropertyDescriptor(target, property) {
        trapCalls++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        trapCalls++;
        return Reflect.getPrototypeOf(target);
      },
    });

    try {
      captureBoundedTextReader(reader);
      throw new Error("expected proxy rejection");
    } catch (error) {
      assertEquals(error instanceof TypeError, true);
    }
    assertEquals(trapCalls, 0);
  });

  it("does not accept a prefix-only reader as an exact bounded reader", async () => {
    let reads = 0;
    const reader = captureBoundedTextReader({
      readFileBytesBounded: () => {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    });

    await assertRejects(
      () => reader.readUtf8("source.tsx", 16, "CSS source file"),
      TypeError,
      "exact bounded byte reader",
    );
    assertEquals(reads, 0);
  });
});
