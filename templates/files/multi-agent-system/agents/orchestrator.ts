import { agent, getAgentsAsTools } from "veryfront/agent";

export default agent({
  id: "orchestrator",
  name: "Agent Team",
  description: "Coordinate research and writing agents.",
  system:
    "You coordinate a team of AI agents. " +
    "Delegate research tasks to the researcher and writing tasks to the writer. " +
    "Combine their outputs into a polished response.",
  // Every agent in `agents/` becomes a callable tool. The map below only
  // sets the descriptions the model reads when it picks one.
  tools: getAgentsAsTools({
    researcher: "Gather facts and sources on a topic",
    writer: "Turn research notes into finished prose",
  }),
  maxSteps: 10,
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
});
