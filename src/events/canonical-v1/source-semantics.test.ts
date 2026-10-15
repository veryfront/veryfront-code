import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";
import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import controls from "./resources/control-payload-schemas.json" with { type: "json" };
import { validateSourceSemantics, validateSourceSemanticsSync } from "./source-semantics.ts";

const documents = { [controls.$id]: controls };
const adapter = createZodAdapter();
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;
  const normalized: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).filter(([key]) =>
      !key.startsWith("x-") && key !== "$id" && key !== "$schema"
    ).map(([key, child]) => [key, normalize(child)]),
  );
  if (normalized.type === undefined) {
    if (
      normalized.properties || normalized.required || normalized.additionalProperties !== undefined
    ) normalized.type = "object";
    else if (
      normalized.pattern || normalized.minLength !== undefined || normalized.maxLength !== undefined
    ) normalized.type = "string";
    else if (normalized.minimum !== undefined || normalized.maximum !== undefined) {
      normalized.type = "number";
    } else if (
      normalized.items || normalized.minItems !== undefined || normalized.maxItems !== undefined
    ) normalized.type = "array";
  }
  if (Array.isArray(normalized.required)) {
    const properties = normalized.properties && typeof normalized.properties === "object"
      ? normalized.properties
      : {};
    for (const field of normalized.required) {
      if (typeof field === "string" && !(field in properties)) {
        Object.assign(properties, { [field]: {} });
      }
    }
    normalized.properties = properties;
  }
  return normalized;
}
const matchesSync = (value: unknown, schema: Record<string, unknown>) => {
  if (!adapter.compileJsonSchema) throw new Error("Missing JSON Schema compiler");
  const normalized = normalize({ ...schema, $defs: controls.$defs });
  // The frozen source schema is the validated external schema input.
  const validate = adapter.compileJsonSchema(normalized as JsonSchema);
  const result = validate(value);
  if (result instanceof Promise) throw new Error("Expected synchronous real adapter validation");
  return result.success;
};
const matches = (value: unknown, schema: Record<string, unknown>) =>
  Promise.resolve(matchesSync(value, schema));
const check = (value: unknown, definition: string) =>
  validateSourceSemantics(
    value,
    { $ref: `#/$defs/${definition}` },
    controls.$id,
    documents,
    matches,
  );

