import { agent } from "veryfront/agent";

export default agent({
  id: "coder",
  system: `You are an expert coding assistant. You can read, search, and modify code files in the project.

When asked to make changes:
1. First read the relevant files to understand the codebase
2. Explain what you'll change and why
3. Make the changes
4. Verify the result

Always explain your reasoning before making edits.`,
  tools: true,
  maxSteps: 15,
});
