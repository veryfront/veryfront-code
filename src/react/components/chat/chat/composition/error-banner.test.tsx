import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { ErrorBanner } from "./error-banner.tsx";

function installDom(): { restore: () => void; window: JSDOM["window"] } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const window = dom.window;
  return { window, restore: installComponentDom(dom, { windowGlobals: ["Event"] }) };
}

describe("ErrorBanner", () => {
  it("renders the error message", () => {
    const html = renderToString(<ErrorBanner error={new Error("Something went wrong")} />);
    assertStringIncludes(html, "Something went wrong");
  });

  it("omits the retry action when onRetry is absent", () => {
    const html = renderToString(<ErrorBanner error={new Error("boom")} />);
    assert(!html.includes("<button"), "no onRetry means no retry button");
  });

  it("renders a retry button with the default label and icon when onRetry is given", () => {
    const html = renderToString(<ErrorBanner error={new Error("boom")} onRetry={() => {}} />);
    assertStringIncludes(html, "<button");
    assertStringIncludes(html, "Try again");
    assertStringIncludes(html, "<svg");
  });

  it("invokes onRetry when the retry button is clicked", async () => {
    const dom = installDom();
    let root: Root | undefined;
    let calls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const createdRoot = createRoot(rootElement);
      root = createdRoot;
      flushSync(() => {
        createdRoot.render(<ErrorBanner error={new Error("boom")} onRetry={() => calls++} />);
      });

      const button = rootElement.querySelector<HTMLButtonElement>("button");
      assert(button, "retry button renders");
      flushSync(() => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));

      assertEquals(calls, 1, "clicking the retry button invokes onRetry");
    } finally {
      if (root) await unmountReactRoot(root);
      dom.restore();
    }
  });

  it("supports a custom retry label and icon override", () => {
    const html = renderToString(
      <ErrorBanner
        error={new Error("boom")}
        onRetry={() => {}}
        retryLabel="Retry now"
        icon={<span data-testid="custom-icon">!</span>}
      />,
    );
    assertStringIncludes(html, "Retry now");
    assertStringIncludes(html, "custom-icon");
  });

  it("merges a custom className onto the wrapper", () => {
    const html = renderToString(
      <ErrorBanner error={new Error("boom")} className="vf-custom-banner" />,
    );
    assertStringIncludes(html, "vf-custom-banner");
  });
});
