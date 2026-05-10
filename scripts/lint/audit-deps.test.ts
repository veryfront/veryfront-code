import { assertEquals } from "#std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { auditEsmShPin } from "./audit-deps.ts";

describe("auditEsmShPin", () => {
  it("accepts exact x.y.z pins", () => {
    assertEquals(auditEsmShPin("https://esm.sh/react@19.2.4?target=es2022"), null);
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
    const issue = auditEsmShPin("https://esm.sh/@types/react@19?deps=csstype@3.2.3");
    assertEquals(issue?.severity, "error");
  });
});
