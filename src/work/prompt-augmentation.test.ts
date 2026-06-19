import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { work } from "./factory.ts";
import { buildWorkManifestPrompt, resolveWorkReferences } from "./prompt-augmentation.ts";
import { workRegistry } from "./registry.ts";

describe("work prompt augmentation", () => {
  it("renders Work as outcome-oriented process state", () => {
    const definition = work({
      id: "supplier-invoice-processing",
      name: "Supplier invoice processing",
      outcome: "Resolve all open supplier invoices.",
      expectations: [
        {
          id: "invoices_discovered",
          description: "Open supplier invoices have been discovered.",
        },
        {
          id: "notify_finance_team",
          description: "Finance team has been notified.",
          optional: true,
        },
      ],
    });

    const prompt = buildWorkManifestPrompt([definition]);

    assertStringIncludes(prompt, "Work is business/process state");
    assertStringIncludes(prompt, "Outcome: Resolve all open supplier invoices.");
    assertStringIncludes(prompt, "Expectations:");
    assertStringIncludes(
      prompt,
      "- notify_finance_team (optional): Finance team has been notified.",
    );
  });

  it("resolves string references through the Work registry", () => {
    workRegistry.clear();
    const definition = work({
      id: "clean-email",
      outcome: "Keep the inbox clean.",
      expectations: [
        {
          id: "spam_archived",
          description: "Spam messages are archived.",
        },
      ],
    });
    workRegistry.register(definition.id, definition);

    assertEquals(resolveWorkReferences("clean-email"), [definition]);
  });

  it("rejects missing string references", async () => {
    workRegistry.clear();
    await assertRejects(
      async () => resolveWorkReferences("missing-work"),
      Error,
      'Work "missing-work" not found',
    );
  });
});
