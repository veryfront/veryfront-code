import { assertEquals } from "#std/assert";
import { extractCandidates } from "../../../../src/html/styles-builder/tailwind-compiler.ts";

export function assertExtractsClasses(content: string, expectedClasses: string[]): void {
  const result = extractCandidates(content);

  for (const cls of expectedClasses) {
    assertEquals(
      result.includes(cls),
      true,
      `Expected to extract "${cls}" from content. Got: [${result.join(", ")}]`,
    );
  }
}
