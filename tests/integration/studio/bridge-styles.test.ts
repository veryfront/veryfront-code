/**
 * Integration tests for Studio's overlay stylesheet injection.
 *
 * `injectOverlayStyles()` reads the ambient `document` global rather than a
 * passed-in seam, so exercising it means installing a document on `globalThis`.
 * That is a host effect and is not allowed in a colocated unit test, so these
 * two cases live here. The pure helpers it composes (`hasOverlayStyleElement`,
 * `createOverlayStyleElement`, `normalizeStyleInjectionWarningContext`) each
 * take a document argument and stay unit-tested next to the source in
 * src/studio/bridge/bridge-styles.test.ts.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OVERLAY_STYLE_ELEMENT_ID } from "#veryfront/studio/bridge/bridge-style-helpers.ts";
import { injectOverlayStyles } from "#veryfront/studio/bridge/bridge-styles.ts";

interface StyleStub {
  tagName: string;
  id: string;
  textContent: string;
  sheet: object | null;
}

interface DocumentStub {
  appended: StyleStub[];
  createElement(tagName: string): StyleStub;
  getElementById(id: string): StyleStub | null;
  head: { appendChild(style: StyleStub): void };
}

function createDocumentStub(options: { failAppend?: boolean } = {}): DocumentStub {
  const appended: StyleStub[] = [];
  return {
    appended,
    createElement(tagName: string): StyleStub {
      return { tagName: tagName.toUpperCase(), id: "", textContent: "", sheet: {} };
    },
    getElementById(id: string): StyleStub | null {
      return appended.find((style) => style.id === id) ?? null;
    },
    head: {
      appendChild(style: StyleStub): void {
        if (options.failAppend) throw new Error("blocked by CSP");
        appended.push(style);
      },
    },
  };
}

function withDocumentStub(stub: DocumentStub, run: () => void): void {
  const globalRecord = globalThis as unknown as { document?: unknown };
  const hadDocument = "document" in globalRecord;
  const previous = globalRecord.document;
  globalRecord.document = stub;
  try {
    run();
  } finally {
    if (hadDocument) globalRecord.document = previous;
    else delete globalRecord.document;
  }
}

function withWarnCapture(run: () => void): unknown[][] {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    run();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

describe("studio/bridge/bridge-styles", () => {
  it("keeps bridge init alive when the stylesheet is blocked by CSP", () => {
    const stub = createDocumentStub({ failAppend: true });
    let thrown: unknown;

    const warnings = withWarnCapture(() => {
      withDocumentStub(stub, () => {
        try {
          injectOverlayStyles();
        } catch (error) {
          thrown = error;
        }
      });
    });

    assertEquals(thrown, undefined, "a CSP-blocked stylesheet must not abort bridge init");
    assertEquals(warnings.length, 1, "a blocked stylesheet injection is warned about once");
  });

  it("injects the overlay stylesheet at most once", () => {
    const stub = createDocumentStub();

    withDocumentStub(stub, () => {
      injectOverlayStyles();
      injectOverlayStyles();
    });

    assertEquals(stub.appended.length, 1, "the overlay stylesheet is injected at most once");
    assertEquals(
      stub.appended[0]?.id,
      OVERLAY_STYLE_ELEMENT_ID,
      "the injected element carries the overlay style id",
    );
  });
});
