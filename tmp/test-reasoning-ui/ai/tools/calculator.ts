import { tool } from "veryfront/ai";
import { z } from "zod";

export default tool({
  name: "calculator",
  description: "Perform basic arithmetic calculations",
  parameters: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case "add":
        return { result: a + b, expression: `${a} + ${b} = ${a + b}` };
      case "subtract":
        return { result: a - b, expression: `${a} - ${b} = ${a - b}` };
      case "multiply":
        return { result: a * b, expression: `${a} × ${b} = ${a * b}` };
      case "divide":
        if (b === 0) {
          return { error: "Cannot divide by zero" };
        }
        return { result: a / b, expression: `${a} ÷ ${b} = ${a / b}` };
      default:
        return { error: "Unknown operation" };
    }
  },
});
