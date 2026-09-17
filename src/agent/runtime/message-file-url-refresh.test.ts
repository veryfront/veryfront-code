import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage } from "../../chat/types.ts";
import { composeAbortSignals, resolveRuntimeMessageFileUrls } from "./message-file-url-refresh.ts";

function userMessage(parts: ChatUiMessage["parts"]): ChatUiMessage {
  return {
    id: "message-1",
    role: "user",
    parts,
  };
}

Deno.test("resolveRuntimeMessageFileUrls refreshes upload file URLs once", async () => {
  const resolvedUploadIds: string[] = [];
  const messages = await resolveRuntimeMessageFileUrls(
    [
      userMessage([
        { type: "text", text: "Use these files." },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          uploadId: "upload-1",
          uploadPath: "_chat/user/notes.txt",
          url: "https://files.example.com/original.txt",
        },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "copy.txt",
          uploadId: "upload-1",
          url: "https://files.example.com/copy.txt",
        },
      ]),
    ],
    async ({ uploadId }) => {
      resolvedUploadIds.push(uploadId);
      return "https://signed.example.com/file.txt";
    },
  );

  assertEquals(resolvedUploadIds, ["upload-1"]);
  assertEquals(messages[0]?.parts, [
    { type: "text", text: "Use these files." },
    {
      type: "file",
      mediaType: "text/plain",
      filename: "notes.txt",
      uploadId: "upload-1",
      uploadPath: "_chat/user/notes.txt",
      url: "https://signed.example.com/file.txt",
    },
    {
      type: "file",
      mediaType: "text/plain",
      filename: "copy.txt",
      uploadId: "upload-1",
      url: "https://signed.example.com/file.txt",
    },
  ], "a refreshed upload must keep its storage path alongside the new url");
});

it("resolveRuntimeMessageFileUrls canonicalizes a snake_case upload_path", async () => {
  const messages = await resolveRuntimeMessageFileUrls(
    [
      userMessage([
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          uploadId: "upload-1",
          upload_path: "_chat/user/notes.txt",
          url: "https://files.example.com/original.txt",
        } as unknown as ChatUiMessage["parts"][number],
      ]),
    ],
    () => Promise.resolve("https://signed.example.com/file.txt"),
  );

  assertEquals(messages[0]?.parts, [
    {
      type: "file",
      mediaType: "text/plain",
      filename: "notes.txt",
      uploadId: "upload-1",
      uploadPath: "_chat/user/notes.txt",
      url: "https://signed.example.com/file.txt",
    },
  ], "a snake_case upload_path must be carried forward as the canonical uploadPath");
});

Deno.test("resolveRuntimeMessageFileUrls keeps existing parts when resolver returns no URL", async () => {
  const messages = [
    userMessage([
      {
        type: "file",
        mediaType: "text/plain",
        filename: "notes.txt",
        uploadId: "upload-1",
        uploadPath: "_chat/user/notes.txt",
        url: "https://files.example.com/original.txt",
      },
    ]),
  ];

  const resolved = await resolveRuntimeMessageFileUrls(
    messages,
    () => Promise.resolve(undefined),
  );

  assertEquals(resolved[0]?.parts, [
    {
      type: "file",
      mediaType: "text/plain",
      filename: "notes.txt",
      uploadId: "upload-1",
      uploadPath: "_chat/user/notes.txt",
      url: "https://files.example.com/original.txt",
    },
  ], "an unresolved upload must keep its storage path");
});

Deno.test("composeAbortSignals aborts immediately when a source signal is already aborted", () => {
  const alreadyAborted = new AbortController();
  const reason = new Error("already aborted");
  alreadyAborted.abort(reason);
  const pending = new AbortController();

  const signal = composeAbortSignals([pending.signal, alreadyAborted.signal]);

  assertEquals(signal.aborted, true);
  assertEquals(signal.reason, reason);
});

Deno.test("composeAbortSignals propagates aborts from any source signal", () => {
  const first = new AbortController();
  const second = new AbortController();

  const signal = composeAbortSignals([first.signal, second.signal]);
  assertEquals(signal.aborted, false);

  const reason = new Error("second source aborted");
  second.abort(reason);

  assertEquals(signal.aborted, true);
  assertEquals(signal.reason, reason);
});

Deno.test("resolveRuntimeMessageFileUrls degrades an unresolvable attachment instead of failing the turn", async () => {
  const reported: { uploadId: string; filename?: string; mediaType?: string }[] = [];

  const messages = await resolveRuntimeMessageFileUrls(
    [
      userMessage([
        { type: "text", text: "Use this file." },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          uploadId: "upload-denied",
          uploadPath: "_chat/user/notes.txt",
          url: "https://files.example.com/expired.txt",
        },
      ]),
    ],
    ({ uploadId }) => {
      return Promise.reject(
        new Error(`Failed to fetch signed upload URL for ${uploadId}: Access denied`),
      );
    },
    {
      onUnresolvableAttachment: ({ uploadId, filename, mediaType }) => {
        reported.push({
          uploadId,
          ...(filename ? { filename } : {}),
          ...(mediaType ? { mediaType } : {}),
        });
      },
    },
  );

  assertEquals(
    messages[0]?.parts,
    [
      { type: "text", text: "Use this file." },
      {
        type: "file",
        mediaType: "text/plain",
        filename: "notes.txt",
        uploadId: "upload-denied",
        uploadPath: "_chat/user/notes.txt",
      },
      { type: "text", text: "[attachment unavailable: notes.txt]" },
    ] as unknown as ChatUiMessage["parts"],
    "an unresolvable upload must drop its dead url and leave a note beside it",
  );
  assertEquals(reported, [{
    uploadId: "upload-denied",
    filename: "notes.txt",
    mediaType: "text/plain",
  }]);
});

