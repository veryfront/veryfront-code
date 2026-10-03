import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractRunsFixtures,
  renderRunsFixtures,
  type RunsExampleDocument,
} from "./generate-runs-fixtures.ts";

const document = {
  paths: {
    "/runs/{run_id}": {
      get: {
        operationId: "getRun",
        parameters: [{
          name: "run_id",
          in: "path",
          required: true,
          example: "run-example",
        }],
        responses: {
          "200": {
            content: {
              "application/json": {
                examples: { example: { value: { title: "Original" } } },
              },
            },
          },
        },
      },
    },
  },
};

describe("Runs fixture generation", () => {
  it("propagates a compatible contract example change without a fixture edit", () => {
    const changed = structuredClone(document);
    changed.paths["/runs/{run_id}"].get.responses["200"]
      .content["application/json"]
      .examples.example.value.title = "Changed by contract regeneration";
    assertEquals(extractRunsFixtures(document).getRun.response.body, {
      title: "Original",
    });
    assertEquals(extractRunsFixtures(changed).getRun.response.body, {
      title: "Changed by contract regeneration",
    });
    assertStringIncludes(
      renderRunsFixtures(changed),
      '"title": "Changed by contract regeneration"',
    );
  });

  it("derives omitted request defaults from referenced schemas and field variants", () => {
    const changed: RunsExampleDocument = structuredClone(document);
    changed.components = {
      schemas: {
        Request: {
          properties: {
            lease_duration_seconds: { default: 60 },
            fields: {
              items: {
                anyOf: [
                  {
                    properties: {
                      type: { enum: ["text"] },
                      required: { default: true },
                    },
                  },
                  {
                    properties: {
                      type: { enum: ["confirm"] },
                      required: { default: false },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };
    changed.paths["/runs/{run_id}"]!.get!.requestBody = {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Request" },
          examples: { minimal: { value: { fields: [{ type: "confirm" }] } } },
        },
      },
    };
    assertEquals(extractRunsFixtures(changed).getRun!.input.body, {
      lease_duration_seconds: 60,
      fields: [{ type: "confirm", required: false }],
    });
  });

  it("serializes compatible array query examples the same way as the SDK", () => {
    const changed: RunsExampleDocument = structuredClone(document);
    changed.paths["/runs/{run_id}"]!.get!.parameters!.push({
      name: "status",
      in: "query",
      example: ["running", "pending"],
    });
    const fixture = extractRunsFixtures(changed).getRun!;
    assertEquals(fixture.input.query, { status: ["running", "pending"] });
    assertEquals(
      fixture.url,
      "/runs/run-example?status=running&status=pending",
    );
  });

  it("omits null query examples from the URL the same way as the SDK", () => {
    const changed: RunsExampleDocument = structuredClone(document);
    changed.paths["/runs/{run_id}"]!.get!.parameters!.push({
      name: "label",
      in: "query",
      example: null,
    }, {
      name: "status",
      in: "query",
      example: ["running", null],
    });
    const fixture = extractRunsFixtures(changed).getRun!;
    assertEquals(fixture.input.query, {
      label: null,
      status: ["running", null],
    });
    assertEquals(fixture.url, "/runs/run-example?status=running");
  });

  it("applies path-level parameters and ignores path-item metadata", () => {
    const changed = structuredClone(document) as RunsExampleDocument;
    const pathItem = changed.paths["/runs/{run_id}"]!;
    const shared = pathItem.get!.parameters!;
    delete pathItem.get!.parameters;
    pathItem.parameters = [...shared, {
      name: "label",
      in: "query",
      example: "shared",
    }];
    pathItem.get!.parameters = [{
      name: "label",
      in: "query",
      example: "own",
    }];
    Object.assign(pathItem, { summary: "Run", servers: [] });
    const fixture = extractRunsFixtures(changed).getRun!;
    assertEquals(fixture.input.path, { run_id: "run-example" });
    assertEquals(fixture.input.query, { label: "own" });
    assertEquals(fixture.url, "/runs/run-example?label=own");
  });

  it("fails rather than inventing missing success examples", () => {
    const changed: RunsExampleDocument = structuredClone(document);
    changed.paths["/runs/{run_id}"]!.get!.responses["200"]!
      .content!["application/json"]!.examples = {};
    assertThrows(
      () => extractRunsFixtures(changed),
      Error,
      "Missing response example: getRun",
    );
  });
});
