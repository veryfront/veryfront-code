import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import type { ChatUiMessage } from "./types.ts";
import {
  normalizeMessageFilePartMediaTypes,
  rewriteUnsupportedFilePartsAsAnnotations,
} from "./message-file-parts.ts";

const browserTypedCode = {
  type: "file" as const,
  mediaType: "video/mp2t",
  filename: "app.ts",
  url: "data:video/mp2t;base64,Y29uc3Q=",
};
const normalizedCode = {
  ...browserTypedCode,
  mediaType: "text/plain",
  url: "data:text/plain;base64,Y29uc3Q=",
};

Deno.test("normalizeMessageFilePartMediaTypes rewrites an inline data URL to the normalized MIME type", () => {
  const messages: ChatUiMessage[] = [{ id: "u", role: "user", parts: [browserTypedCode] }];
  assertEquals(normalizeMessageFilePartMediaTypes(messages)[0]!.parts, [normalizedCode]);
});

Deno.test("rewriteUnsupportedFilePartsAsAnnotations keeps a normalized inline file for the provider", () => {
  const messages: ChatUiMessage[] = [{ id: "u", role: "user", parts: [browserTypedCode] }];
  const prepared = rewriteUnsupportedFilePartsAsAnnotations(
    normalizeMessageFilePartMediaTypes(messages),
  );
  assertEquals(prepared[0]!.parts, [normalizedCode]);
});

Deno.test("rewriteUnsupportedFilePartsAsAnnotations annotates inline files outside user messages", () => {
  const audio = {
    type: "file" as const,
    mediaType: "audio/mpeg",
    filename: "memo.mp3",
    url: "data:audio/mpeg;base64,SUQz",
  };
  const messages: ChatUiMessage[] = [{ id: "a", role: "assistant", parts: [audio] }];
  const parts = rewriteUnsupportedFilePartsAsAnnotations(messages)[0]!.parts;
  assertEquals(parts.some((part) => part.type === "file"), false);
  assertEquals(parts.length, 1);
  const text = parts[0]!.type === "text" ? parts[0]!.text : "";
  assertEquals(text.includes("memo.mp3"), true);
  assertEquals(text.includes("SUQz"), false, "base64 must not become prompt text");
});
