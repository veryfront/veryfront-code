import { join } from "https://deno.land/std@0.220.0/path/mod.ts";

const DOCS_DIR = new URL("../docs", import.meta.url).pathname;
const OUTPUT_FILE = new URL("../knowledge.json", import.meta.url).pathname;

// OpenAI Embedding Configuration
const EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is required for embedding generation.");
  Deno.exit(1);
}

interface Chunk {
  id: string;
  source: string;
  content: string;
  embedding: number[];
}

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${await res.text()}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

async function main() {
  console.log(`📂 Scanning documents in ${DOCS_DIR}...`);
  const chunks: Chunk[] = [];

  for await (const entry of Deno.readDir(DOCS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      console.log(`   Processing ${entry.name}...`);
      const content = await Deno.readTextFile(join(DOCS_DIR, entry.name));

      // Simple chunking strategy: Split by double newlines (paragraphs)
      // In production, use a smarter splitter (recursive char splitter, markdown splitter)
      const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 20);

      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i]?.trim() ?? "";
        if (!paragraph) continue;

        console.log(`     - Embedding chunk ${i + 1}/${paragraphs.length}`);

        try {
          const embedding = await generateEmbedding(paragraph);
          chunks.push({
            id: `${entry.name}-${i}`,
            source: entry.name,
            content: paragraph,
            embedding,
          });
        } catch (e) {
          console.error(`     ❌ Failed to embed chunk:`, e);
        }
      }
    }
  }

  console.log(`💾 Saving ${chunks.length} vector chunks to ${OUTPUT_FILE}...`);
  await Deno.writeTextFile(OUTPUT_FILE, JSON.stringify(chunks, null, 2));
  console.log("✅ Ingestion complete!");
}

main();
