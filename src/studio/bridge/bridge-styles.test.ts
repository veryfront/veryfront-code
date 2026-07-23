import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createOverlayStyleElement,
  hasOverlayStyleElement,
  normalizeStyleInjectionWarningContext,
  OVERLAY_STYLE_ELEMENT_ID,
  OVERLAY_STYLE_OWNER_ATTRIBUTE,
} from "./bridge-style-helpers.ts";
import { injectOverlayStyles } from "./bridge-styles.ts";

describe("studio/bridge/bridge-style-helpers", () => {
  it("detects an attached bridge-owned style by reference", () => {
    const documentLike = {} as Document;
    const style = {
      ownerDocument: documentLike,
      isConnected: true,
      getAttribute(name: string) {
        return name === OVERLAY_STYLE_OWNER_ATTRIBUTE ? "" : null;
      },
    } as HTMLStyleElement;

    assertEquals(hasOverlayStyleElement(documentLike, style), true);
    assertEquals(hasOverlayStyleElement(documentLike, null), false);
    assertEquals(
      hasOverlayStyleElement({} as Document, style),
      false,
    );
  });

  it("creates a style element with the expected id, css, and CSP nonce", () => {
    const attributes = new Map<string, string>();
    const style = createOverlayStyleElement(
      {
        createElement(tagName: string) {
          return {
            tagName: tagName.toUpperCase(),
            id: "",
            nonce: "",
            textContent: "",
            setAttribute(name: string, value: string) {
              attributes.set(name, value);
            },
          } as HTMLStyleElement;
        },
        getElementById() {
          return null;
        },
      },
      ".vf-overlay { display: block; }",
      "request-nonce",
    );

    assertEquals(style.id, OVERLAY_STYLE_ELEMENT_ID);
    assertEquals(style.textContent, ".vf-overlay { display: block; }");
    assertEquals(style.tagName, "STYLE");
    assertEquals(style.nonce, "request-nonce");
    assertEquals(attributes.get(OVERLAY_STYLE_OWNER_ATTRIBUTE), "");
  });

  it("preserves Error instances for logger context", () => {
    const error = new Error("blocked");
    assertStrictEquals(normalizeStyleInjectionWarningContext(error), error);
  });

  it("normalizes unknown errors into loggable objects", () => {
    assertEquals(normalizeStyleInjectionWarningContext("blocked"), { error: "blocked" });
  });

  it("does not coerce object errors while normalizing logger context", () => {
    let conversionCalls = 0;
    const value = {
      toString() {
        conversionCalls++;
        return "unsafe";
      },
    };

    assertEquals(normalizeStyleInjectionWarningContext(value), {
      error: "Style injection failed",
    });
    assertEquals(conversionCalls, 0);
  });
});

describe("studio/bridge/bridge-styles", () => {
  it("does not let an unrelated element with the overlay style id suppress bridge styles", () => {
    const originalDocument = globalThis.document;
    const unrelatedElement = Object.freeze({ id: OVERLAY_STYLE_ELEMENT_ID }) as HTMLElement;
    const appendedStyles: HTMLStyleElement[] = [];
    const fakeDocument = {
      getElementById(id: string) {
        return id === OVERLAY_STYLE_ELEMENT_ID ? unrelatedElement : null;
      },
      createElement() {
        const attributes = new Map<string, string>();
        return {
          id: "",
          nonce: "",
          textContent: "",
          sheet: {},
          ownerDocument: fakeDocument,
          isConnected: false,
          setAttribute(name: string, value: string) {
            attributes.set(name, value);
          },
          getAttribute(name: string) {
            return attributes.get(name) ?? null;
          },
        } as HTMLStyleElement;
      },
      head: {
        appendChild(style: HTMLStyleElement) {
          (style as HTMLStyleElement & { isConnected: boolean }).isConnected = true;
          appendedStyles.push(style);
          return style;
        },
      },
    } as unknown as Document;

    Object.defineProperty(globalThis, "document", {
      value: fakeDocument,
      configurable: true,
    });
    try {
      const first = injectOverlayStyles();
      const second = injectOverlayStyles();

      assertStrictEquals(fakeDocument.getElementById(OVERLAY_STYLE_ELEMENT_ID), unrelatedElement);
      assertEquals(appendedStyles.length, 1);
      assertStrictEquals(first, appendedStyles[0]);
      assertStrictEquals(second, first);
      assertEquals(first?.id, "");
      assertEquals(first?.getAttribute(OVERLAY_STYLE_OWNER_ATTRIBUTE), "");
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("injects only styles for DOM owned by the current bridge", () => {
    const originalDocument = globalThis.document;
    let injectedCss = "";
    const fakeDocument = {
      getElementById() {
        return null;
      },
      createElement() {
        const attributes = new Map<string, string>();
        return {
          id: "",
          nonce: "",
          textContent: "",
          sheet: {},
          setAttribute(name: string, value: string) {
            attributes.set(name, value);
          },
          getAttribute(name: string) {
            return attributes.get(name) ?? null;
          },
        };
      },
      head: {
        appendChild(style: { textContent: string }) {
          injectedCss = style.textContent;
          return style;
        },
      },
    } as unknown as Document;

    Object.defineProperty(globalThis, "document", {
      value: fakeDocument,
      configurable: true,
    });
    try {
      injectOverlayStyles();

      assertEquals(injectedCss.includes(".vf-overlay"), true);
      assertEquals(injectedCss.includes(".vf-markdown-"), false);
    } finally {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });
});
