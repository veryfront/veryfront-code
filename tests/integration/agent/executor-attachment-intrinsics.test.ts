import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Message } from "#veryfront/agent/types.ts";
import { convertToTextGenerationRuntimeRequestMessages } from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";

for (const replaceMethods of [false, true]) {
  describe(`private attachment conversion ${replaceMethods ? "hooks" : "baseline"}`, () => {
    it("escapes annotations and trims assistant tails without exposing private contents", () => {
      const marker = "synthetic-private-attachment";
      const messages: Message[] = [
        {
          id: "user",
          role: "user",
          parts: [
            { type: "text", text: marker + " request" },
            {
              type: "file",
              filename: marker + '"<&>.txt',
              mediaType: "text/plain",
              url: "https://example.com/" + marker,
              uploadId: "attachment",
              uploadPath: "uploads/" + marker,
            },
          ],
        },
        { id: "assistant", role: "assistant", parts: [{ type: "text", text: marker + " tail" }] },
      ];
      const map = Array.prototype.map;
      const at = Array.prototype.at;
      const pop = Array.prototype.pop;
      const replace = String.prototype.replace;
      const trimStart = String.prototype.trimStart;
      const endsWith = String.prototype.endsWith;
      const includes = String.prototype.includes;
      const stringify = JSON.stringify;
      const apply = Reflect.apply;
      let observations = 0;
      const observe = (value: unknown) => {
        const serialized = typeof value === "string" ? value : stringify(value) ?? "";
        if (apply(includes, serialized, [marker])) observations++;
      };
      let converted: ReturnType<typeof convertToTextGenerationRuntimeRequestMessages> = [];
      try {
        if (replaceMethods) {
          Array.prototype.map = function (...args) {
            observe(this);
            return apply(map, this, args);
          };
          Array.prototype.at = function (...args) {
            observe(this);
            return apply(at, this, args);
          };
          Array.prototype.pop = function () {
            observe(this);
            return apply(pop, this, []);
          };
          String.prototype.replace = function (...args) {
            observe(this);
            return apply(replace, this, args);
          };
          String.prototype.trimStart = function () {
            observe(this);
            return apply(trimStart, this, []);
          };
          String.prototype.endsWith = function (...args) {
            observe(this);
            return apply(endsWith, this, args);
          };
        }
        converted = convertToTextGenerationRuntimeRequestMessages(messages);
      } finally {
        if (replaceMethods) {
          Array.prototype.map = map;
          Array.prototype.at = at;
          Array.prototype.pop = pop;
          String.prototype.replace = replace;
          String.prototype.trimStart = trimStart;
          String.prototype.endsWith = endsWith;
        }
      }
      assertEquals(converted.length, 1);
      assertEquals(converted[0]?.role, "user");
      const content = converted[0]?.content;
      if (!Array.isArray(content)) throw new Error("Expected native file content");
      assertEquals(content[0], { type: "text", text: marker + " request" });
      const annotation = content[2];
      if (annotation?.type !== "text") throw new Error("Expected file annotation");
      assertStringIncludes(
        annotation.text,
        'name="synthetic-private-attachment&quot;&lt;&amp;&gt;.txt"',
      );
      assertEquals(annotation.text.startsWith("<uploaded_files>"), true);
      assertEquals(messages.length, 2);
      assertEquals(observations, 0);
    });
  });
}
