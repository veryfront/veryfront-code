import { createChatHandler } from "veryfront/agent";
import { store } from "../../../store.ts";

export const POST = createChatHandler("rag", {
  beforeStream: async ({ lastUserText }) => {
    const query = lastUserText.trim();
    if (!query) return;

    try {
      await store.indexContentDir();
      const results = await store.search(query, { topK: 5 });
      if (results.length === 0) return;

      const contextBlock = results
        .map(
          (result) =>
            `[${result.title}] (score: ${
              result.score.toFixed(2)
            })\n${result.text}`,
        )
        .join("\n\n---\n\n");

      return {
        prepend: [
          {
            role: "system",
            parts: [
              {
                type: "text",
                text:
                  `Here are relevant documents retrieved for the user's question:\n\n${contextBlock}\n\n` +
                  "Use these documents to answer. Cite the document title when referencing information.",
              },
            ],
          },
        ],
      };
    } catch {
      // Retrieval failed — continue without extra context.
      return;
    }
  },
});
