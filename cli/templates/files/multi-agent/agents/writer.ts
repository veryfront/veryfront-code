import { agent } from "veryfront/agent";

export default agent({
  id: "writer",
  model: "openai/gpt-4o",
  system:
    "You are a writing specialist. " +
    "Take research notes and transform them into clear, engaging prose. " +
    "Use a professional but approachable tone.",
  maxSteps: 3,
});
