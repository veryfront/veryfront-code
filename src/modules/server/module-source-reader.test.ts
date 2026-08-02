import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readBoundedModuleSource } from "./module-source-reader.ts";

describe("modules/server/module-source-reader", () => {
  it("reads a regular source within both boundaries", async () => {
    const source = await readBoundedModuleSource(
      { stat: () => Promise.resolve({ isFile: true, size: 2 }) },
      "/module.ts",
      () => Promise.resolve("é"),
      2,
    );
    assertEquals(source, "é");
  });

  it("rejects oversized metadata before allocating source text", async () => {
    let reads = 0;
    await assertRejects(
      () =>
        readBoundedModuleSource(
          { stat: () => Promise.resolve({ isFile: true, size: 11 }) },
          "/module.ts",
          () => {
            reads++;
            return Promise.resolve("source");
          },
          10,
        ),
      RangeError,
      "exceeds 10 bytes",
    );
    assertEquals(reads, 0);
  });

  it("rejects text that exceeds inaccurate adapter metadata", async () => {
    await assertRejects(
      () =>
        readBoundedModuleSource(
          { stat: () => Promise.resolve({ isFile: true, size: 1 }) },
          "/module.ts",
          () => Promise.resolve("é"),
          1,
        ),
      RangeError,
      "exceeds 1 UTF-8 bytes",
    );
  });

  it("rejects a non-file target", async () => {
    await assertRejects(
      () =>
        readBoundedModuleSource(
          { stat: () => Promise.resolve({ isFile: false, size: 1 }) },
          "/dir",
          () => Promise.resolve(""),
          10,
        ),
      RangeError,
    );
  });

  it("rejects a non-positive byte boundary", async () => {
    await assertRejects(
      () =>
        readBoundedModuleSource(
          { stat: () => Promise.resolve({ isFile: true, size: 1 }) },
          "/module.ts",
          () => Promise.resolve("a"),
          0,
        ),
      RangeError,
      "positive safe integer",
    );
  });
});
