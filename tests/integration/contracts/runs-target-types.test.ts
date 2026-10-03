/**
 * The vendored Runs target contract types (veryfront-issue-inbox#2233) must stay the
 * bytes veryfront-api generates from its shared Zod schemas, pinned by the kit hash.
 */
import { assertEquals } from "#veryfront/testing/assert.ts";
import { RUNS_OPERATION_FIXTURES } from "../../../src/runs/target/client.test-helpers.ts";
import { extractRunsFixtures } from "../../../scripts/generate-runs-fixtures.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const contractDir = new URL("../../../src/runs/contract/", import.meta.url);

async function sha256(file: string): Promise<string> {
  const bytes = await Deno.readFile(new URL(file, contractDir));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Runs target contract types", () => {
  it("keeps contract examples out of the handwritten SDK helper", async () => {
    const helper = await Deno.readTextFile(
      new URL("../../../src/runs/target/client.test-helpers.ts", import.meta.url),
    );
    assertEquals((helper.match(/"title": "Summarize text"/g) ?? []).length, 0);
  });
  it("regenerates the fixtures the SDK consumes from the pinned examples", async () => {
    const document = JSON.parse(
      await Deno.readTextFile(new URL("openapi.target.json", contractDir)),
    );
    assertEquals<unknown>(extractRunsFixtures(document), RUNS_OPERATION_FIXTURES);
    document.paths["/runs/{run_id}"].get.responses["200"].content["application/json"]
      .examples.example.value.title = "Updated contract example";
    const regenerated = extractRunsFixtures(document);
    assertEquals(
      (regenerated.getRun!.response.body as { title: string }).title,
      "Updated contract example",
    );
  });

  it("are the pinned 0.8.0 artifacts, byte for byte", async () => {
    const pin = JSON.parse(await Deno.readTextFile(new URL("pin.json", contractDir))) as {
      contract: string;
      files: Record<string, string>;
    };
    assertEquals(pin.contract, "0.8.0");
    assertEquals(Object.keys(pin.files), [
      "runs-api.generated.ts",
      "openapi.target.json",
      "runs-fixtures.generated.ts",
    ]);
    for (const [file, hash] of Object.entries(pin.files)) {
      assertEquals(await sha256(file), hash, file);
    }
  });
});
