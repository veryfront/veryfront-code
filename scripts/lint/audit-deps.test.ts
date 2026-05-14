import { assertEquals } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  auditDependencyImports,
  auditEsmShPin,
  auditNpmPin,
} from "./audit-deps.ts";

describe("auditEsmShPin", () => {
  it("accepts exact x.y.z pins", () => {
    assertEquals(
      auditEsmShPin("https://esm.sh/react@19.2.4?target=es2022"),
      null,
    );
  });

  it("rejects major-only pins", () => {
    const issue = auditEsmShPin("https://esm.sh/react@19");
    assertEquals(issue?.severity, "error");
  });

  it("rejects unpinned (no version)", () => {
    const issue = auditEsmShPin("https://esm.sh/react?target=es2022");
    assertEquals(issue?.severity, "error");
  });

  it("rejects caret/tilde ranges", () => {
    const issue = auditEsmShPin("https://esm.sh/react@^19.2.4");
    assertEquals(issue?.severity, "error");
  });

  it("requires HTTPS host to be esm.sh", () => {
    const issue = auditEsmShPin("https://cdn.skypack.dev/react@19.2.4");
    assertEquals(issue?.severity, "warning");
  });

  it("returns null for non-https targets", () => {
    assertEquals(auditEsmShPin("npm:react@19.2.4"), null);
  });

  it("accepts pre-release suffixes on x.y.z pins", () => {
    assertEquals(
      auditEsmShPin("https://esm.sh/react@19.2.4-rc.1"),
      null,
    );
  });

  it("accepts scoped packages with exact pins", () => {
    assertEquals(
      auditEsmShPin("https://esm.sh/@types/react@19.2.14?deps=csstype@3.2.3"),
      null,
    );
  });

  it("rejects scoped packages with major-only pins", () => {
    const issue = auditEsmShPin(
      "https://esm.sh/@types/react@19?deps=csstype@3.2.3",
    );
    assertEquals(issue?.severity, "error");
  });
});

describe("auditNpmPin", () => {
  it("accepts exact x.y.z pins", () => {
    assertEquals(auditNpmPin("npm:react@19.2.4"), null);
  });

  it("accepts scoped packages with exact pins", () => {
    assertEquals(auditNpmPin("npm:@types/react@19.2.14"), null);
  });

  it("accepts pre-release suffixes on x.y.z pins", () => {
    assertEquals(auditNpmPin("npm:react@19.2.4-rc.1"), null);
  });

  it("accepts subpath imports after an exact pin", () => {
    assertEquals(auditNpmPin("npm:react-dom@19.2.4/server"), null);
  });

  it("rejects bare names (no version)", () => {
    const issue = auditNpmPin("npm:react");
    assertEquals(issue?.severity, "error");
  });

  it("rejects major-only pins", () => {
    const issue = auditNpmPin("npm:react@19");
    assertEquals(issue?.severity, "error");
  });

  it("rejects caret/tilde ranges", () => {
    const issue = auditNpmPin("npm:react@^19.2.4");
    assertEquals(issue?.severity, "error");
  });

  it("rejects wildcard (npm:foo@*)", () => {
    const issue = auditNpmPin("npm:react@*");
    assertEquals(issue?.severity, "error");
  });

  it("rejects scoped packages with major-only pins", () => {
    const issue = auditNpmPin("npm:@types/react@19");
    assertEquals(issue?.severity, "error");
  });

  it("returns null for non-npm targets", () => {
    assertEquals(auditNpmPin("https://esm.sh/react@19.2.4"), null);
    assertEquals(auditNpmPin("jsr:@std/assert@1.0.0"), null);
  });
});

describe("auditDependencyImports", () => {
  it("audits root and extension import maps with source locations", () => {
    const issues = auditDependencyImports([
      {
        sourceLocation: "deno.json",
        imports: {
          "react": "npm:react@19.2.4",
        },
      },
      {
        sourceLocation: "extensions/ext-example/deno.json",
        imports: {
          "zod": "npm:zod@4",
        },
      },
    ]);

    assertEquals(issues, [
      {
        sourceLocation: "extensions/ext-example/deno.json",
        specifier: "zod",
        target: "npm:zod@4",
        severity: "error",
        message: 'Unpinned npm version — specify exact x.y.z (got "4")',
      },
    ]);
  });
});
