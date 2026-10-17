import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { inlineRuntimeMessageFileContents } from "#veryfront/agent/runtime/message-file-url-refresh.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";

const messages: ChatUiMessage[] = [{
  id: "user",
  role: "user",
  parts: [{
    type: "file",
    url: "https://example.test/note.txt",
    mediaType: "text/plain",
    filename: 'name"<&>.txt',
  }],
}];

describe("attachment XML escaping after project code replaces replaceAll", () => {
  for (const mode of ["throw", "identity"] as const) {
    it(`keeps attachment names escaped with ${mode} replacement`, async () => {
      const render = () =>
        inlineRuntimeMessageFileContents(messages, () => Promise.resolve("body"));
      const expected = await render();
      const original = Object.getOwnPropertyDescriptor(String.prototype, "replaceAll")!;
      let actual: Awaited<ReturnType<typeof render>>;
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
});
