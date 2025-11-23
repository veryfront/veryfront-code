# Knowledge Base (RAG) Example

This example demonstrates Retrieval-Augmented Generation (RAG) using Veryfront.
It allows you to "chat with your documentation".

## Features

- **Ingestion Script**: Processes Markdown files, chunks text, and generates embeddings.
- **Local Vector Store**: Uses a simple JSON file for storing embeddings (no Vector DB required).
- **RAG Tool**: An agent tool that performs semantic search using cosine similarity.
- **Context-Aware Chat**: The agent answers questions based _only_ on the provided context.

## Setup

1. **Environment**:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```
   (OpenAI is required for generating embeddings)

2. **Install/Restore Dependencies** (if needed):
   This example uses standard `fetch` and no external vector DB libraries.

3. **Ingest Documents**:
   The example comes with sample docs in `docs/`. Run the ingestion script to create the index:
   ```bash
   deno task ingest
   ```
   This creates `knowledge.json`.

4. **Run the App**:
   ```bash
   deno task dev
   ```

5. **Chat**:
   Open http://localhost:3000 and ask questions like:
   - "How do I configure the router?"
   - "What is the difference between App and Pages router?"

## Architecture

1. **`scripts/ingest.ts`**:
   - Reads `docs/*.md`.
   - Splits content by headings/paragraphs.
   - Calls OpenAI `text-embedding-3-small` API.
   - Saves chunks + embeddings to `knowledge.json`.

2. **`app/api/chat/route.ts`**:
   - Loads `knowledge.json` into memory.
   - Defines `searchDocs` tool that:
     - Embeds the user query.
     - Calculates cosine similarity.
     - Returns top 3 matching chunks.
   - Initializes Veryfront Agent with this tool.

3. **`app/page.tsx`**:
   - Standard chat interface.

## Limitations

- In-memory vector search (suitable for small-medium documentation sets).
- Requires OpenAI API for embeddings (can be swapped for other providers).
