/**
 * Portable @std/dotenv shim for Node.js and Bun.
 *
 * In Deno: Uses @std/dotenv
 * In Node.js/Bun: Provides the @std/dotenv parse, stringify, and load surface.
 *
 * @module
 */

import { isDeno } from "../runtime.ts";
import { readFileSync } from "node:fs";

export interface LoadOptions {
  envPath?: string | URL | null;
  export?: boolean;
}

type LineParseResult = {
  key: string;
  unquoted?: string;
  interpolated?: string;
  notInterpolated?: string;
};

const KEY_VALUE_RE =
  /^\s*(?:export\s+)?(?<key>[^\s=#]+?)\s*=[ \t]*('\r?\n?(?<notInterpolated>(.|\r\n|\n)*?)\r?\n?'|"\r?\n?(?<interpolated>(.|\r\n|\n)*?)\r?\n?"|(?<unquoted>[^\r\n#]*)) *#*.*$/gm;
const VALID_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const EXPAND_VALUE_RE =
  /(\${(?<inBrackets>.+?)(:-(?<inBracketsDefault>.+))?}|(?<!\\)\$(?<notInBrackets>\w+)(:-(?<notInBracketsDefault>.+))?)/g;

function expandCharacters(value: string): string {
  return value.replace(/\\([nrt])/g, (_, character: string) => {
    if (character === "n") return "\n";
    if (character === "r") return "\r";
    return "\t";
  });
}

function expandValue(value: string, variables: Record<string, string>): string {
  const seen = new Set<string>();
  let current = value;

  while (!seen.has(current)) {
    seen.add(current);
    EXPAND_VALUE_RE.lastIndex = 0;
    if (!EXPAND_VALUE_RE.test(current)) break;
    EXPAND_VALUE_RE.lastIndex = 0;

    const expanded = current.replace(EXPAND_VALUE_RE, (...parameters) => {
      const groups = parameters.at(-1) as {
        inBrackets?: string;
        inBracketsDefault?: string;
        notInBrackets?: string;
        notInBracketsDefault?: string;
      };
      const key = groups.inBrackets ?? groups.notInBrackets ?? "";
      const fallback = groups.inBracketsDefault ?? groups.notInBracketsDefault;
      return variables[key] ?? process.env[key] ?? fallback ?? "undefined";
    });

    if (expanded === current) break;
    current = expanded;
  }

  return current;
}

function nodeParse(content: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const expandableKeys: string[] = [];

  for (const match of content.matchAll(KEY_VALUE_RE)) {
    const { key, interpolated, notInterpolated, unquoted } = match.groups as LineParseResult;
    if (!VALID_KEY_RE.test(key)) continue;
    if (typeof unquoted === "string") expandableKeys.push(key);
    result[key] = typeof notInterpolated === "string"
      ? notInterpolated
      : typeof interpolated === "string"
      ? expandCharacters(interpolated)
      : (unquoted ?? "").trim();
  }

  const variables = { ...result };
  for (const key of expandableKeys) result[key] = expandValue(result[key]!, variables);
  return result;
}

async function nodeLoad(options: LoadOptions = {}): Promise<Record<string, string>> {
  const { readFile } = await import("node:fs/promises");
  const { envPath = ".env", export: shouldExport = false } = options;

  try {
    const parsed = envPath ? nodeParse(await readFile(envPath, "utf-8")) : {};

    if (shouldExport) {
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

function nodeLoadSync(options: LoadOptions = {}): Record<string, string> {
  const { envPath = ".env", export: shouldExport = false } = options;

  try {
    const parsed = envPath ? nodeParse(readFileSync(envPath, "utf-8")) : {};
    if (shouldExport) {
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function nodeStringify(object: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, rawValue] of Object.entries(object)) {
    if (key.startsWith("#")) continue;
    let value = rawValue ?? "";
    let quote: "'" | '"' | undefined;
    if (value.includes("\n") || value.includes("'")) {
      value = value.replaceAll("\n", "\\n");
      quote = '"';
    } else if (/\W/.test(value)) {
      quote = "'";
    }
    if (quote) value = `${quote}${value.replaceAll(quote, `\\${quote}`)}${quote}`;
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n");
}

export let load: (options?: LoadOptions) => Promise<Record<string, string>>;
export let loadSync: (options?: LoadOptions) => Record<string, string>;
export let parse: (content: string) => Record<string, string>;
export let stringify: (object: Record<string, string>) => string;

if (isDeno) {
  const stdDotenv = await import("#std/dotenv.ts");
  load = stdDotenv.load;
  loadSync = stdDotenv.loadSync;
  parse = stdDotenv.parse;
  stringify = stdDotenv.stringify;
} else {
  load = nodeLoad;
  loadSync = nodeLoadSync;
  parse = nodeParse;
  stringify = nodeStringify;
}
