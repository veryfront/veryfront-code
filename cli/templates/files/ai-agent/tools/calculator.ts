import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

export default tool({
  id: "calculator",
  description: "Perform basic arithmetic operations",
  inputSchema: defineSchema((v) => v.object({
    operation: v.enum(["add", "subtract", "multiply", "divide"]),
    a: v.number(),
    b: v.number(),
  }))(),
  execute: async ({ operation, a, b }) => {
    if (operation === "divide" && b === 0) {
      throw new Error("Cannot divide by zero");
    }

    if (operation === "add") return { result: a + b };
    if (operation === "subtract") return { result: a - b };
    if (operation === "multiply") return { result: a * b };
    return { result: a / b };
  },
});
