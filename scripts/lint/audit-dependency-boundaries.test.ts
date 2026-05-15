import { assertEquals } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  auditDependencyBoundaries,
  type DependencyBoundaryAuditIssue,
} from "./audit-dependency-boundaries.ts";

function issueMessages(issues: DependencyBoundaryAuditIssue[]): string[] {
  return issues.map((issue) => issue.message);
}

describe("auditDependencyBoundaries", () => {
  it("accepts empty core and CLI boundaries with React isolated separately", () => {
    const issues = auditDependencyBoundaries({
      generatedBy: "test",
      manifests: [
        {
          sourceLocation: "deno.json",
          group: "core",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "react/deno.json",
          group: "react",
          componentCount: 5,
          components: [
            {
              name: "@types/react",
              version: "19.2.14",
              purl: "pkg:npm/%40types/react@19.2.14",
            },
            {
              name: "@types/react-dom",
              version: "19.2.3",
              purl: "pkg:npm/%40types/react-dom@19.2.3",
            },
            {
              name: "csstype",
              version: "3.2.3",
              purl: "pkg:npm/csstype@3.2.3",
            },
            {
              name: "react",
              version: "19.2.4",
              purl: "pkg:npm/react@19.2.4",
            },
            {
              name: "react-dom",
              version: "19.2.4",
              purl: "pkg:npm/react-dom@19.2.4",
            },
          ],
        },
      ],
    });

    assertEquals(issues, []);
  });

  it("flags third-party npm components in core or CLI boundaries", () => {
    const issues = auditDependencyBoundaries({
      generatedBy: "test",
      manifests: [
        {
          sourceLocation: "deno.json",
          group: "core",
          componentCount: 1,
          components: [
            {
              name: "zod",
              version: "4.3.6",
              purl: "pkg:npm/zod@4.3.6",
            },
          ],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentCount: 1,
          components: [
            {
              name: "commander",
              version: "14.0.2",
              purl: "pkg:npm/commander@14.0.2",
            },
          ],
        },
        {
          sourceLocation: "react/deno.json",
          group: "react",
          componentCount: 5,
          components: [
            {
              name: "@types/react",
              version: "19.2.14",
              purl: "pkg:npm/%40types/react@19.2.14",
            },
            {
              name: "@types/react-dom",
              version: "19.2.3",
              purl: "pkg:npm/%40types/react-dom@19.2.3",
            },
            {
              name: "csstype",
              version: "3.2.3",
              purl: "pkg:npm/csstype@3.2.3",
            },
            {
              name: "react",
              version: "19.2.4",
              purl: "pkg:npm/react@19.2.4",
            },
            {
              name: "react-dom",
              version: "19.2.4",
              purl: "pkg:npm/react-dom@19.2.4",
            },
          ],
        },
      ],
    });

    assertEquals(issueMessages(issues), [
      "core boundary must have 0 third-party npm components, found 1: zod",
      "cli boundary must have 0 third-party npm components, found 1: commander",
    ]);
  });

  it("flags a missing or incomplete React dependency boundary", () => {
    const issues = auditDependencyBoundaries({
      generatedBy: "test",
      manifests: [
        {
          sourceLocation: "deno.json",
          group: "core",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "cli/deno.json",
          group: "cli",
          componentCount: 0,
          components: [],
        },
        {
          sourceLocation: "react/deno.json",
          group: "react",
          componentCount: 1,
          components: [
            {
              name: "react",
              version: "19.2.4",
              purl: "pkg:npm/react@19.2.4",
            },
          ],
        },
      ],
    });

    assertEquals(issueMessages(issues), [
      "react boundary is missing expected component @types/react",
      "react boundary is missing expected component @types/react-dom",
      "react boundary is missing expected component csstype",
      "react boundary is missing expected component react-dom",
    ]);
  });
});
