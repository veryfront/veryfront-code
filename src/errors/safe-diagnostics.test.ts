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
  snapshotThrowableDiagnosticRedactingPath,
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

  it("should keep conversion hooks from running on a non-string stack or terminal field", () => {
    let coercions = 0;
    const hostile = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        throw new Error("blocked");
      },
    };

    for (const sanitize of [sanitizeStackDiagnosticText, sanitizeTerminalDiagnosticText]) {
      for (const value of [hostile, Symbol("s"), undefined, 42]) {
        assertEquals(
          sanitize(value),
          "[REDACTED]",
          "non-string diagnostic input must be opaque",
        );
      }
    }

    assertEquals(coercions, 0, "project-owned conversion hooks must never run");
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

  it("should redact file URLs normalized through encoded dots and case variants", () => {
    for (
      const [requestedPath, diagnosticPath] of [
        [
          "file:///audit-root/project/%2e%2e/private-source-marker",
          "file:///audit-root/private-source-marker",
        ],
        [
          "file:///audit-root/project/%2E%2e/private-source-marker",
          "file:///audit-root/private-source-marker",
        ],
        [
          "file:///C:/audit-root/project/../private-source-marker",
          "file:///c:/audit-root/private-source-marker",
        ],
        [
          "file://SERVER/audit-root/project/../private-source-marker",
          "file://server/audit-root/private-source-marker",
        ],
      ] as const
    ) {
      assertEquals(
        snapshotThrowableDiagnosticRedactingPath(
          new Error(`failure ${diagnosticPath}`),
          requestedPath,
          "<absolute-path>",
        ),
        "failure <absolute-path>",
      );
    }
  });

  it("should redact the platform filesystem spelling decoded from file URLs", () => {
    for (
      const [requestedPath, diagnostic] of [
        [
          "file:///definitely-private-marker/nope",
          "ENOENT: no such file or directory, open '/definitely-private-marker/nope'",
        ],
        [
          "file:///audit-root/my%20dir/../private-source-marker",
          "ENOENT: no such file or directory, open '/audit-root/private-source-marker'",
        ],
        [
          "file://localhost/definitely-private-marker/nope",
          "ENOENT: no such file or directory, open '/definitely-private-marker/nope'",
        ],
        [
          "file:///C:/definitely-private-marker/nope",
          "ENOENT: no such file or directory, open 'C:\\definitely-private-marker\\nope'",
        ],
        [
          "file://C:/definitely-private-marker/nope",
          "ENOENT: no such file or directory, open '/C:/definitely-private-marker/nope'",
        ],
        [
          "file://C:/definitely-private-marker/nope",
          "ENOENT: no such file or directory, open 'C:\\definitely-private-marker\\nope'",
        ],
        [
          "file:///C|/definitely-private-marker/nope",
          "ENOENT: no such file or directory, open 'C:\\definitely-private-marker\\nope'",
        ],
        [
          "file:///c%7C/definitely-private-marker/nope",
          "ENOENT: no such file or directory, open 'c:\\definitely-private-marker\\nope'",
        ],
        [
          "file://server/definitely-private-marker/nope",
          "ENOENT: no such file or directory, open '\\\\server\\definitely-private-marker\\nope'",
        ],
      ] as const
    ) {
      assertEquals(
        snapshotThrowableDiagnosticRedactingPath(
          new Error(diagnostic),
          requestedPath,
          "<absolute-path>",
        ),
        "ENOENT: no such file or directory, open '<absolute-path>'",
      );
    }
  });

  it("should fall back when a diagnostic truncates the platform spelling of a file URL", () => {
    assertEquals(
      snapshotThrowableDiagnosticRedactingPath(
        new Error("ENOENT: no such file or directory, open '/definitely-private-marker/no"),
        "file:///definitely-private-marker/nope",
        "<absolute-path>",
      ),
      "Filesystem operation failed for <absolute-path>",
    );
  });

  it("should redact native paths after canonicalizing embedded file URL whitespace", () => {
    for (const whitespace of ["\t", "\n", "\r"] as const) {
      assertEquals(
        snapshotThrowableDiagnosticRedactingPath(
          new Error("ENOENT: no such file or directory, open '/private/secret/nope'"),
          `file:///private/se${whitespace}cret/nope`,
          "<absolute-path>",
        ),
        "ENOENT: no such file or directory, open '<absolute-path>'",
      );
    }
  });

  it("should normalize localhost file authorities before redacting canonical diagnostics", () => {
    for (
      const requestedPath of [
        "file://localhost/audit-root/project/../private-source-marker",
        "file://LOCALHOST/audit-root/project/%2E%2e/private-source-marker",
        "file://%6cocalhost/audit-root/project/../private-source-marker",
        "file://%4cocalhost/audit-root/project/%2E%2e/private-source-marker",
      ]
    ) {
      assertEquals(
        snapshotThrowableDiagnosticRedactingPath(
          new Error("failure file:///audit-root/private-source-marker"),
          requestedPath,
          "<absolute-path>",
        ),
        "failure <absolute-path>",
      );
    }
  });

  it("should redact the POSIX interpretation of an ambiguous double-separator path", () => {
    assertEquals(
      snapshotThrowableDiagnosticRedactingPath(
        new Error("ENOENT: no such file or directory, open '/private-source-marker'"),
        "//audit-root/../private-source-marker",
        "<absolute-path>",
      ),
      "ENOENT: no such file or directory, open '<absolute-path>'",
    );
  });

  it("should redact the canonical authority spelling produced by the file URL parser", () => {
    assertEquals(
      snapshotThrowableDiagnosticRedactingPath(
        new Error(
          "ENOENT: no such file or directory, open '\\\\127.0.0.1\\share\\private-source-marker'",
        ),
        "file://0177.0.0.1/share/private-source-marker",
        "<absolute-path>",
      ),
      "ENOENT: no such file or directory, open '<absolute-path>'",
    );
  });
});
