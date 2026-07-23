import { minifyCSSLexically } from "../../utils/css-minifier.ts";
import { atRuleContainsRules, parseCSSRules } from "../css-optimizer/css-rule-parser.ts";

export function minifyCSS(css: string): string {
  return minifyCSSLexically(css, { removeFinalSemicolons: false });
}

export function countUtilities(css: string): number {
  const utilities = new Set<string>();
  const visit = (content: string): void => {
    for (const rule of parseCSSRules(content)) {
      if (rule.block !== undefined && atRuleContainsRules(rule.atRuleName)) {
        visit(rule.block);
        continue;
      }
      if (rule.block === undefined) continue;
      for (const match of rule.prelude.matchAll(/\.(?:\\.|[-_a-zA-Z])(?:\\.|[-_a-zA-Z0-9])*/g)) {
        utilities.add(match[0]);
      }
    }
  };
  visit(css);
  return utilities.size;
}
