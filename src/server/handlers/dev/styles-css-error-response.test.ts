/**
 * Regression: a stylesheet that failed to build must never look like a
 * stylesheet that succeeded.
 *
 * `/_vf_styles/styles.css` serves the preview and dev shell (production goes
 * through the release manifest or `/_vf/css/<hash>.css`). Both of its error
 * paths answer 200 `text/css`, which is the only way the browser will render
 * the diagnostic. The outer catch, though, used to answer with a bare comment:
 * zero rules, no visible signal, indistinguishable from a project that simply
 * has no styles. The page rendered completely unstyled and nothing in the
 * browser said why.
 *
 * @module server/handlers/dev/styles-css-error-response.test
 */

import "#veryfront/schemas/_test-setup.ts";
import "../../../html/styles-builder/__tests__/css-processor-setup.ts";

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "../types.ts";
import {
  clearCSSCache,
  invalidateCompiler,
  invalidateProjectCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { invalidatePreparedProjectCSS } from "#veryfront/html/styles-builder/prepared-project-css-cache.ts";
import { invalidateProjectCandidateManifests } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import { invalidateProjectCandidateScans } from "./styles-candidate-scanner.ts";
import { invalidateProjectCssImportScans } from "./styles-css-import-scanner.ts";
import { renderCSSDiagnostic, StylesCSSHandler } from "./styles-css.handler.ts";

const SLUG = "styles-css-error-project";
const PAGE = {
  path: "/project/pages/index.tsx",
  content: '<div className="text-cyan-500 brand-header">Hi</div>',
};

function reset(): void {
  clearCSSCache();
  invalidateCompiler();
  invalidateProjectCSS(SLUG);
  invalidatePreparedProjectCSS(SLUG);
  invalidateProjectCandidateManifests();
  invalidateProjectCandidateScans();
  invalidateProjectCssImportScans(SLUG);
}

function makeAdapter(
  stylesheet: string,
  sourceFiles: () => Promise<Array<{ path: string; content?: string }>>,
): RuntimeAdapter {
  const base = createMockAdapter();
  base.fs.files.set("/project/globals.css", stylesheet);
  const underlying = {
    getAllSourceFiles: sourceFiles,
    getContentContext: () => null,
  };
  return {
    ...base,
    fs: { ...base.fs, getUnderlyingAdapter: () => underlying },
  } as unknown as RuntimeAdapter;
}

function makeCtx(adapter: RuntimeAdapter): HandlerContext {
  return {
    projectDir: "/project",
    adapter,
    securityConfig: null,
    projectSlug: SLUG,
    config: { tailwind: { stylesheet: "globals.css" } },
  } as unknown as HandlerContext;
}

async function serve(adapter: RuntimeAdapter): Promise<Response> {
  reset();
  try {
    const result = await new StylesCSSHandler().handle(
      new Request("http://localhost/_vf_styles/styles.css"),
      makeCtx(adapter),
    );
    assert(result.response, "handler must answer the styles route");
    return result.response;
  } finally {
    reset();
  }
}

/**
 * Scan CSS once, dropping comments and (optionally) blanking string literals.
 *
 * A regex cannot do this: the diagnostic deliberately echoes project-controlled
 * text into a `content:` string, so a payload containing comment delimiters
 * would make a naive stripper eat real rules and hide a regression.
 */
function scanCSS(css: string, blankStrings: boolean): string {
  let out = "";
  let index = 0;
  let quote: string | null = null;

  while (index < css.length) {
    const char = css[index]!;

    if (quote !== null) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
        out += blankStrings ? '""' : char;
        index++;
        continue;
      }
      if (!blankStrings) out += char;
      index++;
      continue;
    }

    if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      index = end === -1 ? css.length : end + 2;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += blankStrings ? "" : char;
      index++;
      continue;
    }

    out += char;
    index++;
  }

  return out.trim();
}

/** CSS the browser would actually apply, comments removed. */
function activeRules(css: string): string {
  return scanCSS(css, false);
}

/**
 * Applicable CSS with string literals blanked. Diagnostic text is echoed inside
 * a `content:` string where it is inert, so only what survives *outside* a
 * string literal can take effect.
 */
function effectiveCSS(css: string): string {
  return scanCSS(css, true);
}

