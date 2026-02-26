import { agent } from "veryfront/agent";

export default agent({
  id: "writer",
  model: "openai/gpt-4o",
  system:
    "You transform research notes into polished, publication-ready content. " +
    "Use a professional but approachable tone.",
  maxSteps: 3,
});
