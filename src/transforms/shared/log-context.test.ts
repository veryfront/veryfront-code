import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { errorLogName, fileLogLabel, textLogLabel } from "./log-context.ts";

describe("transform log context", () => {
  it("keeps only a bounded filename from local paths", () => {
    assertEquals(fileLogLabel("/private/project/source.ts"), "source.ts");
    assertEquals(fileLogLabel("C:\\private\\project\\source.ts"), "source.ts");
    assertEquals(fileLogLabel("file:///private/project/source.ts?token=<TOKEN>"), "source.ts");
    assertEquals(fileLogLabel(undefined), "unknown");
    assertEquals(fileLogLabel(`/private/${"x".repeat(300)}.ts`).length <= 160, true);
  });

  it("keeps only a bounded error class name", () => {
    const error = new Error("failure at /private/project/source.ts");
    error.name = "Compile\nError";

    assertEquals(errorLogName(error), "Compile Error");
    assertEquals(errorLogName("failure at /private/project/source.ts"), "UnknownError");
  });
  it("bounds non-sensitive labels and removes terminal controls", () => {
    assertEquals(textLogLabel("compile\nstage"), "compile stage");
    assertEquals(textLogLabel(""), "unknown");
    assertEquals(textLogLabel("", "stage"), "stage");
    assertEquals(textLogLabel("x".repeat(300)).length <= 160, true);
  });
});
