import { createChatHandler } from "veryfront/agent";
import { store } from "../../../store.ts";

export const POST = createChatHandler("contract-reviewer", {
  beforeStream: async ({ lastUserText }) => {
    const query = lastUserText.trim();
    if (!query) return;

    try {
      await store.indexContentDir();
      const results = await store.search(query, { topK: 8 });
      if (results.length === 0) return;

      const contextBlock = results
        .map(
          (result) =>
            `[${result.title}] (score: ${result.score.toFixed(2)})\n${result.text}`,
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
                  `Here are relevant sections from the uploaded contract(s):\n\n${contextBlock}\n\n` +
                  "Use these sections to perform your review. Reference specific clauses and section numbers.",
              },
            ],
          },
        ],
      };
    } catch (e) {
      console.error("[Contract Review] Retrieval failed:", e);
      return;
    }
  },
});
