import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

export default tool({
  id: "calculator",
  description: "Perform arithmetic. For round, a is the value and b is the decimal places.",
  inputSchema: defineSchema((v) => v.object({
    operation: v.enum(["add", "subtract", "multiply", "divide", "round"]),
    a: v.number(),
    b: v.number(),
  }))(),
  execute: ({ operation, a, b }) => {
    const precision = Math.min(100, Math.max(0, Math.trunc(b)));

    if (operation === "divide" && b === 0) {
      throw new Error("Cannot divide by zero");
    }

    if (operation === "add") return { result: a + b };
    if (operation === "subtract") return { result: a - b };
    if (operation === "multiply") return { result: a * b };
    if (operation === "round") {
      const offset = Math.sign(a) * Number.EPSILON * Math.max(1, Math.abs(a));
      return { result: Number((a + offset).toFixed(precision)) };
    }
    return { result: a / b };
  },
});
