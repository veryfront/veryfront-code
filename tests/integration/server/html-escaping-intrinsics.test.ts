import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { escapeHtml } from "#veryfront/utils/html-escape.ts";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";
import {
  clearProjectManifests,
  generateModulePreloadHintsFromManifest,
  recordSSRModules,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import { PageHandler } from "#veryfront/server/services/rsc/orchestrators/page-handler.ts";
import { generateErrorHTML } from "#veryfront/server/dev-server/error-overlay/html-template.ts";
import { generateErrorHtml } from "#veryfront/server/utils/error-html.ts";
import { generateMarkdownHtml } from "#veryfront/server/handlers/preview/markdown-html-generator.ts";

const input = '</script><script>alert("x")</script>&\u2028\u2029';
const project = "html-escaping-intrinsics";
const error = new Error(input);
error.stack = input;
const url = new URL("https://example.test/preview?studio_embed=true");
const request = new Request(url, { headers: { "Sec-CH-Prefers-Color-Scheme": '"dark"' } });
const cases: Array<{ name: string; render: () => string | Response }> = [
  { name: "HTML text", render: () => escapeHtml(input) },
  { name: "nonce injection", render: () => addNonceToHtmlTags("<script></script>", input) },
  {
    name: "module preloads",
    render: () => generateModulePreloadHintsFromManifest(project, "/route").join("\n"),
  },
  { name: "RSC page", render: () => new PageHandler().handle(input, new URLSearchParams(), input) },
  {
    name: "error page",
    render: () => generateErrorHtml({ statusCode: 500, title: input, message: input }),
  },
  {
    name: "error overlay",
    render: () => generateErrorHTML({ type: "runtime", error, file: input }, input, input, input),
  },
  {
    name: "markdown preview",
    render: () =>
      generateMarkdownHtml({
        rawHtml: "<p>safe</p>",
        title: input,
        description: input,
        request,
        url,
        projectId: input,
        filePath: input,
        nonce: input,
      }),
  },
];

describe("HTML escaping after project code replaces replaceAll", () => {
  for (const mode of ["throw", "identity"] as const) {
    for (const { name, render } of cases) {
      it(`preserves ${name} with a ${mode} replacement`, async () => {
        const original = Object.getOwnPropertyDescriptor(String.prototype, "replaceAll")!;
        recordSSRModules(project, "/route", ['a"<&>.js']);
        const expected = render();
        let actual: string | Response;
        try {
          Object.defineProperty(String.prototype, "replaceAll", {
            ...original,
            value: function (this: string): string {
              if (mode === "throw") throw new Error("project replaced replaceAll");
              return String(this);
            },
          });
          actual = render();
        } finally {
          Object.defineProperty(String.prototype, "replaceAll", original);
          clearProjectManifests(project);
        }
        const actualText = actual instanceof Response ? await actual.text() : actual;
        const expectedText = expected instanceof Response ? await expected.text() : expected;
        assertEquals(actualText, expectedText);
      });
    }
  }
});
