import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  model: "openai/gpt-4o",
  system:
    "You research topics thoroughly and return structured findings. " +
    "Present results as clear bullet points with key facts, data, and sources.",
  maxSteps: 3,
});
