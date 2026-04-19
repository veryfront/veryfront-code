import * as React from "react";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";

const originalWindow = (globalThis as Record<string, unknown>).window;
const originalDocument = (globalThis as Record<string, unknown>).document;

export function isSSREnvironment(): boolean {
  const globalAny = globalThis as {
    window?: Window & { __veryfrontSSRStub?: boolean };
    document?: Document & { __veryfrontSSRStub?: boolean };
  };

  return typeof window === "undefined" ||
    globalAny.window?.__veryfrontSSRStub === true ||
    globalAny.document?.__veryfrontSSRStub === true;
}

export function clientOnlyIt(itFn: (name: string, fn: () => void | Promise<void>) => void) {
  return (name: string, fn: () => void | Promise<void>): void => {
    itFn(name, () => {
      if (isSSREnvironment()) return;
      return fn();
    });
  };
}

export function renderTestComponent(Component: () => React.ReactElement): string {
  return renderToString(React.createElement(Component));
}

export function renderNode(node: ReactNode): string {
  return renderToString(node);
}

export function renderForm(Component: () => React.ReactElement): string {
  return renderToString(React.createElement("form", null, React.createElement(Component)));
}

export function withMockBrowserGlobals(fn: () => void): void {
  try {
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).document = {};
    fn();
  } finally {
    (globalThis as Record<string, unknown>).window = originalWindow;
    (globalThis as Record<string, unknown>).document = originalDocument;
  }
}
