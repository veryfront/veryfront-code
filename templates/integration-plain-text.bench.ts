/**
 * Advisory markup-scanner benchmarks; compare sizes on the same runtime and host.
 * Run: deno bench --allow-all templates/integration-plain-text.bench.ts
 */
import { htmlToPlainText as confluenceHtmlToPlainText } from "./integrations/confluence/files/lib/confluence-plain-text.ts";
import { htmlToPlainText as teamsHtmlToPlainText } from "./integrations/teams/files/lib/teams-plain-text.ts";

for (const size of [2_000, 20_000, 60_000]) {
  const input = "<".repeat(size);
  for (
    const [name, convert] of [
      ["Confluence", confluenceHtmlToPlainText],
      ["Teams", teamsHtmlToPlainText],
    ] as const
  ) {
    Deno.bench({
      name: `${size} unterminated tag characters`,
      group: `${name} plain-text extraction`,
      baseline: size === 2_000,
      fn() {
        convert(input);
      },
    });
  }
}
