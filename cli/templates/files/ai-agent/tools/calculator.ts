import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

export default tool({
  id: "calculator",
  description:
    "Perform one arithmetic operation on two numbers. Use split to divide a money amount a into b shares that add up to it exactly.",
  inputSchema: defineSchema((v) =>
    v.object({
      operation: v.enum(["add", "subtract", "multiply", "divide", "split"]),
      a: v.number(),
      b: v.number(),
    })
  )(),
  execute: ({ operation, a, b }) => {
    if ((operation === "divide" || operation === "split") && b === 0) {
      throw new Error("Cannot divide by zero");
    }

    if (operation === "split") {
      const parts = Math.max(1, Math.trunc(Math.abs(b)));
      if (parts > 1000) throw new Error("Cannot split into more than 1000 shares");

      const cents = Math.round(a * 100);
      const base = Math.trunc(cents / parts);
      const remainder = Math.abs(cents - base * parts);
      return {
        result: Array.from(
          { length: parts },
          (_, index) => (base + (index < remainder ? Math.sign(cents) : 0)) / 100,
        ),
      };
    }

    if (operation === "add") return { result: a + b };
    if (operation === "subtract") return { result: a - b };
    if (operation === "multiply") return { result: a * b };
    return { result: a / b };
  },
});
