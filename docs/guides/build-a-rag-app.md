---
title: "Build a RAG app"
description: "Create a document Q&A app with uploads, embeddings, retrieval, and streamed answers."
order: 23
---

Use RAG when an agent needs to answer from your documents instead of only from
the model's training data.

Start from the `docs-agent` template, then customize the retrieval hook and
document sources.

```bash title="Terminal"
veryfront init my-rag --template docs-agent
cd my-rag
npx veryfront dev
```

## How RAG works

Veryfront splits a RAG app into three flows:

- **Ingestion**: Upload or read documents, extract text, split text into chunks,
  and store those chunks.
- **Search**: Embed the user's query and compare it with stored chunk embeddings.
- **Generation**: Add the best matching chunks to the AG-UI request before the
  agent responds.

The `docs-agent` template wires these flows with `ragStore()`,
`createUploadHandler()`, `useUploads()`, and `createAgUiHandler()`.

## Create the store

In your project root, create a shared RAG store:

```ts title="store.ts"
import { ragStore } from "veryfront/embedding";

export const store = ragStore({
  storagePath: "data/index.json",
  contentDir: "content",
});
```

In local development, `ragStore()` stores chunks and vectors in `data/index.json`.
When Veryfront Cloud bootstrap is present, it uses the Veryfront Cloud RAG
backend automatically.

Set `contentDir: "knowledge"` to index `knowledge/` instead of `content/`.

## Add upload routes

Create upload routes that share the same store:

```ts title="lib/upload-auth.ts"
export function authorizeUploads(request: Request): boolean {
  const token = Deno.env.get("UPLOAD_TOKEN");
  return token !== undefined &&
    request.headers.get("authorization") === `Bearer ${token}`;
}
```

```ts title="app/api/uploads/route.ts"
import { createUploadHandler } from "veryfront/embedding";
import { authorizeUploads } from "../../../lib/upload-auth.ts";
import { store } from "../../../store.ts";

export const { POST, GET } = createUploadHandler(store, {
  auth: { authorize: authorizeUploads },
});
```

```ts title="app/api/uploads/[id]/route.ts"
import { createUploadHandler } from "veryfront/embedding";
import { authorizeUploads } from "../../../../lib/upload-auth.ts";
import { store } from "../../../../store.ts";

export const { DELETE } = createUploadHandler(store, {
  auth: { authorize: authorizeUploads },
});
```

`POST` ingests a file, `GET` lists ingested documents, and `DELETE` removes a
document. For local-only prototypes, pass
`auth: { type: "none", allowUnauthenticated: true }` to explicitly allow
unauthenticated upload routes.

## Understand ingestion

Upload ingestion does three things:

- **Extracts text**: Text, Markdown, and MDX are read directly. CSV files are
  converted into row text with headers. PDF, DOCX, XLS, XLSX, PPTX, HTML, RTF,
  EPUB, JSON, and XML use the `DocumentExtractor` extension backed by
  `@veryfront/ext-document-kreuzberg`.
- **Chunks and embeds**: Text is split with `chunkOptions` before embedding.
  Defaults are `maxChars: 2000`, `overlap: 200`, and
  `separators: ["\n\n", "\n", " ", ""]`.
- **Stores data**: Cloud mode stores the original uploaded file as a source file
  blob under `.veryfront/rag/uploads/`. Local mode stores only the RAG index in
  `data/index.json`.

OCR is not a separate step. For scanned PDFs or image-only files, run OCR before
calling `store.ingest()`. Local mode fills embeddings on first search. Cloud
mode chunks and embeds during ingestion.

## Add bundled content ingestion

Use a separate ingestion route for files that ship with the app:

```ts title="app/api/ingest/route.ts"
import { store } from "../../../store.ts";

export async function POST() {
  await store.indexContentDir();
  return Response.json({ ok: true });
}
```

Run this route after files in `content/` change:

```bash title="Terminal"
curl -X POST http://localhost:3000/api/ingest
```

Keep indexing out of the chat request path. `indexContentDir()` reads files from
`contentDir` and skips files that are already tracked by source. Uploaded
documents do not need this call because the upload route ingests them directly.

## Add retrieval to the agent route

Use `beforeStream` to retrieve context before the agent runs:

