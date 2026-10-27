import { assert, assertEquals } from "#std/assert";
import {
  evaluateRatchet,
  runDenoCheck,
} from "../../../scripts/lint/check-test-typecheck-baseline.ts";

Deno.test("runDenoCheck still rejects a genuine new test type error", async () => {
  // Source-tree audits run concurrently; keep this short-lived fixture outside
  // their input tree so cleanup cannot race a scanner.
  const file = await Deno.makeTempFile({ suffix: ".test.ts" });
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
