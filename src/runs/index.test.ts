import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as runsModule from "./index.ts";
import * as publicRunsModule from "veryfront/runs";
import * as clientModule from "./runs-client.ts";
import * as schemaModule from "./schemas.ts";

const expectedRuntimeExports = [
  "CancelRunResponseSchema",
  "CreateRunResponseSchema",
  "RunEventListSchema",
  "RunEventSchema",
  "RunListSchema",
  "RunSchema",
  "ScheduleRunCreateResponseSchema",
  "VeryfrontRunsClient",
  "createRunsClient",
];

describe("runs/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/runs", () => {
    assertEquals(Object.keys(runsModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicRunsModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(runsModule.createRunsClient, clientModule.createRunsClient);
    assertStrictEquals(runsModule.VeryfrontRunsClient, clientModule.VeryfrontRunsClient);
    assertStrictEquals(runsModule.RunSchema, schemaModule.RunSchema);
    assertStrictEquals(runsModule.RunEventSchema, schemaModule.RunEventSchema);
    assertStrictEquals(runsModule.RunEventListSchema, schemaModule.RunEventListSchema);
    assertStrictEquals(runsModule.RunListSchema, schemaModule.RunListSchema);
    assertStrictEquals(
      runsModule.CreateRunResponseSchema,
      schemaModule.CreateRunResponseSchema,
    );
    assertStrictEquals(
      runsModule.ScheduleRunCreateResponseSchema,
      schemaModule.ScheduleRunCreateResponseSchema,
    );
    assertStrictEquals(
      runsModule.CancelRunResponseSchema,
      schemaModule.CancelRunResponseSchema,
    );
  });
});