```ts title="app/api/ag-ui/route.ts"
import { createAgUiHandler } from "veryfront/agent";
import { store } from "../../../store.ts";

export const POST = createAgUiHandler("rag", {
  beforeStream: async ({ lastUserText }) => {
    const query = lastUserText.trim();
    if (!query) return;

    const results = await store.search(query, { topK: 5 });
    if (results.length === 0) return;

    const contextBlock = results
      .map((result) => `[${result.title}] (score: ${result.score.toFixed(2)})\n${result.text}`)
      .join("\n\n---\n\n");

    return {
      prepend: [
        {
          role: "system",
          parts: [
            {
              type: "text",
              text:
                `Here are relevant documents retrieved for your question:\n\n${contextBlock}\n\n` +
                "Use these documents to answer. Cite the document title when referencing information.",
            },
          ],
        },
      ],
    };
  },
});
```

Veryfront wraps retrieved context before it reaches the model. Treat retrieved
documents as reference data, not instructions.

## Add the chat UI

Use `useUploads()` with the preset `Chat` component:

```tsx title="app/page.tsx"
"use client";

import { Chat, useChat } from "veryfront/chat";
import { useUploads } from "veryfront/embedding";

export default function RagPage() {
  const chat = useChat();
  const uploads = useUploads({ api: "/api/uploads" });

  return (
    <main>
      <Chat {...chat} showSources placeholder="Ask about your documents..." />

      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("file");
          if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
          await uploads.upload(input.files[0]);
          event.currentTarget.reset();
        }}
      >
        <input name="file" type="file" />
        <button type="submit" disabled={uploads.uploading}>
          Upload
        </button>
      </form>
    </main>
  );
}
```

The `docs-agent` template includes a fuller upload panel. Use this smaller
example when you want the minimum wiring.

## Use Veryfront Cloud mode

Set Veryfront Cloud bootstrap variables before starting the app:

```bash title="Terminal"
export VERYFRONT_API_TOKEN=<TOKEN>
export VERYFRONT_PROJECT_SLUG=<PROJECT_SLUG>
npx veryfront dev
```

With cloud bootstrap:

- `ragStore()` uses the Veryfront Cloud RAG backend.
- Generation uses Veryfront Cloud model routing.
- Embeddings use Veryfront Cloud embedding routing.
- `veryfront-cloud/openai/...` and `veryfront-cloud/google/...` models route
  through AI Gateway.

The default cloud embedding model is
`veryfront-cloud/openai/text-embedding-3-small`. Set
`VERYFRONT_DEFAULT_EMBEDDING_MODEL` to `provider/model`, such as
`google/text-embedding-004`; Cloud bootstrap routes it as
`veryfront-cloud/google/text-embedding-004`:

```bash title="Terminal"
export VERYFRONT_DEFAULT_EMBEDDING_MODEL=google/text-embedding-004
```

## Use raw Cloud APIs

Use raw Cloud APIs when you are building outside a Veryfront app or need direct
control over indexing.

The manual flow is:

1. Create or list RAG document records.
2. Split source content into chunks.
3. Generate vectors through AI Gateway or another embedding provider.
4. Store vectors with the embeddings endpoint.
5. Search with a query vector.

For Veryfront apps, prefer `ragStore()` unless you need that lower-level control.

## Verify it worked

Run `veryfront dev`, open the app, and check these behaviors:

- Upload a document. The upload route returns success and the document appears
  in the upload list.
- Index bundled files with `/api/ingest` after changing files in `content/`.
- Ask a question that depends on the document. The response cites the document
  title.
- Ask an unrelated question. The response says the retrieved context does not
  contain a clear answer.
- In cloud mode, confirm API requests use `VERYFRONT_API_TOKEN` and the target
  project slug.

If retrieval returns no results, check that the uploaded file has extractable
text and that the embedding provider is configured.

## Next

- [Build a chat UI](./chat-ui.md): Add or customize the chat surface
- [Providers](./providers.md): Configure model and embedding routing
- [CLI knowledge ingestion](./cli-knowledge-ingestion.md): Turn files into project knowledge

## Related

- [veryfront/embedding](../api-reference/veryfront/embedding.md): RAG store and upload helpers
- [veryfront/agent](../api-reference/veryfront/agent.md): AG-UI route helpers
- [veryfront/chat](../api-reference/veryfront/chat.md): Chat components and hooks
