import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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

Deno.test("Sheets find/replace schema rejects the observed unwrapped request", async () => {
  const schema = connector.tools.find((tool) => tool.id === "sheets__find_replace")?.endpoint?.body
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

Deno.test("Sheets rename schema requires the sheet ID and title field mask in their provider locations", async () => {
  const schema = connector.tools.find((tool) => tool.id === "sheets__rename_sheet")?.endpoint?.body
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

Deno.test("generated Sheets catalog preserves the nested request contracts", () => {
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

Deno.test("Sheets chart schema places the chart outside its specification and describes data series", async () => {
  const schema = connector.tools.find((tool) => tool.id === "sheets__create_chart")?.endpoint?.body
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
      series: { sourceRange: { sources: [{ ...range, startColumnIndex: 1, endColumnIndex: 2 }] } },
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
    (await validate([{ addChart: { chart: { spec: { title: "Proof", basicChart, position } } } }]))
      .success,
    false,
  );
  assertEquals(
    (await validate([{ addChart: { chart: { spec: { title: "Proof", basicChart }, position } } }]))
      .success,
    true,
  );
});

Deno.test("Sheets validation schema keeps the range inside the request and rejects invalid rule fields", async () => {
  const schema = connector.tools.find((tool) => tool.id === "sheets__set_data_validation")?.endpoint
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
    (await validate([{ setDataValidation: { range, rule, filteredRowsIncluded: true } }])).success,
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

Deno.test("published Sheets contracts validate synthetic request examples", async () => {
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
