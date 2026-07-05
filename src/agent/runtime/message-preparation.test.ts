import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { ChatUiMessage } from "../../chat/types.ts";
import { generateText } from "../../runtime/runtime-bridge.ts";
import { createGenerateModel } from "../../runtime/runtime-bridge.test-helpers.ts";
import { convertToTextGenerationRuntimeMessages } from "./text-generation-runtime-message-converter.ts";
import { prepareAgentRuntimeMessagesFromUiMessages } from "./message-preparation.ts";

function countOccurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

function userMessage(parts: ChatUiMessage["parts"]): ChatUiMessage {
  return {
    id: "message-1",
    role: "user",
    parts,
  };
}

function rejectIfStillPending<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): { promise: Promise<T>; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return {
    promise: Promise.race([promise, timeout]),
    cancel: () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

function createAbortAwarePendingFetch(requestedUrls: string[] = []): typeof fetch {
  return (input, init): Promise<Response> => {
    requestedUrls.push(input.toString());
    const signal = init?.signal;
    if (!(signal instanceof AbortSignal)) {
      return new Promise(() => {});
    }

    return new Promise((_resolve, reject) => {
      const rejectAbort = () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error("fetch aborted"));
      };
      if (signal.aborted) {
        rejectAbort();
        return;
      }
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
  };
}

Deno.test("prepareAgentRuntimeMessagesFromUiMessages returns an empty-conversation prompt", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [],
    emptyConversationPrompt: "Suggest next steps.",
  });

  assertEquals(messages[0]?.role, "user");
  assertEquals(messages[0]?.parts, [{ type: "text", text: "Suggest next steps." }]);
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages preserves source message ids", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      {
        id: "user-source-1",
        role: "user",
        parts: [{ type: "text", text: "First request" }],
      },
      {
        id: "assistant-source-1",
        role: "assistant",
        parts: [{ type: "text", text: "First answer" }],
      },
      {
        id: "user-source-2",
        role: "user",
        parts: [{ type: "text", text: "Follow up" }],
      },
    ],
  });

  assertEquals(messages.map((message) => message.id), [
    "user-source-1",
    "assistant-source-1",
    "user-source-2",
  ]);
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages refreshes upload file URLs before conversion", async () => {
  const resolvedUploadIds: string[] = [];
  const fetchedUrls: string[] = [];
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Use these files." },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          uploadId: "upload-1",
          url: "https://files.example.com/original.txt",
        },
      ]),
    ],
    resolveFileUrl: async ({ uploadId }) => {
      resolvedUploadIds.push(uploadId);
      return "https://signed.example.com/file.txt";
    },
    fetchFileContent: async ({ url }) => {
      fetchedUrls.push(url);
      return "Billing note: Order #4587 needs a refund.";
    },
  });

  assertEquals(resolvedUploadIds, ["upload-1"]);
  assertEquals(fetchedUrls, ["https://signed.example.com/file.txt"]);
  const parts = messages[0]?.parts ?? [];
  assertEquals(
    parts.some((part) =>
      part.type === "file" &&
      "url" in part &&
      part.url === "https://signed.example.com/file.txt" &&
      part.mediaType === "text/plain"
    ),
    true,
  );

  const text = parts.flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
    .join("\n");
  assertStringIncludes(text, "Use these files.");
  assertStringIncludes(text, "Order #4587");
  assertStringIncludes(text, "<uploaded_files>");
  assertStringIncludes(text, "notes.txt");
  assertStringIncludes(text, "upload-1");
  assertStringIncludes(text, "https://signed.example.com/file.txt");
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages decodes text data URL attachments into prompt content", async () => {
  const content = btoa("Inline note: Order #4587 was shipped twice.");
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Summarize the attachment." },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "billing-note.txt",
          url: `data:text/plain;base64,${content}`,
        },
      ]),
    ],
  });

  const text = (messages[0]?.parts ?? [])
    .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
    .join("\n");

  assertStringIncludes(text, "Summarize the attachment.");
  assertStringIncludes(text, "Order #4587");
  assertStringIncludes(text, "billing-note.txt");
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages does not fetch caller-controlled remote file URLs by default", async () => {
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, _init): Promise<Response> => {
    requestedUrls.push(input.toString());
    return Promise.reject(new Error("unexpected server-side attachment fetch"));
  };

  try {
    const messages = await prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        userMessage([
          { type: "text", text: "Summarize this attachment." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            url: "http://127.0.0.1:9876/internal-notes.txt",
          },
        ]),
      ],
    });

    assertEquals(requestedUrls, []);
    const text = (messages[0]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");
    assertStringIncludes(text, "Summarize this attachment.");
    assertEquals(text.includes("<file_content"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages does not fetch original upload URL when resolver cannot sign it", async () => {
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, _init): Promise<Response> => {
    requestedUrls.push(input.toString());
    return Promise.reject(new Error("unexpected unresolved upload fetch"));
  };

  try {
    const messages = await prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        userMessage([
          { type: "text", text: "Use this upload." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            uploadId: "upload-1",
            url: "http://127.0.0.1:9876/internal-notes.txt",
          },
        ]),
      ],
      resolveFileUrl: async () => undefined,
    });

    assertEquals(requestedUrls, []);
    const text = (messages[0]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");
    assertStringIncludes(text, "Use this upload.");
    assertEquals(text.includes("<file_content"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages surfaces trusted text attachment fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> =>
    Promise.reject(new Error("signed attachment unavailable"));

  try {
    await assertRejects(
      () =>
        prepareAgentRuntimeMessagesFromUiMessages({
          messages: [
            userMessage([
              { type: "text", text: "Use this upload." },
              {
                type: "file",
                mediaType: "text/plain",
                filename: "notes.txt",
                uploadId: "upload-1",
                url: "https://files.example.com/original.txt",
              },
            ]),
          ],
          resolveFileUrl: async () => "https://signed.example.com/notes.txt",
        }),
      Error,
      "signed attachment unavailable",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages surfaces trusted text attachment non-ok responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> =>
    Promise.resolve(new Response("forbidden", { status: 403, statusText: "Forbidden" }));

  try {
    await assertRejects(
      () =>
        prepareAgentRuntimeMessagesFromUiMessages({
          messages: [
            userMessage([
              { type: "text", text: "Use this upload." },
              {
                type: "file",
                mediaType: "text/plain",
                filename: "notes.txt",
                uploadId: "upload-1",
                url: "https://files.example.com/original.txt",
              },
            ]),
          ],
          resolveFileUrl: async () => "https://signed.example.com/notes.txt",
        }),
      Error,
      "Failed to fetch text attachment content for notes.txt: HTTP 403 Forbidden",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages degrades history attachment fetch failures to unavailable markers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, _init): Promise<Response> => {
    if (input.toString() === "https://signed.example.com/notes.txt") {
      return Promise.reject(new Error("signed attachment unavailable"));
    }
    return Promise.resolve(new Response("Latest attachment body.", { status: 200 }));
  };

  try {
    const messages = await prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [
            { type: "text", text: "Old question." },
            {
              type: "file",
              mediaType: "text/plain",
              filename: "notes.txt",
              uploadId: "upload-1",
              url: "https://files.example.com/notes.txt",
            },
          ],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Old answer." }],
        },
        {
          id: "user-2",
          role: "user",
          parts: [
            { type: "text", text: "New question." },
            {
              type: "file",
              mediaType: "text/plain",
              filename: "latest.txt",
              uploadId: "upload-2",
              url: "https://files.example.com/latest.txt",
            },
          ],
        },
      ],
      resolveFileUrl: async ({ uploadId }) =>
        uploadId === "upload-1"
          ? "https://signed.example.com/notes.txt"
          : "https://signed.example.com/latest.txt",
    });

    const historyText = (messages[0]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");
    assertStringIncludes(historyText, "[attachment unavailable: notes.txt]");
    assertEquals(historyText.includes("<file_content"), false);

    const newestText = (messages[2]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");
    assertStringIncludes(newestText, "Latest attachment body.");
    assertEquals(newestText.includes("[attachment unavailable"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages still propagates caller aborts for history attachment fetches", async () => {
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createAbortAwarePendingFetch(requestedUrls);
  const abortController = new AbortController();
  let cancelPendingGuard = () => {};

  try {
    const preparation = prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [
            { type: "text", text: "Old question." },
            {
              type: "file",
              mediaType: "text/plain",
              filename: "notes.txt",
              uploadId: "upload-1",
              url: "https://files.example.com/notes.txt",
            },
          ],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Old answer." }],
        },
        {
          id: "user-2",
          role: "user",
          parts: [{ type: "text", text: "Follow up." }],
        },
      ],
      resolveFileUrl: async () => "https://signed.example.com/notes.txt",
      abortSignal: abortController.signal,
    });
    const guarded = rejectIfStillPending(preparation, 50, "still pending after abort");
    cancelPendingGuard = guarded.cancel;

    abortController.abort(new Error("caller aborted"));

    await assertRejects(
      () => guarded.promise,
      Error,
      "Failed to fetch text attachment content for notes.txt: request aborted",
    );
    assertEquals(requestedUrls, ["https://signed.example.com/notes.txt"]);
  } finally {
    cancelPendingGuard();
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages allocates the aggregate inline budget newest-first", async () => {
  const contentByUrl: Record<string, string> = {
    "https://signed.example.com/a.txt": "X".repeat(180_000),
    "https://signed.example.com/b.txt": "Y".repeat(180_000),
    "https://signed.example.com/c.txt": "Z".repeat(180_000),
  };

  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      {
        id: "user-1",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "text/plain",
          filename: "a.txt",
          url: "https://signed.example.com/a.txt",
        }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Noted." }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "text/plain",
          filename: "b.txt",
          url: "https://signed.example.com/b.txt",
        }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "Noted." }],
      },
      {
        id: "user-3",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "text/plain",
          filename: "c.txt",
          url: "https://signed.example.com/c.txt",
        }],
      },
    ],
    fetchFileContent: async ({ url }) => contentByUrl[url],
  });

  const textOf = (index: number) =>
    (messages[index]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");

  const inlinedChars = (index: number, filler: string) =>
    (textOf(index).match(new RegExp(filler, "g")) ?? []).length;

  // Newest two fit fully; the oldest only gets the remaining budget.
  assertEquals(inlinedChars(4, "Z"), 180_000);
  assertEquals(inlinedChars(2, "Y"), 180_000);
  assertEquals(inlinedChars(0, "X"), 40_000);
  assertStringIncludes(textOf(0), "[Attachment content truncated]");
  assertEquals(textOf(2).includes("[Attachment content truncated]"), false);
  assertEquals(
    inlinedChars(0, "X") + inlinedChars(2, "Y") + inlinedChars(4, "Z") <= 400_000,
    true,
  );
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages omits older attachments without fetching once the inline budget is spent", async () => {
  const fetchedUrls: string[] = [];
  const contentByUrl: Record<string, string> = {
    "https://signed.example.com/a.txt": "X".repeat(250_000),
    "https://signed.example.com/b.txt": "Y".repeat(250_000),
    "https://signed.example.com/c.txt": "Z".repeat(250_000),
  };

  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      {
        id: "user-1",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "text/plain",
          filename: "a.txt",
          url: "https://signed.example.com/a.txt",
        }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Noted." }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "text/plain",
          filename: "b.txt",
          url: "https://signed.example.com/b.txt",
        }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "Noted." }],
      },
      {
        id: "user-3",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "text/plain",
          filename: "c.txt",
          url: "https://signed.example.com/c.txt",
        }],
      },
    ],
    fetchFileContent: async ({ url }) => {
      fetchedUrls.push(url);
      return contentByUrl[url];
    },
  });

  const textOf = (index: number) =>
    (messages[index]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");

  // Newest two exhaust the budget at the per-URL cap; the oldest is omitted
  // and never fetched (budget allocation intentionally skips the fetch).
  assertEquals((textOf(4).match(/Z/g) ?? []).length, 200_000);
  assertEquals((textOf(2).match(/Y/g) ?? []).length, 200_000);
  assertStringIncludes(textOf(0), "[attachment content omitted: inline budget exceeded]");
  assertEquals(textOf(0).includes("X"), false);
  assertEquals(fetchedUrls, [
    "https://signed.example.com/c.txt",
    "https://signed.example.com/b.txt",
  ]);
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages aborts stalled trusted text attachment fetches", async () => {
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createAbortAwarePendingFetch(requestedUrls);
  const abortController = new AbortController();
  let cancelPendingGuard = () => {};

  try {
    const preparation = prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        userMessage([
          { type: "text", text: "Use this upload." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            uploadId: "upload-1",
            url: "https://files.example.com/original.txt",
          },
        ]),
      ],
      resolveFileUrl: async () => "https://signed.example.com/notes.txt",
      abortSignal: abortController.signal,
    });
    const guarded = rejectIfStillPending(preparation, 50, "still pending after abort");
    cancelPendingGuard = guarded.cancel;

    abortController.abort(new Error("caller aborted"));

    await assertRejects(
      () => guarded.promise,
      Error,
      "Failed to fetch text attachment content for notes.txt: request aborted",
    );
    assertEquals(requestedUrls, ["https://signed.example.com/notes.txt"]);
  } finally {
    cancelPendingGuard();
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages times out stalled trusted text attachment fetches", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createAbortAwarePendingFetch();
  let cancelPendingGuard = () => {};

  try {
    const preparation = prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        userMessage([
          { type: "text", text: "Use this upload." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            uploadId: "upload-1",
            url: "https://files.example.com/original.txt",
          },
        ]),
      ],
      resolveFileUrl: async () => "https://signed.example.com/notes.txt",
      fileContentFetchTimeoutMs: 5,
    });
    const guarded = rejectIfStillPending(preparation, 100, "still pending after timeout");
    cancelPendingGuard = guarded.cancel;

    await assertRejects(
      () => guarded.promise,
      Error,
      "Failed to fetch text attachment content for notes.txt: request timed out after 5ms",
    );
  } finally {
    cancelPendingGuard();
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages times out stalled trusted text attachment body reads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (): Promise<Response> =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start() {
            // Leave the body open to simulate a signed URL that sends headers then stalls.
          },
        }),
        { status: 200 },
      ),
    );
  let cancelPendingGuard = () => {};

  try {
    const preparation = prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        userMessage([
          { type: "text", text: "Use this upload." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            uploadId: "upload-1",
            url: "https://files.example.com/original.txt",
          },
        ]),
      ],
      resolveFileUrl: async () => "https://signed.example.com/notes.txt",
      fileContentFetchTimeoutMs: 5,
    });
    const guarded = rejectIfStillPending(preparation, 100, "still pending after body timeout");
    cancelPendingGuard = guarded.cancel;

    await assertRejects(
      () => guarded.promise,
      Error,
      "Failed to fetch text attachment content for notes.txt: request timed out after 5ms",
    );
  } finally {
    cancelPendingGuard();
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages stops reading oversized trusted text attachment bodies at the inline cap", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const chunk = encoder.encode("x".repeat(50_000));
  const totalChunks = 6;
  let pulledChunks = 0;
  let cancelCalled = false;
  globalThis.fetch = (): Promise<Response> =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulledChunks >= totalChunks) {
              controller.close();
              return;
            }

            pulledChunks++;
            controller.enqueue(chunk);
          },
          cancel() {
            cancelCalled = true;
          },
        }, { highWaterMark: 0 }),
        { status: 200 },
      ),
    );

  try {
    const messages = await prepareAgentRuntimeMessagesFromUiMessages({
      messages: [
        userMessage([
          { type: "text", text: "Use this upload." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            uploadId: "upload-1",
            url: "https://files.example.com/original.txt",
          },
        ]),
      ],
      resolveFileUrl: async () => "https://signed.example.com/notes.txt",
    });

    assertEquals(cancelCalled, true);
    assertEquals(pulledChunks < totalChunks, true);
    const text = (messages[0]?.parts ?? [])
      .flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
      .join("\n");
    assertStringIncludes(text, "[Attachment content truncated]");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages preserves persisted uploaded image parts for vision models", async () => {
  const resolvedUploadIds: string[] = [];
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage(
        [
          { type: "text", text: "What is this?" },
          {
            type: "image",
            upload_id: "upload-image-1",
            media_type: "image/jpeg",
            url: "/api/projects/project-1/uploads/upload-image-1",
          },
        ] as unknown as ChatUiMessage["parts"],
      ),
    ],
    resolveFileUrl: async ({ uploadId }) => {
      resolvedUploadIds.push(uploadId);
      return "https://signed.example.com/web-app-screenshot.jpg";
    },
  });

  assertEquals(resolvedUploadIds, ["upload-image-1"]);
  assertEquals(messages[0]?.parts, [
    { type: "text", text: "What is this?" },
    {
      type: "image",
      url: "https://signed.example.com/web-app-screenshot.jpg",
      mediaType: "image/jpeg",
    },
    {
      type: "text",
      text: "Attached files from earlier conversation context:\n\n<uploaded_files>\n" +
        '<file name="image" upload_id="upload-image-1" url="https://signed.example.com/web-app-screenshot.jpg" type="image/jpeg" />\n' +
        "</uploaded_files>",
    },
  ]);

  const runtimeMessages = convertToTextGenerationRuntimeMessages(messages);
  const content = runtimeMessages[0]?.role === "user" ? runtimeMessages[0].content : null;
  if (!Array.isArray(content)) {
    throw new Error("Expected text-generation runtime to keep multimodal user content");
  }

  const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  assertStringIncludes(text, "What is this?");
  assertStringIncludes(text, "<uploaded_files>");
  assertEquals(
    content.some((part) =>
      part.type === "image" &&
      part.url === "https://signed.example.com/web-app-screenshot.jpg" &&
      part.mediaType === "image/jpeg"
    ),
    true,
  );
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages keeps original URL when resolver returns undefined", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Check this image." },
        {
          type: "file",
          mediaType: "image/png",
          filename: "photo.png",
          uploadId: "upload-2",
          url: "https://files.example.com/photo.png",
        },
      ]),
    ],
    resolveFileUrl: async () => undefined,
  });

  const parts = messages[0]?.parts ?? [];
  assertEquals(
    parts.some((part) =>
      part.type === "file" &&
      "url" in part &&
      part.url === "https://files.example.com/photo.png" &&
      part.mediaType === "image/png"
    ),
    true,
  );

  const text = parts.flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
    .join("\n");
  assertStringIncludes(text, "Check this image.");
  assertStringIncludes(text, "<uploaded_files>");
  assertStringIncludes(text, "photo.png");
  assertStringIncludes(text, "upload-2");
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages keeps a synthetic PDF visible through text-generation conversion", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Sent with attachments" },
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "sample-attachment.pdf",
          uploadId: "test-upload-id",
          uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          url: "/api/projects/test-project-id/uploads/test-upload-id",
        },
      ]),
    ],
    resolveFileUrl: async () => "https://signed.example.com/invoice.pdf",
  });

  const runtimeMessages = convertToTextGenerationRuntimeMessages(messages);

  assertEquals(runtimeMessages[0]?.role, "user");
  const content = runtimeMessages[0]?.content;
  if (!Array.isArray(content)) {
    throw new Error("Expected text-generation runtime user content to preserve native file parts");
  }

  const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  assertStringIncludes(text, "Sent with attachments");
  assertStringIncludes(text, "<uploaded_files>");
  assertStringIncludes(text, "sample-attachment.pdf");
  assertStringIncludes(text, "test-upload-id");
  assertStringIncludes(text, "application/pdf");
  assertStringIncludes(text, "https://signed.example.com/invoice.pdf");
  assertEquals(countOccurrences(text, "<uploaded_files>"), 1);
  assertEquals(
    content.some((part) =>
      part.type === "file" && part.url === "https://signed.example.com/invoice.pdf"
    ),
    true,
  );
});

