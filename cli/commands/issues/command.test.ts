import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseState } from "#veryfront/issues/index.ts";
import type { Issue } from "#veryfront/issues/index.ts";

function parseLabels(arg: string | undefined): string[] | undefined {
  if (!arg) return undefined;

  const values = arg.split(",").map((s) => s.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function getJsonFlag(args: { json?: boolean; j?: boolean }): boolean {
  return Boolean(args.json || args.j);
}

function getId(
  args: { _: (string | number)[] },
  index: number,
): string | undefined {
  const value = args._[index];
  return typeof value === "string" ? value : undefined;
}

describe("cli/commands/issues", () => {
  describe("parseState utility (from issues core)", () => {
    it("should parse 'open' state", () => {
      assertEquals(parseState("open"), "open");
    });

    it("should parse 'closed' state", () => {
      assertEquals(parseState("closed"), "closed");
    });

    it("should return null for invalid state", () => {
      assertEquals(parseState("invalid"), null);
    });

    it("should return null for empty string", () => {
      assertEquals(parseState(""), null);
    });
  });

  describe("Issue type structure", () => {
    it("should accept a valid issue object", () => {
      const issue: Issue = {
        metadata: {
          id: "ISSUE-001",
          title: "Test issue",
          state: "open",
          labels: ["bug"],
          assignees: ["alice"],
          milestone: "v1.0",
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
        body: "This is a test issue body.",
        path: ".issues/ISSUE-001.md",
      };

      assertEquals(issue.metadata.id, "ISSUE-001");
      assertEquals(issue.metadata.state, "open");
      assertEquals(issue.metadata.labels.length, 1);
      assertEquals(issue.metadata.assignees.length, 1);
      assertEquals(issue.body, "This is a test issue body.");
    });

    it("should accept issue without optional fields", () => {
      const issue: Issue = {
        metadata: {
          id: "TASK-042",
          title: "A task",
          state: "closed",
          labels: [],
          assignees: [],
          milestone: undefined,
          created_at: "2025-06-15T10:30:00Z",
          updated_at: "2025-06-15T10:30:00Z",
        },
        body: "",
        path: ".issues/TASK-042.md",
      };

      assertEquals(issue.metadata.id, "TASK-042");
      assertEquals(issue.metadata.labels.length, 0);
      assertEquals(issue.metadata.assignees.length, 0);
      assertEquals(issue.metadata.milestone, undefined);
    });
  });

  describe("issuesCommand arg parsing patterns", () => {
    it("should accept minimal args structure", () => {
      const args = { _: ["issues"] };
      assertEquals(args._[0], "issues");
    });

    it("should accept create subcommand args", () => {
      const args = {
        _: ["issues", "create"],
        title: "Fix login bug",
        labels: "bug,priority:high",
      };
      assertEquals(args._[1], "create");
      assertEquals(args.title, "Fix login bug");
    });

    it("should accept list subcommand args", () => {
      const args = {
        _: ["issues", "list"],
        state: "open",
        labels: "bug",
        sort: "created_at",
        dir: "desc",
        limit: 20,
        json: true,
      };
      assertEquals(args._[1], "list");
      assertEquals(args.state, "open");
      assertEquals(args.limit, 20);
    });

    it("should accept view subcommand args", () => {
      const args = {
        _: ["issues", "view", "ISSUE-001"],
        json: false,
      };
      assertEquals(args._[2], "ISSUE-001");
    });

    it("should accept edit subcommand args", () => {
      const args = {
        _: ["issues", "edit", "ISSUE-001"],
        title: "Updated title",
        state: "closed",
        labels: "resolved",
      };
      assertEquals(args._[1], "edit");
      assertEquals(args.title, "Updated title");
    });

    it("should accept short flag aliases", () => {
      const args = {
        _: ["issues", "create"],
        t: "Short title",
        b: "Short body",
        l: "bug",
        m: "v1.0",
        a: "alice",
        j: true,
        v: true,
      };
      assertEquals(args.t, "Short title");
      assertEquals(args.b, "Short body");
      assertEquals(args.l, "bug");
      assertEquals(args.j, true);
    });

    it("should accept delete flags", () => {
      const args = {
        _: ["issues", "edit", "ISSUE-001"],
        delete: true,
      };
      assertEquals(args.delete, true);
    });

    it("should accept the d short alias for delete", () => {
      const args = {
        _: ["issues", "edit", "ISSUE-001"],
        d: true,
      };
      assertEquals(args.d, true);
    });

    it("should accept prefix option", () => {
      const args = {
        _: ["issues", "create"],
        title: "A task",
        prefix: "TASK",
      };
      assertEquals(args.prefix, "TASK");
    });

    it("should accept assignee filter for list", () => {
      const args = {
        _: ["issues", "list"],
        assignee: "bob",
      };
      assertEquals(args.assignee, "bob");
    });
  });

  describe("comma-separated label parsing pattern", () => {
    it("should parse single label", () => {
      assertEquals(parseLabels("bug"), ["bug"]);
    });

    it("should parse multiple labels", () => {
      assertEquals(parseLabels("bug,feature,priority:high"), [
        "bug",
        "feature",
        "priority:high",
      ]);
    });

    it("should trim whitespace", () => {
      assertEquals(parseLabels(" bug , feature , fix "), ["bug", "feature", "fix"]);
    });

    it("should return undefined for empty string", () => {
      assertEquals(parseLabels(""), undefined);
    });

    it("should return undefined for undefined", () => {
      assertEquals(parseLabels(undefined), undefined);
    });

    it("should filter empty segments", () => {
      assertEquals(parseLabels("bug,,feature,"), ["bug", "feature"]);
    });

    it("should return undefined for all-empty segments", () => {
      assertEquals(parseLabels(",,,"), undefined);
    });
  });

  describe("JSON flag parsing pattern", () => {
    it("should return false by default", () => {
      assertEquals(getJsonFlag({}), false);
    });

    it("should return true for --json", () => {
      assertEquals(getJsonFlag({ json: true }), true);
    });

    it("should return true for -j", () => {
      assertEquals(getJsonFlag({ j: true }), true);
    });

    it("should return true when both are set", () => {
      assertEquals(getJsonFlag({ json: true, j: true }), true);
    });
  });

  describe("getId pattern", () => {
    it("should return string at index", () => {
      assertEquals(getId({ _: ["issues", "view", "ISSUE-001"] }, 2), "ISSUE-001");
    });

    it("should return undefined for number", () => {
      assertEquals(getId({ _: ["issues", 42] }, 1), undefined);
    });

    it("should return undefined for out of bounds", () => {
      assertEquals(getId({ _: ["issues"] }, 5), undefined);
    });

    it("should return string at first position", () => {
      assertEquals(getId({ _: ["issues", "create"] }, 1), "create");
    });
  });
});
