import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { work } from "./factory.ts";

describe("work factory", () => {
  describe("work()", () => {
    it("creates a source-backed Work definition", () => {
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

      assertEquals(definition, {
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
        acceptanceCriteria: [
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
    });

    it("accepts legacy acceptanceCriteria as an alias", () => {
      const definition = work({
        id: "supplier-invoice-processing",
        name: "Supplier invoice processing",
        outcome: "Resolve all open supplier invoices.",
        acceptanceCriteria: [
          {
            id: "invoices_discovered",
            description: "Open supplier invoices have been discovered.",
          },
        ],
      });

      assertEquals(definition.expectations, [
        {
          id: "invoices_discovered",
          description: "Open supplier invoices have been discovered.",
        },
      ]);
      assertEquals(definition.acceptanceCriteria, definition.expectations);
    });

    it("defaults the display name to the id", () => {
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

      assertEquals(definition.name, "clean-email");
    });

    it("rejects missing expectations", () => {
      assertThrows(
        () =>
          work({
            id: "empty-work",
            outcome: "Do something measurable.",
            expectations: [],
          }),
        Error,
        'Work "empty-work" must define at least one expectation.',
      );
    });

    it("rejects ids that are not path-safe single segments", () => {
      assertThrows(
        () =>
          work({
            id: "finance/invoices",
            outcome: "Process invoices.",
            expectations: [
              {
                id: "done",
                description: "Done.",
              },
            ],
          }),
        Error,
        "Work id must be a path-safe single segment",
      );
    });

    it("rejects duplicate expectation ids", () => {
      assertThrows(
        () =>
          work({
            id: "duplicate-criteria",
            outcome: "Resolve duplicate criteria.",
            expectations: [
              {
                id: "done",
                description: "Done once.",
              },
              {
                id: "done",
                description: "Done twice.",
              },
            ],
          }),
        Error,
        'Work "duplicate-criteria" has duplicate expectation id "done".',
      );
    });
  });
});
