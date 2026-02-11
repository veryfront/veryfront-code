import { agent, getAgentsAsTools } from "veryfront/agent";

export default agent({
  id: "orchestrator",
  model: "openai/gpt-4o",
  system:
    "You coordinate a team of AI agents. " +
    "Delegate research tasks to the researcher and writing tasks to the writer. " +
    "Combine their outputs into a polished response.",
  tools: getAgentsAsTools(["researcher", "writer"]),
  maxSteps: 10,
});
