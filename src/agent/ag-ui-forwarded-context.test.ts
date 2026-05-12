import { assertEquals } from "@std/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  createAgUiRuntimeContextMap,
  deriveAgUiForwardedConfig,
  parseAgUiContextBoolean,
  parseAgUiContextNullableString,
  parseAgUiContextSchema,
  parseAgUiContextString,
} from "./ag-ui-forwarded-context.ts";
import type { AgUiRuntimeRequest } from "./runtime-ag-ui-contract.ts";

function createAgUiInput(overrides: Partial<AgUiRuntimeRequest> = {}): AgUiRuntimeRequest {
  return {
    threadId: "11111111-1111-4111-8111-111111111111",
    runId: "run-1",
    messages: [],
    tools: [],
    context: [],
    ...overrides,
  };
}

Deno.test("ag-ui-forwarded-context builds a description context map", () => {
  const contextMap = createAgUiRuntimeContextMap(
    createAgUiInput({
      context: [
        { description: "veryfront.projectId", value: '"project-1"' },
        { type: "text", title: "Ignored", text: "not a legacy description item" },
        { description: "veryfront.model", value: "openai/gpt-5.4" },
      ],
    }),
  );

  assertEquals(contextMap.get("veryfront.projectId"), '"project-1"');
  assertEquals(contextMap.get("veryfront.model"), "openai/gpt-5.4");
  assertEquals(contextMap.size, 2);
});

Deno.test("ag-ui-forwarded-context parses typed legacy context values", () => {
  const overridesSchema = defineSchema((v) =>
    v.object({ maxSteps: v.number().int().positive().optional() }).strip()
  )();

  assertEquals(parseAgUiContextString('"model-1"'), "model-1");
  assertEquals(parseAgUiContextString("   "), undefined);
  assertEquals(parseAgUiContextNullableString("null"), null);
  assertEquals(parseAgUiContextNullableString('"branch-1"'), "branch-1");
  assertEquals(parseAgUiContextBoolean("true"), true);
  assertEquals(parseAgUiContextBoolean("yes"), undefined);
  assertEquals(parseAgUiContextSchema('{"maxSteps":4}', overridesSchema), { maxSteps: 4 });
  assertEquals(parseAgUiContextSchema('{"maxSteps":"many"}', overridesSchema), undefined);
});

Deno.test("ag-ui-forwarded-context prefers nested forwarded config before flat forwarded props", () => {
  const configSchema = defineSchema((v) =>
    v.object({
      projectId: v.string().nullable().optional(),
      model: v.string().optional(),
      allowDelegation: v.boolean().optional(),
    }).strict()
  )();

  const result = deriveAgUiForwardedConfig(
    createAgUiInput({
      forwardedProps: {
        projectId: "project-flat",
        model: "openai/gpt-5.4",
        veryfront: {
          projectId: "project-nested",
          allowDelegation: false,
        },
      },
    }),
    {
      schema: configSchema,
      namespace: "veryfront",
    },
  );

  assertEquals(result, {
    projectId: "project-nested",
    allowDelegation: false,
  });
});

Deno.test("ag-ui-forwarded-context accepts flat forwarded config when no namespace payload exists", () => {
  const configSchema = defineSchema((v) =>
    v.object({
      projectId: v.string().nullable().optional(),
      model: v.string().optional(),
      allowDelegation: v.boolean().optional(),
    }).strict()
  )();

  const result = deriveAgUiForwardedConfig(
    createAgUiInput({
      forwardedProps: {
        projectId: "project-flat",
        model: "openai/gpt-5.4",
      },
    }),
    {
      schema: configSchema,
      namespace: "veryfront",
    },
  );

  assertEquals(result, {
    projectId: "project-flat",
    model: "openai/gpt-5.4",
  });
});

Deno.test("ag-ui-forwarded-context rejects malformed namespaced forwarded config", () => {
  const configSchema = defineSchema((v) =>
    v.object({
      projectId: v.string().nullable().optional(),
      model: v.string().optional(),
      allowDelegation: v.boolean().optional(),
    }).strict()
  )();

  const result = deriveAgUiForwardedConfig(
    createAgUiInput({
      forwardedProps: {
        projectId: "project-flat",
        model: "openai/gpt-5.4",
        veryfront: {
          projectId: 123,
        },
      },
    }),
    {
      schema: configSchema,
      namespace: "veryfront",
    },
  );

  assertEquals(result, undefined);
});
