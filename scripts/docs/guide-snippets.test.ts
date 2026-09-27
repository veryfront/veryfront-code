import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  extractFences,
  extractGraphqlHeredocs,
  findSecretLiterals,
  findUnknownIntegrationSubcommands,
  findUnquotedInlineCommands,
  findUnquotedPlaceholders,
  type GraphqlSchemaSnapshot,
  parseSubcommandUsage,
  rewritePublicImports,
  validateGraphqlOperation,
} from "./guide-snippets.ts";

const schema: GraphqlSchemaSnapshot = {
  Mutation: {
    kind: "OBJECT",
    fields: {
      executeIntegrationTool: {
        type: "IntegrationToolResult!",
        args: { input: "ExecuteIntegrationToolInput!" },
      },
    },
  },
  Query: { kind: "OBJECT", fields: {} },
  ExecuteIntegrationToolInput: {
    kind: "INPUT_OBJECT",
    inputFields: { toolName: "String!" },
  },
  IntegrationToolResult: {
    kind: "OBJECT",
    fields: {
      isError: { type: "Boolean", args: {} },
      structuredContent: { type: "JSON", args: {} },
    },
  },
  Boolean: { kind: "SCALAR" },
  JSON: { kind: "SCALAR" },
  String: { kind: "SCALAR" },
};

describe("guide snippet checks", () => {
  it("extracts fences with language and opening line", () => {
    const fences = extractFences(
      "text\n```bash\necho 1\n```\n\n```ts\nconst a = 1;\n```\n",
    );
    assertEquals(fences, [
      { lang: "bash", code: "echo 1", line: 2 },
      { lang: "ts", code: "const a = 1;", line: 6 },
    ]);
  });

  it("flags unquoted placeholders but accepts quoted ones and heredoc bodies", () => {
    const script = [
      'export TOKEN="<TOKEN>"',
      "veryfront integration tools gmail --project <PROJECT_SLUG>",
      "curl --data @- <<JSON",
      '{"id": <CONNECTION_ID>}',
      "JSON",
      "echo '<ID>' # <IGNORED>",
    ].join("\n");
    assertEquals(findUnquotedPlaceholders(script), [
      {
        line: 2,
        message: "Quote <PROJECT_SLUG>; unquoted it is a shell redirection",
      },
    ]);
  });

  it("validates GraphQL fields, arguments and variable types", () => {
    const valid = `mutation Run($input: ExecuteIntegrationToolInput!) {
  executeIntegrationTool(input: $input) { isError structuredContent }
}`;
    assertEquals(validateGraphqlOperation(valid, schema), []);

    const invalid = `mutation Run($input: String!) {
  executeIntegrationTool(input: $input, extra: 1) { isError missing }
}`;
    assertEquals(validateGraphqlOperation(invalid, schema), [
      'mutation.executeIntegrationTool: $input is String! but "input" expects ExecuteIntegrationToolInput!',
      'mutation.executeIntegrationTool: unknown argument "extra"',
      'mutation.executeIntegrationTool: IntegrationToolResult has no field "missing"',
    ]);

    assertEquals(
      validateGraphqlOperation(
        "mutation { executeIntegrationTool(input: $x) }",
        schema,
      ),
      [
        "mutation.executeIntegrationTool: undeclared variable $x",
        "mutation.executeIntegrationTool: object field needs a selection",
      ],
    );

    assertEquals(
      validateGraphqlOperation(
        "mutation Run { executeIntegrationTool { isError } }",
        schema,
      ),
      ['mutation.executeIntegrationTool: missing required argument "input"'],
    );
  });

  it("flags unquoted placeholders in inline integration commands", () => {
    const text =
      'Run `veryfront integration connect <NAME>` or\n`veryfront integration tools "<NAME>"`.';
    assertEquals(findUnquotedInlineCommands(text), [
      { line: 1, message: "Quote <NAME>; unquoted it is a shell redirection" },
    ]);
  });

  it("extracts quoted GRAPHQL heredocs from shell snippets", () => {
    const script = "Q=$(cat <<'GRAPHQL'\nquery A { a }\nGRAPHQL\n)\necho done";
    assertEquals(extractGraphqlHeredocs(script), ["query A { a }"]);
  });

  it("reports credential-shaped literals and accepts placeholders", () => {
    const fakeJwt = ["eyJ", "hbGciOiJSUzI1NiJ9", ".", "eyJ1c2VySWQiOiIxIn0"]
      .join("");
    const text = [
      'AUTH="Authorization: Bearer $VERYFRONT_API_TOKEN"',
      '"Authorization": "Bearer <TOKEN>"',
      `token=${fakeJwt}.sig`,
    ].join("\n");
    assertEquals(findSecretLiterals(text), [{
      line: 3,
      message: "JSON Web Token literal",
    }]);
  });

  it("checks integration subcommands against the released usage", () => {
    const subcommands = parseSubcommandUsage(
      "veryfront integration <list|get|connections|tools|status|connect|call> [name]",
    );
    assertEquals(subcommands, [
      "list",
      "get",
      "connections",
      "tools",
      "status",
      "connect",
      "call",
    ]);
    assertEquals(
      findUnknownIntegrationSubcommands(
        "veryfront integration call x\nveryfront integration invoke x",
        subcommands,
      ),
      [{ line: 2, message: 'Unknown integration subcommand "invoke"' }],
    );
  });

  it("rewrites public imports to export targets", () => {
    const code =
      'import { a } from "veryfront/integrations";\nimport b from "veryfront";';
    const rewritten = rewritePublicImports(
      code,
      {
        ".": "./src/index.ts",
        "./integrations": "./src/integrations/index.ts",
      },
      (target) => `file:///repo/${target.slice(2)}`,
    );
    assertEquals(
      rewritten,
      'import { a } from "file:///repo/src/integrations/index.ts";\nimport b from "file:///repo/src/index.ts";',
    );
  });
});
