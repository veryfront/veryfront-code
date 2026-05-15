import { assertEquals } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  auditDependencyBoundaries,
  type DependencyBoundaryAuditIssue,
} from "./audit-dependency-boundaries.ts";

function issueMessages(issues: DependencyBoundaryAuditIssue[]): string[] {
  return issues.map((issue) => issue.message);
}

function sensitiveExtensionManifests() {
  return [
    {
      sourceLocation: "extensions/ext-sandbox-shell-tools/deno.json",
      group: "extension" as const,
      componentCount: 2,
      components: [
        {
          name: "bash-tool",
          version: "1.3.16",
          purl: "pkg:npm/bash-tool@1.3.16",
        },
        {
          name: "just-bash",
          version: "2.14.5",
          purl: "pkg:npm/just-bash@2.14.5",
        },
      ],
    },
    {
      sourceLocation: "extensions/ext-db-sqlite/deno.json",
      group: "extension" as const,
      componentCount: 2,
      components: [
        {
          name: "@types/better-sqlite3",
          version: "7.6.13",
          purl: "pkg:npm/%40types/better-sqlite3@7.6.13",
        },
        {
          name: "better-sqlite3",
          version: "9.6.0",
          purl: "pkg:npm/better-sqlite3@9.6.0",
        },
      ],
    },
    {
      sourceLocation: "extensions/ext-document-kreuzberg/deno.json",
      group: "extension" as const,
      componentCount: 1,
      components: [
        {
          name: "@kreuzberg/wasm",
          version: "4.5.2",
          purl: "pkg:npm/%40kreuzberg/wasm@4.5.2",
        },
      ],
    },
  ];
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
        ...sensitiveExtensionManifests(),
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
        ...sensitiveExtensionManifests(),
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
        ...sensitiveExtensionManifests(),
      ],
    });

    assertEquals(issueMessages(issues), [
      "react boundary is missing expected component @types/react",
      "react boundary is missing expected component @types/react-dom",
      "react boundary is missing expected component csstype",
      "react boundary is missing expected component react-dom",
    ]);
  });

  it("flags missing sensitive extension dependency boundaries", () => {
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
        {
          sourceLocation: "extensions/ext-sandbox-shell-tools/deno.json",
          group: "extension",
          componentCount: 1,
          components: [
            {
              name: "bash-tool",
              version: "1.3.16",
              purl: "pkg:npm/bash-tool@1.3.16",
            },
          ],
        },
      ],
    });

    assertEquals(issueMessages(issues), [
      "sensitive extension sandbox execution boundary is missing expected component just-bash",
      "sensitive extension native SQLite storage boundary is missing from dependency index",
      "sensitive extension document extraction boundary is missing from dependency index",
    ]);
  });
});
