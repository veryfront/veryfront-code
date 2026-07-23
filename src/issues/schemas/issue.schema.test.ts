import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createIssueSchema,
  generateIssueId,
  ISSUE_PREFIXES,
  ISSUE_STORAGE_LIMITS,
  issueSchema,
  isValidIssueId,
  listIssuesResultSchema,
  parseIssueId,
  parseState,
} from "./issue.schema.ts";

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
        ["ISSUE-000", false], // zero is not a valid sequence number
        ["ISSUE-12345678901", false], // bounded numeric component
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
      for (const id of ["INVALID", "BUG-001", "ISSUE-000", "ISSUE-12345678901"] as const) {
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

    it("should reject unbounded existing ID collections", () => {
      const existing = Array.from(
        { length: ISSUE_STORAGE_LIMITS.maxIssues },
        (_, index) => `ISSUE-${String(index + 1).padStart(3, "0")}`,
      );
      let error: unknown;
      try {
        generateIssueId("ISSUE", existing);
      } catch (caught) {
        error = caught;
      }
      assertEquals(error instanceof RangeError, true);
    });
  });

  describe("resource bounds", () => {
    it("should reject bodies whose UTF-8 representation exceeds the byte budget", () => {
      assertEquals(
        createIssueSchema.safeParse({
          title: "Multibyte body",
          body: "😀".repeat(225_001),
        }).success,
        false,
      );
    });

    it("should reject blank, duplicate, and NUL-bearing create fields", () => {
      for (
        const input of [
          { title: "   " },
          { title: "Valid", labels: [" "] },
          { title: "Valid", labels: ["bug", "bug"] },
          { title: "Valid", assignees: ["alice", "alice"] },
          { title: "Valid", milestone: "" },
          { title: "Valid", body: "before\0after" },
        ]
      ) {
        assertEquals(createIssueSchema.safeParse(input).success, false);
      }
    });

    it("should reject line, control, and bidirectional override characters in metadata", () => {
      for (const unsafe of ["line\u0085break", "line\u2028break", "spoof\u202Etxt"]) {
        assertEquals(createIssueSchema.safeParse({ title: unsafe }).success, false);
        assertEquals(
          createIssueSchema.safeParse({ title: "Valid", labels: [unsafe] }).success,
          false,
        );
      }
    });

    it("should require the issue path to match its metadata ID", () => {
      assertEquals(
        issueSchema.safeParse({
          metadata: {
            id: "ISSUE-001",
            title: "Path invariant",
            state: "open",
            labels: [],
            assignees: [],
            created_at: "2026-01-23T00:00:00.000Z",
            updated_at: "2026-01-23T00:00:00.000Z",
          },
          body: "",
          path: "issues/ISSUE-002.md",
        }).success,
        false,
      );
    });

    it("should reject metadata updated before it was created", () => {
      assertEquals(
        issueSchema.safeParse({
          metadata: {
            id: "ISSUE-001",
            title: "Timestamp invariant",
            state: "open",
            labels: [],
            assignees: [],
            created_at: "2026-01-23T00:00:00.001Z",
            updated_at: "2026-01-23T00:00:00.000Z",
          },
          body: "",
          path: "issues/ISSUE-001.md",
        }).success,
        false,
      );
    });

    it("should represent no-limit list results beyond the explicit query limit", () => {
      const issue = {
        metadata: {
          id: "ISSUE-001",
          title: "Result",
          state: "open" as const,
          labels: [],
          assignees: [],
          created_at: "2026-01-23T00:00:00.000Z",
          updated_at: "2026-01-23T00:00:00.000Z",
        },
        body: "",
        path: "issues/ISSUE-001.md",
      };

      assertEquals(
        listIssuesResultSchema.safeParse({ issues: Array(1_001).fill(issue), total: 1_001 })
          .success,
        true,
      );
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
