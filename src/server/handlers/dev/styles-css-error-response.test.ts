/**
 * Regression: a stylesheet that failed to build must never look like a
 * stylesheet that succeeded.
 *
 * `/_vf_styles/styles.css` serves the preview and dev shell (production goes
 * through the release manifest or `/_vf/css/<hash>.css`). Both of its error
 * paths answer 200 `text/css`, which is the only way the browser will render
 * the diagnostic — but the outer catch used to answer with a bare comment:
 * zero rules, no visible signal, indistinguishable from a project that simply
 * has no styles. The page rendered completely unstyled and nothing in the
 * browser said why.
 *
 * @module server/handlers/dev/styles-css-error-response.test
 */

import "#veryfront/schemas/_test-setup.ts";
import "../../../html/styles-builder/__tests__/css-processor-setup.ts";

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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
import { StylesCSSHandler } from "./styles-css.handler.ts";

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
  invalidateProjectCandidateManifests(SLUG);
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
    cspUserHeader: null,
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

/** CSS text with every comment removed — what the browser would actually apply. */
function activeRules(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

/**
 * Applicable CSS with quoted strings blanked out. Diagnostic text is echoed
 * inside a `content:` string where it is inert, so only what survives *outside*
 * a string literal can actually take effect.
 */
function effectiveCSS(css: string): string {
  return activeRules(css).replace(/"(?:\\.|[^"\\])*"/g, '""');
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
    // The failure must reach the page, not just the comment block.
    assert(
      activeRules(css).length > 0,
      "a failed stylesheet must not be served as zero applicable rules",
    );
    assertStringIncludes(css, "body::before");
    assertStringIncludes(css, "CSS Error:");
    assertStringIncludes(css, "source listing exploded");
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
});
