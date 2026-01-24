import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  id: "calculator",
  description: "Perform basic arithmetic operations",
  parameters: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  }),
  execute: async ({ operation, a, b }) => {
    if (operation === "divide" && b === 0) {
      throw new Error("Cannot divide by zero");
    }

    switch (operation) {
      case "add":
        return { result: a + b };
      case "subtract":
        return { result: a - b };
      case "multiply":
        return { result: a * b };
      case "divide":
        return { result: a / b };
    }
  },
});
