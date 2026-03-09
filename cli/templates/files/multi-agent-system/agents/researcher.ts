import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  system:
    "You are a research specialist. " +
    "Gather comprehensive information on the given topic. " +
    "Present findings as structured bullet points with key facts and data.",
  tools: true,
  maxSteps: 5,
});
