import { agent } from "veryfront/agent";

export default agent({
  id: "rag",
  system:
    `You answer questions using the provided documents. ` +
    `Always cite your sources by referencing the document title. ` +
    `If the search results don't contain a clear answer, say so honestly.`,
});