describe("canonical source annotations", () => {
  it("enforces serialized JSON context byte limits including encoding and escaping", async () => {
    for (const data of [{ x: "x".repeat(16376) }, { x: "é".repeat(8188) }]) {
      await check({ type: "json", data }, "AgentStreamContextItem");
    }
    for (
      const data of [
        { x: "x".repeat(16377) },
        { x: "é".repeat(8189) },
        { x: "\n".repeat(8189) },
      ]
    ) await assertRejects(() => check({ type: "json", data }, "AgentStreamContextItem"), TypeError);
  });
  it("counts source string lengths in UTF-16 units and preserves canonical trim output", async () => {
    await check({ name: "a", deniedTools: ["😀".repeat(64)] }, "RuntimeAgentDefinition");
    await assertRejects(
      () => check({ name: "a", deniedTools: ["😀".repeat(64) + "x"] }, "RuntimeAgentDefinition"),
      TypeError,
    );
    for (const name of [" tool", "tool ", "\uFEFFtool"]) {
      await assertRejects(
        () => check({ deniedTools: [name] }, "RuntimeAgentDefinition"),
        TypeError,
      );
    }
    await check({ deniedTools: ["tool"] }, "RuntimeAgentDefinition");
    await check({ runtimeTargetBranchName: "branch" }, "RuntimeAgentProjectContext");
    await assertRejects(
      () => check({ runtimeTargetEnvironmentName: " env " }, "RuntimeAgentProjectContext"),
      TypeError,
    );
  });
  it("keeps arbitrary JSON data opaque and leaves the input unchanged", async () => {
    const opaque = { deniedTools: [" untrimmed "], type: "json", data: { x: "x".repeat(20000) } };
    await check(opaque, "JsonObject");
    const context = { type: "json", data: { deniedTools: [" untrimmed "] } };
    const original = structuredClone(context);
    await check(context, "AgentStreamContextItem");
    assertEquals(context, original);
  });
  it("follows external references and accepts an applicable unrestricted anyOf branch", async () => {
    const rootId = "urn:test:root";
    const schema = { anyOf: [{ $ref: controls.$id + "#/$defs/AgentTaskId" }, {}] };
    await validateSourceSemantics("😀".repeat(128), schema, rootId, {
      ...documents,
      [rootId]: schema,
    }, async () => true);
  });
  it("uses the same synchronous traversal and terminates schema reference cycles", () => {
    const schema = { $ref: "#/$defs/RuntimeAgentDefinition" };
    validateSourceSemanticsSync(
      { deniedTools: ["tool"] },
      schema,
      controls.$id,
      documents,
      () => true,
    );
    assertThrows(() =>
      validateSourceSemanticsSync(
        { deniedTools: [" tool "] },
        schema,
        controls.$id,
        documents,
        () => true,
      ), TypeError);
    const cycle = { $ref: "#", maxLength: 2 };
    const cycleDocuments = { [controls.$id]: cycle };
    validateSourceSemanticsSync("ok", cycle, controls.$id, cycleDocuments, () => true);
    assertThrows(() =>
      validateSourceSemanticsSync(
        "bad",
        cycle,
        controls.$id,
        cycleDocuments,
        () => true,
      ), TypeError);
  });
  it("enforces all annotated trim paths with synchronous and asynchronous parity", async () => {
    const uuid = "12345678-1234-4234-8234-123456789abc";
    const cases = [
      {
        definition: "RuntimeAgentDefinition",
        valid: {
          id: "agent",
          name: "Agent",
          description: "Description",
          instructions: "Instructions",
          deniedTools: ["tool"],
        },
        invalid: {
          id: "agent",
          name: "Agent",
          description: "Description",
          instructions: "Instructions",
          deniedTools: [" tool "],
        },
      },
      ...["runtimeTargetEnvironmentName", "runtimeTargetBranchName"].map((field) => ({
        definition: "RuntimeAgentProjectContext",
        valid: { projectId: uuid, projectSlug: "project", [field]: "target" },
        invalid: { projectId: uuid, projectSlug: "project", [field]: " target " },
      })),
      ...["user", "project"].map((scope) => {
        const base = {
          kind: "oauth",
          integration: "github",
          connectionId: uuid,
          connectionGenerationId: uuid,
          ownerId: uuid,
          scope,
          ownerKind: scope,
        };
        return {
          definition: "OAuthIntegrationConnectionBinding",
          valid: base,
          invalid: { ...base, integration: " github " },
        };
      }),
      {
        definition: "ServiceIdentityAuthorizationBinding",
        valid: {
          kind: "service_identity",
          integration: "github",
          ownerKind: "project",
          ownerId: uuid,
          targetEnvironmentId: "env",
          policyGenerationId: null,
        },
        invalid: {
          kind: "service_identity",
          integration: "github",
          ownerKind: "project",
          ownerId: uuid,
          targetEnvironmentId: " env ",
          policyGenerationId: null,
        },
      },
    ];
    for (const fixture of cases) {
      const schema = { $ref: `#/$defs/${fixture.definition}` };
      // Both values satisfy the structural contract; source trim is the extra rejection.
      assertEquals(matchesSync(fixture.valid, schema), true, fixture.definition);
      assertEquals(matchesSync(fixture.invalid, schema), true);
      await check(fixture.valid, fixture.definition);
      validateSourceSemanticsSync(fixture.valid, schema, controls.$id, documents, matchesSync);
      await assertRejects(() => check(fixture.invalid, fixture.definition), TypeError);
      assertThrows(
        () =>
          validateSourceSemanticsSync(
            fixture.invalid,
            schema,
            controls.$id,
            documents,
            matchesSync,
          ),
        TypeError,
      );
    }
    await check({
      kind: "service_identity",
      integration: "github",
      ownerKind: "project",
      ownerId: uuid,
      targetEnvironmentId: null,
      policyGenerationId: null,
    }, "ServiceIdentityAuthorizationBinding");
  });
  it("does not impose length annotations from a structurally inapplicable union branch", async () => {
    const schema = {
      oneOf: [
        {
          type: "object",
          properties: { kind: { const: "short" }, text: { type: "string", maxLength: 2 } },
          required: ["kind", "text"],
        },
        {
          type: "object",
          properties: { kind: { const: "long" }, text: { type: "string", maxLength: 10 } },
          required: ["kind", "text"],
        },
      ],
    };
    const value = { kind: "long", text: "😀😀😀" };
    assertEquals(matchesSync(value, schema.oneOf[0]), false);
    assertEquals(matchesSync(value, schema.oneOf[1]), true);
    await validateSourceSemantics(value, schema, controls.$id, documents, matches);
    validateSourceSemanticsSync(value, schema, controls.$id, documents, matchesSync);
  });
});
