import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildErrorDocsUrl,
  ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  ERROR_DOCS_BASE_URL,
  ERROR_DOCS_SLUG_MAX_LENGTH_CHARS,
  ERROR_STACK_MAX_LENGTH_CHARS,
  sanitizeDiagnosticText,
  sanitizeStackDiagnosticText,
  sanitizeTerminalDiagnosticText,
  snapshotErrorForBoundary,
} from "./safe-diagnostics.ts";
import { VeryfrontError } from "./types.ts";

/** Path of the page error slugs anchor into; a slug must never change it. */
const ERROR_DOCS_PATHNAME = new URL(ERROR_DOCS_BASE_URL).pathname;

describe("safe-diagnostics", () => {
  it("should neutralize terminal controls and line injection in one diagnostic field", () => {
    const malicious = "before\x1b]2;owned\x07\x1b[2J\nFAKE SUCCESS";

    assertEquals(
      sanitizeTerminalDiagnosticText(malicious),
      "before FAKE SUCCESS",
    );
  });

  it("should redact credentials while neutralizing terminal controls", () => {
    const malicious = "Authorization: Bearer secret\x1b[2J\rforged";
    const sanitized = sanitizeTerminalDiagnosticText(malicious);

    assertEquals(sanitized.includes("secret"), false);
    assertEquals(sanitized.includes("\x1b[2J"), false);
    assertEquals(sanitized.includes("\r"), false);
  });

  it("should encode a hostile slug as one credential-scrubbed docs fragment", () => {
    const docsUrl = buildErrorDocsUrl(
      "../admin/path?token=secret#fragment%value\ud800",
    );
    const parsed = new URL(docsUrl);

    assertEquals(
      docsUrl,
      `${ERROR_DOCS_BASE_URL}..%2Fadmin%2Fpath%3Ftoken%3D%5BREDACTED%5D%23fragment%25value%EF%BF%BD`,
    );
    // The slug is confined to the fragment: it cannot traverse to another
    // path, open a query, or start a second fragment.
    assertEquals(parsed.search, "");
    assertEquals(parsed.pathname, ERROR_DOCS_PATHNAME);
    assertEquals(
      parsed.hash,
      "#..%2Fadmin%2Fpath%3Ftoken%3D%5BREDACTED%5D%23fragment%25value%EF%BF%BD",
    );
    assertEquals(docsUrl.includes("secret"), false);
  });

  it("should keep exact dot segments under the error-docs path", () => {
    for (const slug of [".", ".."]) {
      const docsUrl = buildErrorDocsUrl(slug);
      const parsed = new URL(docsUrl);

      assertEquals(
        docsUrl,
        `${ERROR_DOCS_BASE_URL}unknown-error`,
      );
      assertEquals(parsed.pathname, ERROR_DOCS_PATHNAME);
    }
  });

  it("should align the bounded boundary slug with its docs fragment", () => {
    const error = new VeryfrontError("Vendor error", {
      slug: `vendor-${"x".repeat(ERROR_DOCS_SLUG_MAX_LENGTH_CHARS + 100)}`,
      category: "GENERAL",
      status: 500,
      title: "Vendor error",
    });
    const snapshot = snapshotErrorForBoundary(error);
    const docsFragment = new URL(buildErrorDocsUrl(error.slug)).hash.slice(1);

    assertEquals(snapshot.slug.length, ERROR_DOCS_SLUG_MAX_LENGTH_CHARS);
    assertEquals(decodeURIComponent(docsFragment), snapshot.slug);
  });

  it("should preserve an explicit CLI exit code at the boundary", () => {
    const error = new VeryfrontError("Invalid argument", {
      slug: "invalid-argument",
      category: "GENERAL",
      status: 400,
      title: "Invalid argument",
      exitCode: 2,
    });

    assertEquals(snapshotErrorForBoundary(error).exitCode, 2);
  });

  it("should replace either kind of lone surrogate without throwing", () => {
    for (const slug of ["high-\ud800", "low-\udfff"]) {
      assertEquals(buildErrorDocsUrl(slug).endsWith("%EF%BF%BD"), true);
    }
  });

  it("should redact the complete diagnostic before applying its field bound", () => {
    const prefix = "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS - 96);
    const value = `${prefix} postgres://admin:super-secret-value@db.internal/app${"z".repeat(100)}`;
    const sanitized = sanitizeDiagnosticText(value);

    assertEquals(sanitized.length, ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assert(sanitized.includes("postgres://admin:[REDACTED]@db.internal/app"));
    assertEquals(sanitized.includes("super-secret-value"), false);
    assert(sanitized.endsWith("...[truncated]"));
  });

  it("should neutralize an escape sequence cut by the terminal field bound", () => {
    const prefix = "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS - 20);
    const sanitized = sanitizeTerminalDiagnosticText(
      `${prefix}\x1b[38;2;255;0;0m${"y".repeat(100)}`,
    );

    assert(sanitized.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS);
    assertEquals(sanitized.includes("\x1b"), false);
    assert(sanitized.endsWith("...[truncated]"));
  });

  it("should apply the separate shared stack bound", () => {
    const stack = sanitizeStackDiagnosticText(
      `Error: failed\n${"x".repeat(ERROR_STACK_MAX_LENGTH_CHARS + 100)}`,
    );

    assertEquals(stack.length, ERROR_STACK_MAX_LENGTH_CHARS);
    assert(stack.endsWith("...[truncated]"));
  });
});