Deno.test("chat attachment preparation keeps a synthetic PDF visible in the model prompt", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Sent with attachments" },
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "sample-attachment.pdf",
          uploadId: "test-upload-id",
          uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          url: "/api/projects/test-project-id/uploads/test-upload-id",
        },
      ]),
    ],
    resolveFileUrl: async () => "https://signed.example.com/invoice.pdf",
  });
  const runtimeMessages = convertToTextGenerationRuntimeMessages(messages);
  let sawPrompt = false;
  const model = createGenerateModel("test", "test/attachment-e2e", async (options) => {
    sawPrompt = true;
    const prompt = options.prompt;
    assertEquals(prompt.length, 1);
    const firstMessage = prompt[0];
    if (
      !firstMessage ||
      typeof firstMessage !== "object" ||
      !("role" in firstMessage) ||
      firstMessage.role !== "user" ||
      !("content" in firstMessage) ||
      !Array.isArray(firstMessage.content)
    ) {
      throw new Error("Expected a user prompt with text content parts");
    }

    const text = firstMessage.content
      .flatMap((part) =>
        part && typeof part === "object" && "type" in part && part.type === "text" &&
          "text" in part && typeof part.text === "string"
          ? [part.text]
          : []
      )
      .join("\n");

    assertStringIncludes(text, "Sent with attachments");
    assertStringIncludes(text, "<uploaded_files>");
    assertStringIncludes(text, "sample-attachment.pdf");
    assertStringIncludes(text, "test-upload-id");
    assertStringIncludes(text, "https://signed.example.com/invoice.pdf");
    assertEquals(countOccurrences(text, "<uploaded_files>"), 1);

    return {
      content: [{ type: "text", text: "I can see sample-attachment.pdf." }],
      finishReason: { unified: "stop", raw: "stop" },
    };
  });

  const result = await generateText({ model, messages: runtimeMessages });

  assertEquals(sawPrompt, true);
  assertEquals(result.text, "I can see sample-attachment.pdf.");
});
