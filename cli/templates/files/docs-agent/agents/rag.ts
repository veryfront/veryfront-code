import { agent } from "veryfront/agent";

export default agent({
  id: "rag",
  name: "Docs Agent",
  description: "Upload files and ask questions.",
  system:
    `You answer questions using the provided documents. ` +
    `Always cite your sources by referencing the document title. ` +
    `If the search results don't contain a clear answer, say so honestly.`,
  suggestions: {
    suggestions: [
      {
        type: "prompt",
        title: "Ask Question",
        prompt: "I have a question about this document: ",
      },
      {
        type: "prompt",
        title: "Extract Insights",
        prompt: "Extract the key insights from the uploaded documents.",
      },
      {
        type: "prompt",
        title: "Find Sources",
        prompt: "Find relevant sources and references in the documents for: ",
      },
    ],
  },
});
