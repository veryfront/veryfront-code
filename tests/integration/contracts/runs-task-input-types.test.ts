import { generateRunsTaskInputContract } from "../../../scripts/generate-runs-task-input-contract.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { toFileUrl } from "#std/path";
import type { components } from "../../../src/runs/contract/runs-api.generated.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

type Expect<T extends true> = T;
type HasEvent<T, K extends string> = Extract<T, { event_type: K }> extends never ? false : true;
const typedEvents: [
  Expect<HasEvent<components["schemas"]["RunEvent"], "AGENT_RUN_TASK_INPUT_ACCEPTED">>,
  Expect<HasEvent<components["schemas"]["RunEvent"], "AGENT_RUN_TASK_INPUT_ADMITTED">>,
  Expect<HasEvent<components["schemas"]["RunSnapshotEvent"], "AGENT_RUN_TASK_INPUT_ACCEPTED">>,
  Expect<HasEvent<components["schemas"]["RunSnapshotEvent"], "AGENT_RUN_TASK_INPUT_ADMITTED">>,
] = [true, true, true, true];

it("publishes both task-input events in live and snapshot Runs contracts", async () => {
  assertEquals(typedEvents, [true, true, true, true]);
  const document = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../src/runs/contract/openapi.target.json",
        import.meta.url,
      ),
    ),
  );
  for (const eventType of ["AGENT_RUN_TASK_INPUT_ACCEPTED", "AGENT_RUN_TASK_INPUT_ADMITTED"]) {
    assertEquals(typeof document["x-event-payloads"][eventType]?.$ref, "string");
    for (const schemaName of ["RunEvent", "RunSnapshotEvent"]) {
      const variants = document.components.schemas[schemaName].oneOf;
      assertEquals(
        variants.some((variant: { properties: { event_type: { enum?: string[] } } }) =>
          variant.properties.event_type.enum?.includes(eventType)
        ),
        true,
      );
      const fallback = variants.find((variant: { properties: { event_type: { not?: unknown } } }) =>
        variant.properties.event_type.not
      );
      assertEquals(fallback.properties.event_type.not.enum.includes(eventType), true);
    }
  }
});

it("rejects an unpinned API source before changing the contract", async () => {
  await withTempDir(async (path) => {
    const directory = new URL("./", toFileUrl(`${path}/`));
    const source = new URL("source.json", directory);
    await Deno.writeTextFile(source, "{}");
    await Deno.writeTextFile(
      new URL("pin.json", directory),
      JSON.stringify({ taskInputEvents: { sourceSha256: "wrong" } }),
    );
    const document = new URL("openapi.target.json", directory);
    await Deno.writeTextFile(document, "unchanged");
    await assertRejects(
      () => generateRunsTaskInputContract(source, directory),
      Error,
      "source hash mismatch",
    );
    assertEquals(await Deno.readTextFile(document), "unchanged");
  });
});

it("applies the pinned event revision idempotently", async () => {
  await withTempDir(async (path) => {
    const directory = new URL("./", toFileUrl(`${path}/`));
    const source = new URL("source.json", directory);
    const bytes = await Deno.readFile(
      new URL("../../../src/runs/contract/openapi.target.json", import.meta.url),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sourceSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await Deno.writeFile(source, bytes);
    await Deno.writeTextFile(
      new URL("pin.json", directory),
      JSON.stringify({ taskInputEvents: { sourceSha256 } }),
    );
    const document = new URL("openapi.target.json", directory);
    await Deno.writeFile(document, bytes);
    await generateRunsTaskInputContract(source, directory);
    await generateRunsTaskInputContract(source, directory);
    assertEquals(await Deno.readFile(document), bytes);
  });
});
