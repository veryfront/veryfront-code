import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { extractReferenceDescription } from "./validate-api-reference.ts";

it("extracts only complete reference cells and preserves pipes in a quoted export", () => {
  assertEquals(
    extractReferenceDescription("| `./path|alias` | Description | rest |"),
    "Description",
  );
  assertEquals(
    extractReferenceDescription("| `./path` |" + " ".repeat(10000)),
    undefined,
  );
  assertEquals(extractReferenceDescription("| `` | Description |"), undefined);
  assertEquals(extractReferenceDescription("| `./path` | |"), "");
});
