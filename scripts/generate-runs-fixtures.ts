/** Generate the SDK fixtures from the vendored, pinned Runs OpenAPI examples. */
interface Schema {
  $ref?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
}
interface ExampleMedia {
  schema?: Schema;
  examples?: Record<string, { value: unknown }>;
}
interface ContractOperation {
  operationId: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    example?: unknown;
  }>;
  requestBody?: { content: Record<string, ExampleMedia> };
  responses: Record<string, { content?: Record<string, ExampleMedia> }>;
}
export interface RunsExampleDocument {
  components?: { schemas: Record<string, Schema> };
  paths: Record<string, Record<string, ContractOperation>>;
}
interface Fixture {
  input: Record<string, unknown>;
  url: string;
  response: { status: number; body: unknown };
}

function firstExample(media: ExampleMedia, context: string): unknown {
  const example = Object.values(media.examples ?? {})[0];
  if (!example) throw new Error(`Missing ${context}`);
  return example.value;
}

/** Generated request types include schema defaults as required properties. */
function withDefaults(
  value: unknown,
  schema: Schema | undefined,
  document: RunsExampleDocument,
): unknown {
  if (!schema) return value;
  if (schema.$ref) {
    return withDefaults(
      value,
      document.components?.schemas[schema.$ref.split("/").pop()!],
      document,
    );
  }
  if (value === undefined) return schema.default;
  if (Array.isArray(value)) {
    return value.map((item) => withDefaults(item, schema.items, document));
  }
  if (value === null || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (schema.anyOf) {
    const variant = schema.anyOf.find((candidate) =>
      Object.entries(candidate.properties ?? {}).every(([key, property]) =>
        !property.enum || property.enum.includes(object[key])
      )
    );
    return withDefaults(value, variant, document);
  }
  const result = { ...object };
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const resolved = withDefaults(object[key], property, document);
    if (resolved !== undefined) result[key] = resolved;
  }
  return result;
}

/** Preserve the first named request and success example of each contract operation. */
export function extractRunsFixtures(
  document: RunsExampleDocument,
): Record<string, Fixture> {
  const fixtures: Record<string, Fixture> = {};
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const operation of Object.values(methods)) {
      const id = operation.operationId;
      const input: Record<string, unknown> = {};
      let url = path;
      const query = new URLSearchParams();
      for (const parameter of operation.parameters ?? []) {
        if (parameter.example === undefined) {
          if (parameter.required) {
            throw new Error(
              `Missing parameter example: ${id}/${parameter.name}`,
            );
          }
          continue;
        }
        const group = parameter.in === "header" ? "headers" : parameter.in;
        const values = (input[group] ??= {}) as Record<string, unknown>;
        values[parameter.name] = parameter.example;
        if (parameter.in === "path") {
          url = url.replace(
            `{${parameter.name}}`,
            encodeURIComponent(String(parameter.example)),
          );
        } else if (parameter.in === "query") {
          query.set(parameter.name, String(parameter.example));
        }
      }
      if (query.size) url += `?${query}`;
      if (operation.requestBody) {
        const media = operation.requestBody.content["application/json"]!;
        input.body = withDefaults(
          firstExample(media, `request example: ${id}`),
          media.schema,
          document,
        );
      }
      const success = Object.entries(operation.responses).find(([status]) =>
        /^2\d\d$/.test(status)
      );
      if (!success) throw new Error(`Missing success response: ${id}`);
      const [status, response] = success;
      const media = response.content && Object.values(response.content)[0];
      fixtures[id] = {
        input,
        url,
        response: {
          status: Number(status),
          body: media
            ? firstExample(media, `response example: ${id}`)
            : undefined,
        },
      };
    }
  }
  return fixtures;
}

/** Emit typed TypeScript so incompatible contract examples still fail typechecking. */
export function renderRunsFixtures(document: RunsExampleDocument): string {
  const entries = Object.entries(extractRunsFixtures(document)).map((
    [id, fixture],
  ) =>
    `${JSON.stringify(id)}: { input: ${
      JSON.stringify(fixture.input, null, 2)
    }, url: ${
      JSON.stringify(fixture.url)
    }, response: { status: ${fixture.response.status}, body: ${
      JSON.stringify(fixture.response.body, null, 2) ?? "undefined"
    } } }`
  );
  return `// Generated by scripts/generate-runs-fixtures.ts. Do not edit.\nimport type { RunsOperationId } from "../target/client.ts";\nimport type { RunsOperationFixture } from "../target/client.test-helpers.ts";\n\nexport const RUNS_OPERATION_FIXTURES: { [K in RunsOperationId]: RunsOperationFixture<K> } = {\n${
    entries.join(",\n")
  }\n};\n`;
}

if (import.meta.main) {
  const directory = new URL("../src/runs/contract/", import.meta.url);
  const source = new URL("openapi.target.json", directory);
  const output = new URL("runs-fixtures.generated.ts", directory);
  const document: RunsExampleDocument = JSON.parse(
    await Deno.readTextFile(source),
  );
  await Deno.writeTextFile(output, renderRunsFixtures(document));
  const formatter = await new Deno.Command("deno", {
    args: ["fmt", output.pathname],
  }).output();
  if (!formatter.success) {
    throw new Error(new TextDecoder().decode(formatter.stderr));
  }
  const pinUrl = new URL("pin.json", directory);
  const pin = JSON.parse(await Deno.readTextFile(pinUrl));
  for (const file of ["openapi.target.json", "runs-fixtures.generated.ts"]) {
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        await Deno.readFile(new URL(file, directory)),
      ),
    );
    pin.files[file] = Array.from(
      hash,
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  pin.fixturesGeneratedBy = "deno task contracts:runs:fixtures";
  await Deno.writeTextFile(pinUrl, JSON.stringify(pin, null, 2) + "\n");
}
