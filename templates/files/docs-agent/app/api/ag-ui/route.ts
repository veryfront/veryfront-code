import { createAgUiHandler } from "veryfront/agent";
import { store } from "../../../store.ts";

export const POST = createAgUiHandler("rag", {
  beforeStream: async ({ lastUserText }) => {
    const query = lastUserText.trim();
    if (!query) return;

    try {
      const results = await store.search(query, { topK: 5 });
      if (results.length === 0) {
        return {
          prepend: [
            {
              role: "system",
              trusted: true,
              parts: [
                {
                  type: "text",
                  text:
                    "No relevant uploaded documents were found for this question. " +
                    "Say that the uploaded documents do not contain enough information to answer, and do not cite a document title.",
                },
              ],
            },
          ],
        };
      }

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
                  `Here are relevant documents retrieved for your question:\n\n${contextBlock}\n\n` +
                  "Use these documents to answer. Cite the document title when referencing information.",
              },
            ],
          },
        ],
      };
    } catch (e) {
      console.error("[RAG] Retrieval failed:", e);
      throw new Error("Document retrieval failed. Please try again after checking uploads.");
    }
  },
});
