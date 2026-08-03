import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ErrorBanner } from "./error-banner.tsx";

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
    assertStringIncludes(html, "Retry");
    assertStringIncludes(html, "<svg");
  });

  it("supports a custom retry label and icon override", () => {
    const html = renderToString(
      <ErrorBanner
        error={new Error("boom")}
        onRetry={() => {}}
        retryLabel="Try again"
        icon={<span data-testid="custom-icon">!</span>}
      />,
    );
    assertStringIncludes(html, "Try again");
    assertStringIncludes(html, "custom-icon");
  });

  it("merges a custom className onto the wrapper", () => {
    const html = renderToString(
      <ErrorBanner error={new Error("boom")} className="vf-custom-banner" />,
    );
    assertStringIncludes(html, "vf-custom-banner");
  });
});
