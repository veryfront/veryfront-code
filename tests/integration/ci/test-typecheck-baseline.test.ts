import { assert, assertEquals } from "#std/assert";
import {
  evaluateRatchet,
  runDenoCheck,
} from "../../../scripts/lint/check-test-typecheck-baseline.ts";

Deno.test("runDenoCheck still rejects a genuine new test type error", async () => {
  const file = await Deno.makeTempFile({ dir: "src", suffix: ".test.ts" });
  try {
    await Deno.writeTextFile(file, "export const invalid: string = 42;\n");
    const outcome = await evaluateRatchet([file], new Set(), runDenoCheck);
    assertEquals(outcome.newRot, [file]);
    assertEquals(outcome.unattributedCleanResults, []);
    assert(outcome.newRotResults[0]!.output.includes("TS2322"));
  } finally {
    await Deno.remove(file);
  }
});
