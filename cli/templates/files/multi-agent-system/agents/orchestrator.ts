import { agent, getAgentsAsTools } from "veryfront/agent";

export default agent({
  id: "orchestrator",
  name: "Agent Team",
  description: "Coordinate research and writing agents.",
  system:
    "You coordinate a team of AI agents. " +
    "Delegate research tasks to the researcher and writing tasks to the writer. " +
    "Combine their outputs into a polished response.",
  tools: getAgentsAsTools(["researcher", "writer"]),
  maxSteps: 10,
  suggestions: {
    suggestions: [
      {
        type: "prompt",
        title: "Research a topic",
        prompt: "Research this topic and summarize the key findings: ",
      },
      {
        type: "prompt",
        title: "Write a brief",
        prompt: "Research and write a concise brief about ",
      },
    ],
  },
});
