import { agent } from "veryfront/agent";

export default agent({
  id: "qa",
  model: "openai/gpt-4o",
  system: `You answer questions using the provided documents. Always cite your sources by referencing the document title. If the documents don't contain the answer, say so honestly.`,
  tools: true,
  maxSteps: 5,
});
