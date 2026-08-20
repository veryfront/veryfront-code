/**
 * Agent structured-output resolution.
 *
 * Turns the public `outputSchema` (a materialized `Schema<T>` or a raw JSON
 * Schema document) into the provider-neutral `RuntimeResponseFormat` the model
 * runtimes map to their native fields, plus the parser that turns the model's
 * text back into the typed `object` on the response.
 *
 * `responseFormat` stays internal vocabulary: callers only ever say
 * `outputSchema`.
 *
 * @module agent/output-schema
 */

import type { JsonSchema, JsonSchemaValidationIssue } from "#veryfront/extensions/schema/index.ts";
import type { RuntimeResponseFormat } from "#veryfront/provider/types.ts";
import {
  isContractSchema,
  isInferredJsonSchemaObject,
  snapshotJsonSchemaObject,
} from "#veryfront/schemas/schema-input.ts";
import {
  schemaToJsonSchema,
  tryCompileJsonSchemaValidator,
} from "#veryfront/schemas/json-schema.ts";
import { AGENT_ERROR, getErrorMessage } from "#veryfront/errors";

/**
 * Response-format name sent to providers that require one.
 *
 * Deliberately a constant rather than the agent id: OpenAI constrains the name
 * to `[a-zA-Z0-9_-]`, which agent ids are not required to satisfy.
 */
const RESPONSE_FORMAT_NAME = "response";

/** A requested output schema paired with the parser that enforces it. */
export interface ResolvedAgentOutputSchema {
  readonly responseFormat: RuntimeResponseFormat;
  /** Parse and validate model text, or throw naming the failure. */
  parseOutput(text: string): Promise<unknown>;
}

const OUTPUT_SCHEMA_PARSER = Symbol("veryfront.agent.outputSchemaParser");

type OutputSchemaParserHost = {
  [OUTPUT_SCHEMA_PARSER]?: unknown;
};

function outputSchemaError(agentId: string, message: string): never {
  throw AGENT_ERROR.create({ detail: `Agent "${agentId}" ${message}` });
}

export function attachOutputSchemaParser<TResponse extends object>(
  response: TResponse,
  outputSchema: ResolvedAgentOutputSchema | undefined,
): TResponse {
  if (!outputSchema) return response;
  Object.defineProperty(response, OUTPUT_SCHEMA_PARSER, {
    value: outputSchema.parseOutput.bind(outputSchema),
    enumerable: false,
    configurable: false,
  });
  return response;
}

export function getOutputSchemaParser(
  response: unknown,
): ((text: string) => Promise<unknown>) | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const value = (response as OutputSchemaParserHost)[OUTPUT_SCHEMA_PARSER];
  return typeof value === "function" ? value as (text: string) => Promise<unknown> : undefined;
}

function formatValidationIssues(issues: readonly JsonSchemaValidationIssue[]): string {
  return issues
    .map((issue) =>
      `${issue.instancePath || "<root>"}: ${issue.message ?? `failed ${issue.keyword}`}`
    )
    .join("; ");
}

function parseOutputJson(text: string, agentId: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    outputSchemaError(
      agentId,
      `returned output that is not valid JSON for its outputSchema: ${getErrorMessage(error)}`,
    );
  }
}

/**
 * Resolve a configured or per-call `outputSchema`.
 *
 * Returns `undefined` only when no schema was requested. An unusable schema
 * throws instead: a requested schema is never dropped.
 */
export function resolveAgentOutputSchema(
  outputSchema: unknown,
  agentId: string,
): ResolvedAgentOutputSchema | undefined {
  if (outputSchema === undefined || outputSchema === null) return undefined;

  if (isContractSchema(outputSchema)) {
    const schema = outputSchema;
    const parse = schema.parse;
    let jsonSchema: JsonSchema;
    try {
      jsonSchema = schemaToJsonSchema(schema);
    } catch (error) {
      outputSchemaError(agentId, `outputSchema conversion failed: ${getErrorMessage(error)}`);
    }
    return {
      responseFormat: buildResponseFormat(jsonSchema),
      async parseOutput(text: string): Promise<unknown> {
        const value = parseOutputJson(text, agentId);
        try {
          return await Reflect.apply(parse, schema, [value]);
        } catch (error) {
          outputSchemaError(
            agentId,
            `returned output that failed outputSchema validation: ${getErrorMessage(error)}`,
          );
        }
      },
    };
  }

  const jsonSchema = snapshotJsonSchemaObject(outputSchema);
  if (jsonSchema && isInferredJsonSchemaObject(jsonSchema)) {
    // A raw JSON Schema is validated only when the registered validator
    // extension implements the optional JSON Schema compilation capability.
    const validate = tryCompileJsonSchemaValidator(jsonSchema);
    return {
      responseFormat: buildResponseFormat(jsonSchema),
      async parseOutput(text: string): Promise<unknown> {
        const value = parseOutputJson(text, agentId);
        if (!validate) return value;
        const result = await validate(value);
        if (result.success) return result.value;
        outputSchemaError(
          agentId,
          `returned output that failed outputSchema validation: ${
            formatValidationIssues(result.errors)
          }`,
        );
      },
    };
  }

  outputSchemaError(
    agentId,
    "outputSchema is not a valid Veryfront schema. Use defineSchema() or pass a JSON Schema object.",
  );
}

/**
 * Build the provider-neutral response format.
 *
 * `strict` is left unset: strict structured output additionally requires every
 * property to be required and `additionalProperties: false`, which a schema
 * with optional fields does not satisfy, and a rejected request is worse than a
 * locally validated one.
 */
function buildResponseFormat(schema: JsonSchema): RuntimeResponseFormat {
  return { type: "json_schema", name: RESPONSE_FORMAT_NAME, schema };
}
