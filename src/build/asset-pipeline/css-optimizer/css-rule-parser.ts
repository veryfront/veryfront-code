export interface CSSRuleNode {
  leading: string;
  prelude: string;
  block?: string;
  atRuleName?: string;
}

const NESTED_RULE_AT_RULES = new Set([
  "container",
  "document",
  "layer",
  "media",
  "scope",
  "starting-style",
  "supports",
]);

export function atRuleContainsRules(name: string | undefined): boolean {
  return name !== undefined && NESTED_RULE_AT_RULES.has(name);
}

function skipComment(css: string, index: number): number {
  const end = css.indexOf("*/", index + 2);
  if (end === -1) throw new SyntaxError("Unterminated CSS comment");
  return end + 2;
}

function readBlock(css: string, openingBrace: number): { block: string; end: number } {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = openingBrace + 1; index < css.length; index++) {
    const current = css[index];
    if (current === undefined) continue;
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === "/" && css[index + 1] === "*") {
      index = skipComment(css, index) - 1;
      continue;
    }
    if (current === "\\") {
      index++;
      continue;
    }
    if (current === "{") depth++;
    else if (current === "}" && --depth === 0) {
      return { block: css.slice(openingBrace + 1, index), end: index + 1 };
    }
  }

  if (quote) throw new SyntaxError("Unterminated CSS string");
  throw new SyntaxError("Unterminated CSS block");
}

export function parseCSSRules(css: string): CSSRuleNode[] {
  const nodes: CSSRuleNode[] = [];
  let index = 0;

  while (index < css.length) {
    const leadingStart = index;
    while (index < css.length) {
      if (/\s/.test(css[index] ?? "")) {
        index++;
        continue;
      }
      if (css[index] === "/" && css[index + 1] === "*") {
        index = skipComment(css, index);
        continue;
      }
      break;
    }
    const leading = css.slice(leadingStart, index);
    if (index >= css.length) break;

    const preludeStart = index;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let parentheses = 0;
    let brackets = 0;
    let foundTerminator = false;

    for (; index < css.length; index++) {
      const current = css[index];
      if (current === undefined) continue;
      if (quote) {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) quote = null;
        continue;
      }
      if (current === '"' || current === "'") {
        quote = current;
        continue;
      }
      if (current === "/" && css[index + 1] === "*") {
        index = skipComment(css, index) - 1;
        continue;
      }
      if (current === "\\") {
        index++;
        continue;
      }
      if (current === "(") parentheses++;
      else if (current === ")") {
        if (parentheses === 0) throw new SyntaxError("Unexpected CSS delimiter: )");
        parentheses--;
      } else if (current === "[") brackets++;
      else if (current === "]") {
        if (brackets === 0) throw new SyntaxError("Unexpected CSS delimiter: ]");
        brackets--;
      } else if (parentheses === 0 && brackets === 0 && current === ";") {
        const prelude = css.slice(preludeStart, index + 1);
        nodes.push({ leading, prelude, atRuleName: getAtRuleName(prelude) });
        index++;
        foundTerminator = true;
        break;
      } else if (parentheses === 0 && brackets === 0 && current === "{") {
        const prelude = css.slice(preludeStart, index);
        if (!prelude.trim()) throw new SyntaxError("CSS rule prelude must not be empty");
        const parsedBlock = readBlock(css, index);
        nodes.push({
          leading,
          prelude,
          block: parsedBlock.block,
          atRuleName: getAtRuleName(prelude),
        });
        index = parsedBlock.end;
        foundTerminator = true;
        break;
      } else if (parentheses === 0 && brackets === 0 && current === "}") {
        throw new SyntaxError("Unexpected CSS delimiter: }");
      }
    }

    if (!foundTerminator) {
      if (quote) throw new SyntaxError("Unterminated CSS string");
      if (parentheses > 0 || brackets > 0) throw new SyntaxError("Unterminated CSS delimiter");
      throw new SyntaxError("Unterminated CSS rule");
    }
  }

  return nodes;
}

function getAtRuleName(prelude: string): string | undefined {
  return /^\s*@([a-zA-Z][\w-]*)/.exec(prelude)?.[1]?.toLowerCase();
}

export function serializeCSSRule(node: CSSRuleNode, block = node.block): string {
  return block === undefined
    ? `${node.leading}${node.prelude}`
    : `${node.leading}${node.prelude}{${block}}`;
}

function splitSelectorList(selectorList: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < selectorList.length; index++) {
    const current = selectorList[index];
    if (current === undefined) continue;
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === '"' || current === "'") quote = current;
    else if (current === "\\") index++;
    else if (current === "(") parentheses++;
    else if (current === ")") parentheses--;
    else if (current === "[") brackets++;
    else if (current === "]") brackets--;
    else if (current === "," && parentheses === 0 && brackets === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors.filter(Boolean);
}

export function selectorReferencesUsed(
  selectorList: string,
  usedSelectors: ReadonlySet<string>,
): boolean {
  return splitSelectorList(selectorList).some((selector) => {
    if (/(^|[\s>+~,])(?::root|html|body)(?=$|[\s>+~,.#:[\]])/.test(selector)) return true;
    if (/(^|[\s>+~,])\*(?=$|[\s>+~,.#:[\]])/.test(selector)) return true;
    const tokens = new Set<string>();
    for (const match of selector.matchAll(/[.#][a-zA-Z_][\w-]*/g)) tokens.add(match[0]);
    for (const match of selector.matchAll(/(?:^|[\s>+~,])([a-zA-Z][\w-]*)/g)) {
      if (match[1]) tokens.add(match[1].toLowerCase());
    }
    if ([...tokens].some((token) => usedSelectors.has(token))) return true;

    // Attribute selectors, escaped identifiers, and custom selector syntax are
    // retained because static source scanning cannot prove they are unused.
    return tokens.size === 0 && /[\\\[&]/.test(selector);
  });
}

export function purgeCSSRules(css: string, usedSelectors: ReadonlySet<string>): string {
  const kept: string[] = [];
  for (const node of parseCSSRules(css)) {
    if (node.block === undefined || node.atRuleName && !atRuleContainsRules(node.atRuleName)) {
      kept.push(serializeCSSRule(node));
      continue;
    }
    if (node.atRuleName) {
      const nested = purgeCSSRules(node.block, usedSelectors);
      if (nested.trim()) kept.push(serializeCSSRule(node, nested));
      continue;
    }
    if (selectorReferencesUsed(node.prelude, usedSelectors)) kept.push(serializeCSSRule(node));
  }
  return kept.join("");
}

export function partitionCriticalCSS(
  css: string,
  criticalSelectors: ReadonlySet<string>,
): { critical: string; remaining: string } {
  const critical: string[] = [];
  const remaining: string[] = [];

  for (const node of parseCSSRules(css)) {
    if (node.block === undefined || node.atRuleName && !atRuleContainsRules(node.atRuleName)) {
      critical.push(serializeCSSRule(node));
      continue;
    }
    if (node.atRuleName) {
      const nested = partitionCriticalCSS(node.block, criticalSelectors);
      if (nested.critical.trim()) critical.push(serializeCSSRule(node, nested.critical));
      if (nested.remaining.trim()) remaining.push(serializeCSSRule(node, nested.remaining));
      continue;
    }
    const target = selectorReferencesUsed(node.prelude, criticalSelectors) ? critical : remaining;
    target.push(serializeCSSRule(node));
  }

  return { critical: critical.join(""), remaining: remaining.join("") };
}
