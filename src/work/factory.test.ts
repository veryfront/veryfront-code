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

      assertEquals(definition, {
        id: "supplier-invoice-processing",
        name: "Supplier invoice processing",
        outcome: "Resolve all open supplier invoices.",
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

    it("defaults the display name to the id", () => {
      const definition = work({
        id: "clean-email",
        outcome: "Keep the inbox clean.",
        acceptanceCriteria: [
          {
            id: "spam_archived",
            description: "Spam messages are archived.",
          },
        ],
      });

      assertEquals(definition.name, "clean-email");
    });

    it("rejects missing acceptance criteria", () => {
      assertThrows(
        () =>
          work({
            id: "empty-work",
            outcome: "Do something measurable.",
            acceptanceCriteria: [],
          }),
        Error,
        'Work "empty-work" must define at least one acceptance criterion.',
      );
    });

    it("rejects ids that are not path-safe single segments", () => {
      assertThrows(
        () =>
          work({
            id: "finance/invoices",
            outcome: "Process invoices.",
            acceptanceCriteria: [
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

    it("rejects duplicate acceptance criterion ids", () => {
      assertThrows(
        () =>
          work({
            id: "duplicate-criteria",
            outcome: "Resolve duplicate criteria.",
            acceptanceCriteria: [
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
        'Work "duplicate-criteria" has duplicate acceptance criterion id "done".',
      );
    });
  });
});
