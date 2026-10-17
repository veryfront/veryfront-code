import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import JSZip from "npm:jszip@3.10.1";
import { normalizeNewlines } from "#veryfront/utils/sse-frames.ts";
import { htmlToPlainText as confluenceText } from "../../../templates/integrations/confluence/files/lib/confluence-plain-text.ts";
import { htmlToPlainText as teamsText } from "../../../templates/integrations/teams/files/lib/teams-plain-text.ts";
import { extractNativeDocument } from "../../../extensions/ext-document-kreuzberg/src/native-extraction.ts";

const html = "<p>&quot;one&#39;s &lt;two&gt; &amp; &nbsp; three</p>";

describe("plain-text processing after project code replaces replaceAll", () => {
  for (const mode of ["throw", "identity"] as const) {
    for (const kind of ["SSE", "Confluence", "Teams", "PPTX"] as const) {
      it(`preserves ${kind} processing with ${mode} replacement`, async () => {
        const zip = new JSZip();
        zip.file("ppt/slides/slide1.xml", "<a:t>&quot;one&apos;s &lt;two&gt; &amp; three</a:t>");
        const buffer = await zip.generateAsync({ type: "arraybuffer" });
        const render = () => {
          if (kind === "SSE") return Promise.resolve(normalizeNewlines("a\r\nb\rc\r\n\r\n"));
          if (kind === "Confluence") return Promise.resolve(confluenceText(html));
          if (kind === "Teams") return Promise.resolve(teamsText(html));
          return extractNativeDocument(
            buffer,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            {
              mode: "progress",
              emitProgress: () => {},
              loadNative: () => Promise.reject(new Error("Use the XML fallback")),
            },
          );
        };
        const expected = await render();
        const original = Object.getOwnPropertyDescriptor(String.prototype, "replaceAll")!;
        let actual: string;
        try {
          Object.defineProperty(String.prototype, "replaceAll", {
            ...original,
            value: function (this: string): string {
              if (mode === "throw") throw new Error("project replaced replaceAll");
              return String(this);
            },
          });
          actual = await render();
        } finally {
          Object.defineProperty(String.prototype, "replaceAll", original);
        }
        assertEquals(actual, expected);
      });
    }
  }
});
