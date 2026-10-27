import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { executeLocalIntegrationEndpoint } from "../../../src/integrations/local-endpoint-executor.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import "#veryfront/schemas/_test-setup.ts";
import { getConnector } from "../../../src/integrations/index.ts";
import { IntegrationConfigSchema } from "../../../src/integrations/schema.ts";
import { toolDefinition } from "../../../src/integrations/local-tool-source.ts";
import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";

const connector = IntegrationConfigSchema.parse(JSON.parse(
  await Deno.readTextFile(
    new URL("../../../templates/integrations/sheets/connector.json", import.meta.url),
  ),
));

describe("Sheets request and execution contracts", () => {
  it("Sheets find/replace schema rejects the observed unwrapped request", async () => {
    const schema = connector.tools.find((tool) => tool.id === "sheets__find_replace")?.endpoint
      ?.body
      ?.requests?.inputSchema;
    assertExists(schema);
    const validate = createZodAdapter().compileJsonSchema!(schema);
    assertEquals(
      (await validate([{ find: "alpha", replacement: "ALPHA", allSheets: true }])).success,
      false,
    );
    assertEquals(
      (await validate([{ findReplace: { find: "alpha", replacement: "ALPHA", allSheets: true } }]))
        .success,
      true,
    );
    assertEquals(
      (await validate([{ findReplace: { find: "alpha", replacement: "ALPHA" } }])).success,
      false,
    );
    assertEquals(
      (await validate([{
        findReplace: { find: "alpha", replacement: "ALPHA", allSheets: true, sheetId: 123 },
      }])).success,
      false,
    );
    assertEquals(
      (await validate([{ findReplace: { find: "alpha", replacement: "ALPHA", allSheets: false } }]))
        .success,
      false,
    );
    assertEquals(
      (await validate([{
        findReplace: { find: "alpha", replacement: "A", range: { a1Notation: "A1:B2" } },
      }])).success,
      false,
    );
    assertEquals(
      (await validate([{
        findReplace: {
          find: "alpha",
          replacement: "A",
          range: {
            sheetId: 123,
            startRowIndex: 0,
            endRowIndex: 2,
            startColumnIndex: 0,
            endColumnIndex: 2,
          },
        },
      }])).success,
      true,
    );
    assertEquals(
      (await validate([{
        findReplace: { find: "a", replacement: "b", allSheets: true, matchCas: true },
      }])).success,
      false,
    );
  });

  it("Sheets rename schema requires the sheet ID and title field mask in their provider locations", async () => {
    const schema = connector.tools.find((tool) => tool.id === "sheets__rename_sheet")?.endpoint
      ?.body
      ?.requests?.inputSchema;
    assertExists(schema);
    const validate = createZodAdapter().compileJsonSchema!(schema);
    assertEquals(
      (await validate([{
        updateSheetProperties: { properties: { title: "Renamed" }, fields: "title", sheetId: 123 },
      }])).success,
      false,
    );
    assertEquals(
      (await validate([{
        updateSheetProperties: { properties: { sheetId: 123, title: "Renamed" } },
      }])).success,
      false,
    );
    assertEquals(
      (await validate([{
        updateSheetProperties: { properties: { sheetId: 123, title: "Renamed" }, fields: "title" },
      }])).success,
      true,
    );
  });

  it("generated Sheets catalog preserves the nested request contracts", () => {
    const generated = getConnector("sheets");
    assertExists(generated);
    for (
      const id of [
        "sheets__find_replace",
        "sheets__rename_sheet",
        "sheets__create_chart",
        "sheets__set_data_validation",
      ]
    ) {
      const source = connector.tools.find((tool) => tool.id === id)?.endpoint?.body?.requests
        ?.inputSchema;
      const emitted = generated.tools.find((tool) => tool.id === id)?.endpoint?.body?.requests
        ?.inputSchema;
      assertExists(source);
      assertEquals(emitted, source);
    }
  });

  it("Sheets chart schema places the chart outside its specification and describes data series", async () => {
    const schema = connector.tools.find((tool) => tool.id === "sheets__create_chart")?.endpoint
      ?.body
      ?.requests?.inputSchema;
    assertExists(schema);
    const validate = createZodAdapter().compileJsonSchema!(schema);
    const range = {
      sheetId: 123,
      startRowIndex: 0,
      endRowIndex: 5,
      startColumnIndex: 0,
      endColumnIndex: 1,
    };
    const basicChart = {
      chartType: "COLUMN",
      domains: [{ domain: { sourceRange: { sources: [range] } } }],
      series: [{
        series: {
          sourceRange: { sources: [{ ...range, startColumnIndex: 1, endColumnIndex: 2 }] },
        },
      }],
    };
    for (const position of [{}, { newSheet: true, sheetId: 123 }, { newSheet: false }]) {
      assertEquals(
        (await validate([{ addChart: { chart: { spec: { basicChart }, position } } }])).success,
        false,
      );
    }
    for (const spec of [{}, { basicChart: { chartType: "COLUMN", series: [{ series: {} }] } }]) {
      assertEquals(
        (await validate([{ addChart: { chart: { spec, position: { newSheet: true } } } }])).success,
        false,
      );
    }
    const position = {
      overlayPosition: { anchorCell: { sheetId: 123, rowIndex: 0, columnIndex: 3 } },
    };
    assertEquals(
      (await validate([{
        addChart: { chart: { spec: { title: "Proof", basicChart, position } } },
      }]))
        .success,
      false,
    );
    assertEquals(
      (await validate([{
        addChart: { chart: { spec: { title: "Proof", basicChart }, position } },
      }]))
        .success,
      true,
    );
  });

  it("Sheets validation schema keeps the range inside the request and rejects invalid rule fields", async () => {
    const schema = connector.tools.find((tool) => tool.id === "sheets__set_data_validation")
      ?.endpoint
      ?.body
      ?.requests?.inputSchema;
    assertExists(schema);
    const validate = createZodAdapter().compileJsonSchema!(schema);
    const range = {
      sheetId: 123,
      startRowIndex: 1,
      endRowIndex: 5,
      startColumnIndex: 1,
      endColumnIndex: 2,
    };
    const rule = {
      condition: { type: "NUMBER_GREATER_THAN_EQ", values: [{ userEnteredValue: "0" }] },
      strict: true,
    };
    assertEquals((await validate([{ setDataValidation: { rule } }, "repeatCell"])).success, false);
    assertEquals(
      (await validate([{
        setDataValidation: { range, rule: { ...rule, showPromptForInvalid: true } },
      }])).success,
      false,
    );
    assertEquals(
      (await validate([{ setDataValidation: { range, rule, filteredRowsIncluded: true } }]))
        .success,
      true,
    );
    assertEquals((await validate([{ setDataValidation: { range } }])).success, true);
    assertEquals(
      (await validate([{
        setDataValidation: {
          range,
          rule: { condition: { type: "NUMBER_BETWEEN", values: [{ userEnteredValue: "1" }] } },
        },
      }])).success,
      false,
    );
    assertEquals(
      (await validate([{
        setDataValidation: {
          range,
          rule: { condition: { type: "DATE_IS_VALID", values: [{ userEnteredValue: "1" }] } },
        },
      }])).success,
      false,
    );
    assertEquals((await validate([{ setDataValidation: { range, rule } }])).success, true);
  });

  it("published Sheets contracts validate synthetic request examples", async () => {
    const examples = JSON.parse(
      await Deno.readTextFile(new URL("./fixtures/sheets-request-examples.json", import.meta.url)),
    );
    assertEquals(examples.kind, "synthetic-regression-examples");
    for (const sample of examples.cases) {
      const tool = connector.tools.find((tool) => tool.id === sample.tool)!;
      const definition = toolDefinition({ ...tool, id: sample.tool }, tool.endpoint!, []);
      const validate = createZodAdapter().compileJsonSchema!(definition.parameters);
      assertEquals((await validate(sample.args)).success, sample.validArguments);
    }
  });

  it("Sheets typed requests reject invalid identifiers, chart placement, and enum values", async () => {
    const examples = JSON.parse(
      await Deno.readTextFile(new URL("./fixtures/sheets-request-examples.json", import.meta.url)),
    );
    const chart = examples.cases[0].args.requests[0].addChart.chart;
    const invalidRequests = [
      ["sheets__rename_sheet", [{
        updateSheetProperties: { properties: { sheetId: -1, title: "Example" }, fields: "title" },
      }]],
      ["sheets__find_replace", [{ findReplace: { find: "a", replacement: "b", sheetId: -1 } }]],
      ["sheets__create_chart", [{
        addChart: {
          chart: { ...chart, spec: { ...chart.spec, domains: chart.spec.basicChart.domains } },
        },
      }]],
      ...[
        { ...chart.spec.basicChart, legendPosition: "bottom" },
        {
          ...chart.spec.basicChart,
          domains: [
            chart.spec.basicChart.domains[0],
            chart.spec.basicChart.domains[0],
          ],
        },
        {
          ...chart.spec.basicChart,
          series: [{ ...chart.spec.basicChart.series[0], targetAxis: "sideways" }],
        },
        {
          ...chart.spec.basicChart,
          series: [{ ...chart.spec.basicChart.series[0], type: "bogus" }],
        },
      ].map((basicChart) => ["sheets__create_chart", [{
        addChart: { chart: { ...chart, spec: { ...chart.spec, basicChart } } },
      }]]),
    ];
    for (const [id, requests] of invalidRequests) {
      const schema = connector.tools.find((tool) => tool.id === id)?.endpoint?.body?.requests
        ?.inputSchema;
      assertExists(schema);
      const validate = createZodAdapter().compileJsonSchema!(schema);
      assertEquals((await validate(requests)).success, false);
    }
  });

  it("local endpoint execution enforces canonical nested unions before transport", async () => {
    let requests = 0;
    for (const id of ["sheets__find_replace", "sheets__create_chart"]) {
      const tool = getConnector("sheets")?.tools.find((tool) => tool.id === id);
      const definition = tool?.endpoint;
      assert(definition);
      const conflicting = id === "sheets__find_replace"
        ? [{ findReplace: { find: "a", replacement: "b", allSheets: true, sheetId: 123 } }]
        : [{
          addChart: {
            chart: {
              spec: { pieChart: {} },
              position: {
                overlayPosition: { anchorCell: { sheetId: 123 } },
                newSheet: true,
              },
            },
          },
        }];
      const error = await assertRejects(() =>
        executeLocalIntegrationEndpoint({
          connectorName: "sheets",
          toolId: "sheets__find_replace",
          endpoint: definition,
          args: { spreadsheetId: "spreadsheet-example", requests: conflicting },
          authHeaders: {},
          allowedOrigin: "https://sheets.googleapis.com",
          transport: () => {
            requests++;
            return Promise.resolve(Response.json({ replies: [] }));
          },
        }), VeryfrontError);
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "local-integration-request-invalid");
    }
    assertEquals(requests, 0);
    const definition = getConnector("sheets")?.tools.find(
      (tool) => tool.id === "sheets__find_replace",
    )?.endpoint;
    assert(definition);
    await executeLocalIntegrationEndpoint({
      connectorName: "sheets",
      toolId: "sheets__find_replace",
      endpoint: definition,
      args: {
        spreadsheetId: "spreadsheet-example",
        requests: [{
          findReplace: { find: "a", replacement: "b", allSheets: true },
        }],
      },
      authHeaders: {},
      allowedOrigin: "https://sheets.googleapis.com",
      transport: () => {
        requests++;
        return Promise.resolve(Response.json({ replies: [] }));
      },
    });
    assertEquals(requests, 1);
  });

  it("canonical input validation cannot cache a validator compiled under replaced intrinsics", async () => {
    const { compileJsonSchemaValidator } = await import("#veryfront/schemas/json-schema.ts");
    compileJsonSchemaValidator({ type: "array" });
    const template = getConnector("sheets")?.tools.find(
      (tool) => tool.id === "sheets__find_replace",
    )?.endpoint;
    assert(template);
    const definition = structuredClone(template);
    const original = JSON.stringify;
    let requests = 0;
    let poisoned: unknown;
    const invoke = async () => {
      try {
        await executeLocalIntegrationEndpoint({
          connectorName: "sheets",
          toolId: "sheets__find_replace",
          endpoint: definition,
          args: {
            spreadsheetId: "spreadsheet-example",
            requests: [{
              findReplace: { find: "a", replacement: "b", allSheets: true, sheetId: 123 },
            }],
          },
          authHeaders: {},
          allowedOrigin: "https://sheets.googleapis.com",
          transport: () => {
            requests++;
            return Promise.resolve(new Response('{"replies":[]}'));
          },
        });
        return undefined;
      } catch (error) {
        return error;
      }
    };
    try {
      JSON.stringify = (() => '{"type":"array"}') as typeof JSON.stringify;
      poisoned = await invoke();
    } finally {
      JSON.stringify = original;
    }
    const afterRestore = await invoke();
    assertInstanceOf(poisoned, VeryfrontError);
    assertEquals(poisoned.slug, "local-integration-request-invalid");
    assertInstanceOf(afterRestore, VeryfrontError);
    assertEquals(afterRestore.slug, "local-integration-request-invalid");
    assertEquals(requests, 0);
  });

  it("canonical validation rejects invalid input despite inherited then assimilation", async () => {
    let requests = 0;
    for (
      const id of [
        "sheets__find_replace",
        "sheets__rename_sheet",
        "sheets__create_chart",
        "sheets__set_data_validation",
      ]
    ) {
      const definition = getConnector("sheets")?.tools.find((tool) => tool.id === id)?.endpoint;
      assert(definition);
      const invoke = async () => {
        try {
          await executeLocalIntegrationEndpoint({
            connectorName: "sheets",
            toolId: id,
            endpoint: definition,
            args: { spreadsheetId: "spreadsheet-example", requests: [] },
            authHeaders: {},
            allowedOrigin: "https://sheets.googleapis.com",
            transport: () => {
              requests++;
              return Promise.resolve(new Response("{}"));
            },
          });
          return "accepted";
        } catch (error) {
          return error instanceof VeryfrontError ? error.slug : "unexpected";
        }
      };
      assertEquals(await invoke(), "local-integration-request-invalid");
      const original = Object.getOwnPropertyDescriptor(Object.prototype, "then");
      let result: unknown;
      try {
        Object.defineProperty(Object.prototype, "then", {
          configurable: true,
          value(this: object, resolve: (value: unknown) => void) {
            resolve(Object.assign(Object.create(null), this, { success: true }));
          },
        });
        result = await invoke();
      } finally {
        if (original) Object.defineProperty(Object.prototype, "then", original);
        else Reflect.deleteProperty(Object.prototype, "then");
      }
      assertEquals(result, "local-integration-request-invalid");
    }
    assertEquals(requests, 0);
  });
  it("rejects asynchronous canonical validators before transport under then poisoning", async () => {
    const { register } = await import("#veryfront/extensions/contracts.ts");
    const { resolveSchemaValidator } = await import("#veryfront/schemas/define.ts");
    const originalAdapter = resolveSchemaValidator();
    const template = getConnector("sheets")?.tools.find((tool) =>
      tool.id === "sheets__find_replace"
    )?.endpoint;
    assert(template);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, "then");
    register("SchemaValidator", {
      ...originalAdapter,
      compileJsonSchema: () => async () => {
        await barrier;
        return { success: false as const, errors: [] };
      },
    });
    let result: unknown;
    try {
      const pending = executeLocalIntegrationEndpoint({
        connectorName: "sheets",
        toolId: "sheets__find_replace",
        endpoint: structuredClone(template),
        args: { spreadsheetId: "spreadsheet-example", requests: [] },
        authHeaders: {},
        allowedOrigin: "https://sheets.googleapis.com",
        transport: () => {
          requests++;
          return Promise.resolve(new Response("{}"));
        },
      }).then(
        () => "accepted",
        (error) => error instanceof VeryfrontError ? error.slug : "unexpected",
      );
      Object.defineProperty(Object.prototype, "then", {
        configurable: true,
        value(this: object, resolve: (value: unknown) => void) {
          resolve(Object.assign(Object.create(null), this, { success: true }));
        },
      });
      release();
      result = await pending;
    } finally {
      release();
      if (originalThen) Object.defineProperty(Object.prototype, "then", originalThen);
      else Reflect.deleteProperty(Object.prototype, "then");
      register("SchemaValidator", originalAdapter);
    }
    assertEquals(result, "local-integration-config-invalid");
    assertEquals(requests, 0);
  });
});