describe("server/handlers/dev/styles-css error responses", () => {
  it("shows a visible diagnostic when the stylesheet cannot be built at all", async () => {
    // Source listing failure: reaches the handler's outermost catch, the path
    // that previously answered with a bare `/* StylesCSSHandler error: ... */`.
    const response = await serve(
      makeAdapter(
        '@import "tailwindcss";',
        () => Promise.reject(new Error("source listing exploded")),
      ),
    );
    const css = await response.text();

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
    // The failure must reach the page, not just the comment block.
    assert(
      activeRules(css).length > 0,
      "a failed stylesheet must not be served as zero applicable rules",
    );
    assertStringIncludes(css, "body::before");
    assertStringIncludes(css, "CSS Error:");
    // ...but the raw fault must not reach a shareable preview URL. This catch
    // fires on infrastructure errors whose messages carry server internals;
    // the detail belongs in the log, not the page.
    assertEquals(
      css.includes("source listing exploded"),
      false,
      "internal error text must not be disclosed in the served stylesheet",
    );
  });

  it("shows a visible diagnostic when a stylesheet uses a non-allowlisted plugin", async () => {
    const response = await serve(
      makeAdapter(
        '@import "tailwindcss";\n@plugin "some-random-plugin";\n.brand-header { color: red; }',
        () => Promise.resolve([PAGE]),
      ),
    );
    const css = await response.text();

    assertEquals(response.status, 200);
    assertStringIncludes(css, "body::before");
    assertStringIncludes(css, "some-random-plugin");
  });

  it("keeps a hostile plugin name from escaping the comment or the CSS string", async () => {
    // The plugin name is project-controlled and reaches the diagnostic text
    // verbatim, so it must not be able to close the banner comment and have
    // the remainder parsed as rules.
    const hostile = 'x*/body{display:none}/*"';
    const response = await serve(
      makeAdapter(
        `@import "tailwindcss";\n@plugin "${hostile}";`,
        () => Promise.resolve([PAGE]),
      ),
    );
    const css = await response.text();

    assertEquals(response.status, 200);
    // The name is echoed back, so the diagnostic is still useful...
    assertStringIncludes(css, "display:none");
    // ...but only ever inside a comment or a quoted string, never as a rule.
    assertEquals(
      effectiveCSS(css).includes("display:none"),
      false,
      "hostile plugin name must not survive as an applicable rule",
    );
    // The banner comment must not be closed early by the injected sequence:
    // what remains after the comment is exactly one declaration block.
    assertEquals(activeRules(css).startsWith("body::before"), true);
    assertEquals((effectiveCSS(css).match(/\{/g) ?? []).length, 1, "exactly one rule block");
  });

  it("escapes diagnostic text that would otherwise break out of the CSS string", () => {
    // No end-to-end route reaches this: a `"` inside `@plugin "..."` closes the
    // stylesheet's own string first, so the escape contract is pinned directly.
    const css = renderCSSDiagnostic("HEADING", {
      title: "T",
      message: 'a";}body{display:none}{content:"',
      suggestion: "s",
    });

    assertEquals(
      effectiveCSS(css).includes("display:none"),
      false,
      "a quote in diagnostic text must not close the content string",
    );
    assertEquals((effectiveCSS(css).match(/\{/g) ?? []).length, 1, "exactly one rule block");
    // forCSSString escapes only the double quote, so the declaration it feeds
    // must be a double-quoted string or the escape protects nothing.
    assertStringIncludes(
      css,
      'content: "CSS Error: ',
      "the diagnostic must use a double-quoted CSS string, which is the only quote forCSSString escapes",
    );

    const apostrophe = renderCSSDiagnostic("HEADING", {
      title: "T",
      message: "a';}body{display:none}{content:'",
      suggestion: "s",
    });
    assertEquals(
      effectiveCSS(apostrophe).includes("display:none"),
      false,
      "an apostrophe in diagnostic text must not close the content string",
    );
    assertEquals(
      (effectiveCSS(apostrophe).match(/\{/g) ?? []).length,
      1,
      "exactly one rule block",
    );
  });

  it("escapes a backslash so it cannot neutralize the escape added to a quote", () => {
    // The backslash must sit directly before a quote. Escaping the quote alone
    // turns `\"` into `\\"`: an escaped backslash followed by a live quote,
    // which closes the string. Only escaping the backslash first prevents it.
    const css = renderCSSDiagnostic("HEADING", {
      title: "T",
      message: 'a\\";}body{display:none}{content:"',
      suggestion: "s",
    });

    assertEquals(
      effectiveCSS(css).includes("display:none"),
      false,
      "a backslash must not neutralize the escape applied to the following quote",
    );
  });

  it("keeps newlines and control characters out of the CSS string literal", () => {
    const css = renderCSSDiagnostic("HEADING", {
      title: "T",
      message: "line\u0000one\u2028two",
      suggestion: "s",
    });
    const match = /content: "([^"]*)"/.exec(css);
    assertExists(match, "the diagnostic must emit a quoted content declaration");
    const content = match[1] ?? "";

    // deno-lint-ignore no-control-regex -- asserting control characters are absent.
    assertEquals(/[\u0000-\u001f\u2028\u2029]/.test(content), false);
    assertStringIncludes(
      content,
      "line one two",
      "control characters must be replaced by spaces, not drop the message",
    );
  });

  it("bounds diagnostic text so a pathological error cannot inline a huge stylesheet", () => {
    const css = renderCSSDiagnostic("HEADING", {
      title: "T",
      message: "x".repeat(50_000),
      suggestion: "s",
    });

    assert(css.length < 10_000, `diagnostic must stay bounded, got ${css.length}`);
  });
});
