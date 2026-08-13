import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { Alert, AlertContent, AlertIcon } from "./alert.tsx";

describe("Alert", () => {
  it("uses the theme foreground in both color modes", () => {
    const html = renderToString(
      <Alert variant="error">
        <AlertIcon>!</AlertIcon>
        <AlertContent>Something went wrong</AlertContent>
      </Alert>,
    );

    assertStringIncludes(html, "text-[var(--foreground)]");
    assert(
      !html.includes("dark:text-[var(--background)]"),
      "dark alerts should keep the dark theme foreground on the dark error surface",
    );
  });

  it("maps each variant to its fill + border token pair", () => {
    const variants = ["default", "warning", "error", "success"] as const;
    const tokenFor = { default: "info", warning: "warning", error: "error", success: "success" };
    for (const variant of variants) {
      const html = renderToString(<Alert variant={variant}>hi</Alert>);
      const token = tokenFor[variant];
      assertStringIncludes(html, `bg-[var(--alert-${token}-bg)]`);
      assertStringIncludes(html, `border-[var(--alert-${token}-border)]`);
    }
  });
});
