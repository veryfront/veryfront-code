import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createIssueSchema,
  generateIssueId,
  isoDateSchema,
  ISSUE_PREFIXES,
  issueMetadataSchema,
  issueSchema,
  isValidIssueId,
  listIssuesSchema,
  parseIssueId,
  parseState,
  updateIssueSchema,
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

  describe("runtime input bounds", () => {
    it("rejects unsafe or unbounded issue IDs", () => {
      for (
        const id of [
          "ISSUE-9007199254740992",
          `ISSUE-${"9".repeat(100)}`,
        ]
      ) {
        assertEquals(isValidIssueId(id), false);
        assertEquals(parseIssueId(id), null);
      }
    });

    it("accepts real ISO timestamps and rejects loose Date.parse inputs", () => {
      for (
        const timestamp of [
          "2026-01-23T00:00:00Z",
          "2026-01-23T00:00:00.123Z",
          "2026-01-23T01:30:00+01:30",
        ]
      ) {
        assertEquals(isoDateSchema.parse(timestamp), timestamp);
      }

      for (
        const timestamp of [
          "01/23/2026",
          "2026-02-30T00:00:00Z",
          "2026-01-23",
          "2026-01-23T00:00:00+14:01",
        ]
      ) {
        assertThrows(() => isoDateSchema.parse(timestamp));
      }

      const metadata = {
        id: "ISSUE-001",
        title: "Timestamp ordering",
        state: "open" as const,
        labels: [],
        assignees: [],
        created_at: "2026-01-23T00:00:00.000000002Z",
        updated_at: "2026-01-23T00:00:00.000000001Z",
      };
      assertThrows(() => issueMetadataSchema.parse(metadata));
      assertEquals(
        issueMetadataSchema.parse({
          ...metadata,
          created_at: "2026-01-23T01:00:00.000000001+01:00",
        }).updated_at,
        metadata.updated_at,
      );
    });

    it("rejects blank, control-bearing, duplicate, and oversized metadata", () => {
      const base = {
        id: "ISSUE-001",
        title: "Valid",
        state: "open" as const,
        labels: ["bug"],
        assignees: ["alice"],
        created_at: "2026-01-23T00:00:00.000Z",
        updated_at: "2026-01-23T00:00:00.000Z",
      };

      for (
        const metadata of [
          { ...base, title: "   " },
          { ...base, title: "line\nbreak" },
          { ...base, title: "line\u2028break" },
          { ...base, title: "next\u0085line" },
          { ...base, title: "unpaired\uD800surrogate" },
          { ...base, labels: ["bug", "bug"] },
          { ...base, labels: [" padded"] },
          { ...base, assignees: ["alice", "alice"] },
          { ...base, milestone: "bad\u0000value" },
        ]
      ) {
        assertThrows(() => issueMetadataSchema.parse(metadata));
      }
    });

    it("bounds bodies, collections, and list limits at public schemas", () => {
      assertThrows(() =>
        createIssueSchema.parse({
          title: "Too large",
          body: "x".repeat(1_000_001),
        })
      );
      for (
        const body of [
          "terminal\u001b[31mcontrol",
          "terminal\u009b31mcontrol",
          "bare\rcarriage-return",
          "unpaired\uDC00surrogate",
        ]
      ) {
        assertThrows(() => createIssueSchema.parse({ title: "Unsafe body", body }));
      }
      for (const body of ["line one\nline two", "line one\r\nline two", "a\tcode block"]) {
        assertEquals(createIssueSchema.parse({ title: "Safe body", body }).body, body);
      }
      const validIssue = {
        metadata: {
          id: "ISSUE-001",
          title: "Valid",
          state: "open" as const,
          labels: [],
          assignees: [],
          created_at: "2026-01-23T00:00:00.000Z",
          updated_at: "2026-01-23T00:00:00.000Z",
        },
        body: "",
      };
      for (const path of ["issues/bad\u001bpath.md", "issues/bad\uD800path.md"]) {
        assertThrows(() => issueSchema.parse({ ...validIssue, path }));
      }
      assertThrows(() =>
        updateIssueSchema.parse({
          labels: Array.from({ length: 65 }, (_, index) => `label-${index}`),
        })
      );

      assertEquals(listIssuesSchema.parse({ limit: 1_000 }).limit, 1_000);
      for (const limit of [0, 1.5, 1_001, Number.POSITIVE_INFINITY]) {
        assertThrows(() => listIssuesSchema.parse({ limit }));
      }
    });

    it("rejects unknown object properties instead of silently discarding them", () => {
      assertThrows(() =>
        createIssueSchema.parse({
          title: "Known",
          unexpected: true,
        })
      );
      assertThrows(() =>
        listIssuesSchema.parse({
          state: "open",
          unexpected: true,
        })
      );
    });
  });
});