Deno.test("resolveRuntimeMessageFileUrls reports an unresolvable upload once per upload", async () => {
  const reportedUploadIds: string[] = [];
  let resolverCalls = 0;

  const messages = await resolveRuntimeMessageFileUrls(
    [
      userMessage([
        {
          type: "file",
          mediaType: "text/plain",
          uploadId: "upload-denied",
          url: "https://files.example.com/a.txt",
        },
        {
          type: "image",
          mediaType: "image/png",
          uploadId: "upload-denied",
          url: "https://files.example.com/b.png",
        } as unknown as ChatUiMessage["parts"][number],
      ]),
    ],
    () => {
      resolverCalls++;
      return Promise.reject(new Error("Access denied"));
    },
    {
      onUnresolvableAttachment: ({ uploadId }) => {
        reportedUploadIds.push(uploadId);
      },
    },
  );

  assertEquals(resolverCalls, 1);
  assertEquals(reportedUploadIds, ["upload-denied"]);
  assertEquals(
    messages[0]?.parts,
    [
      { type: "file", mediaType: "text/plain", uploadId: "upload-denied" },
      { type: "text", text: "[attachment unavailable: upload-denied]" },
      { type: "image", mediaType: "image/png", uploadId: "upload-denied" },
      { type: "text", text: "[attachment unavailable: upload-denied]" },
    ] as unknown as ChatUiMessage["parts"],
    "an unresolvable image part must degrade the same way a file part does",
  );
});

Deno.test("resolveRuntimeMessageFileUrls still refreshes readable uploads when one is denied", async () => {
  const messages = await resolveRuntimeMessageFileUrls(
    [
      userMessage([
        {
          type: "file",
          mediaType: "text/plain",
          filename: "denied.txt",
          uploadId: "upload-denied",
          url: "https://files.example.com/denied.txt",
        },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "ok.txt",
          uploadId: "upload-ok",
          url: "https://files.example.com/ok.txt",
        },
      ]),
    ],
    ({ uploadId }) => {
      if (uploadId === "upload-denied") {
        return Promise.reject(new Error("Access denied"));
      }
      return Promise.resolve("https://signed.example.com/ok.txt");
    },
  );

  assertEquals(
    messages[0]?.parts,
    [
      {
        type: "file",
        mediaType: "text/plain",
        filename: "denied.txt",
        uploadId: "upload-denied",
      },
      { type: "text", text: "[attachment unavailable: denied.txt]" },
      {
        type: "file",
        mediaType: "text/plain",
        filename: "ok.txt",
        uploadId: "upload-ok",
        url: "https://signed.example.com/ok.txt",
      },
    ] as unknown as ChatUiMessage["parts"],
    "a denied upload must not stop a readable upload from being refreshed",
  );
});

Deno.test("resolveRuntimeMessageFileUrls rethrows an unresolvable attachment when the caller aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller aborted"));

  await assertRejects(
    () =>
      resolveRuntimeMessageFileUrls(
        [
          userMessage([
            {
              type: "file",
              mediaType: "text/plain",
              filename: "notes.txt",
              uploadId: "upload-denied",
              url: "https://files.example.com/notes.txt",
            },
          ]),
        ],
        () => Promise.reject(new Error("Access denied")),
        { abortSignal: controller.signal },
      ),
    Error,
    "Access denied",
  );
});

// Codex P2 on veryfront-code#4513: a resolver can fail before it returns a
// promise -- synchronous validation, client setup -- and that throw used to
// escape the degrade and fail the turn, which is the bug #1414 is about.
Deno.test("resolveRuntimeMessageFileUrls degrades a resolver that throws synchronously", async () => {
  const reported: string[] = [];
  const messages = await resolveRuntimeMessageFileUrls(
    [
      userMessage([
        { type: "text", text: "Summarize this." },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          uploadId: "upload-sync-throw",
          url: "https://files.example.com/notes.txt",
        },
      ]),
    ],
    () => {
      throw new Error("resolver misconfigured");
    },
    { onUnresolvableAttachment: ({ uploadId }) => reported.push(uploadId) },
  );

  // The turn survives and the model is told the file was there.
  assertEquals(reported, ["upload-sync-throw"]);
  const texts = messages[0]?.parts.filter((part) => part.type === "text").map((part) =>
    (part as { text: string }).text
  );
  assertEquals(texts?.includes("[attachment unavailable: notes.txt]"), true);
});
