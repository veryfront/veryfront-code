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

describe("attachment XML escaping after project code replaces string or regex intrinsics", () => {
  const targets = [
    { prototype: String.prototype, key: "replaceAll" },
    { prototype: String.prototype, key: "replace" },
    { prototype: RegExp.prototype, key: Symbol.replace },
  ];
  for (const { prototype, key } of targets) {
    for (const mode of ["throw", "identity"] as const) {
      it(`keeps attachment names escaped with ${String(key)} ${mode} replacement`, async () => {
        const render = () =>
          inlineRuntimeMessageFileContents(messages, () => Promise.resolve("body"));
        const expected = await render();
        const original = Object.getOwnPropertyDescriptor(prototype, key)!;
        let actual: Awaited<ReturnType<typeof render>>;
        try {
          Object.defineProperty(prototype, key, {
            ...original,
            value: function (this: string | RegExp, input: string): string {
              if (mode === "throw") throw new Error("project replaced escaping intrinsic");
              return typeof this === "string" ? this : input;
            },
          });
          actual = await render();
        } finally {
          Object.defineProperty(prototype, key, original);
        }
        assertEquals(actual, expected);
      });
    }
  }
});
