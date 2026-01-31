import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateIssueId,
  ISSUE_PREFIXES,
  isValidIssueId,
  parseIssueId,
  parseState,
} from "./schema.ts";

describe("issues/schema", () => {
  describe("ISSUE_PREFIXES", () => {
    it("should include ISSUE, TASK, PLAN", () => {
      for (const prefix of ["ISSUE", "TASK", "PLAN"] as const) {
        assertEquals(ISSUE_PREFIXES.includes(prefix), true);
      }
    });
  });

  describe("isValidIssueId", () => {
    it("should accept valid ISSUE IDs", () => {
      for (const id of ["ISSUE-001", "ISSUE-042", "ISSUE-1000"] as const) {
        assertEquals(isValidIssueId(id), true);
      }
    });

    it("should accept valid TASK IDs", () => {
      assertEquals(isValidIssueId("TASK-001"), true);
    });

    it("should accept valid PLAN IDs", () => {
      assertEquals(isValidIssueId("PLAN-123"), true);
    });

    it("should reject invalid IDs", () => {
      const cases: Array<[string, boolean]> = [
        ["ISSUE-01", false], // too few digits
        ["BUG-001", false], // wrong prefix
        ["ISSUE001", false], // missing dash
        ["issue-001", false], // lowercase
        ["", false],
      ];

      for (const [id, expected] of cases) {
        assertEquals(isValidIssueId(id), expected);
      }
    });
  });

  describe("parseIssueId", () => {
    it("should parse valid ID into prefix and number", () => {
      const result = parseIssueId("ISSUE-042");
      assertEquals(result?.prefix, "ISSUE");
      assertEquals(result?.number, 42);
    });

    it("should parse TASK prefix", () => {
      const result = parseIssueId("TASK-100");
      assertEquals(result?.prefix, "TASK");
      assertEquals(result?.number, 100);
    });

    it("should return null for invalid IDs", () => {
      for (const id of ["INVALID", "BUG-001"] as const) {
        assertEquals(parseIssueId(id), null);
      }
    });
  });

  describe("generateIssueId", () => {
    it("should generate first ID when no existing", () => {
      assertEquals(generateIssueId("ISSUE", []), "ISSUE-001");
    });

    it("should generate next sequential ID", () => {
      assertEquals(
        generateIssueId("ISSUE", ["ISSUE-001", "ISSUE-002"]),
        "ISSUE-003",
      );
    });

    it("should handle gaps in numbering", () => {
      assertEquals(
        generateIssueId("TASK", ["TASK-001", "TASK-005"]),
        "TASK-006",
      );
    });

    it("should ignore IDs with different prefix", () => {
      assertEquals(
        generateIssueId("PLAN", ["ISSUE-001", "TASK-002"]),
        "PLAN-001",
      );
    });

    it("should pad to 3 digits", () => {
      assertEquals(generateIssueId("ISSUE", []), "ISSUE-001");
    });

    it("should handle numbers beyond 3 digits", () => {
      assertEquals(generateIssueId("ISSUE", ["ISSUE-999"]), "ISSUE-1000");
    });
  });

  describe("parseState", () => {
    it("should parse open state", () => {
      assertEquals(parseState("open"), "open");
    });

    it("should parse open aliases", () => {
      for (const state of ["opened", "active"] as const) {
        assertEquals(parseState(state), "open");
      }
    });

    it("should parse closed state", () => {
      assertEquals(parseState("closed"), "closed");
    });

    it("should parse closed aliases", () => {
      for (const state of ["close", "done", "resolved", "completed"] as const) {
        assertEquals(parseState(state), "closed");
      }
    });

    it("should be case-insensitive", () => {
      assertEquals(parseState("OPEN"), "open");
      assertEquals(parseState("Closed"), "closed");
    });

    it("should trim whitespace", () => {
      assertEquals(parseState("  open  "), "open");
    });

    it("should return null for unknown states", () => {
      for (const state of ["unknown", "pending"] as const) {
        assertEquals(parseState(state), null);
      }
    });
  });
});
