/** Pure helpers for provider-neutral CSS cache parsing and diagnostics. */

import { isCSSContentHash } from "./css-identity.ts";
import { assertCSSOutputContent } from "#veryfront/utils/css-content-admission.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

interface ParsedProjectCSSCacheEntry {
  css: string;
  hash: string;
  candidatesHash: string;
}

interface CSSErrorDescriptor {
  title: string;
  message: string;
  suggestion: string;
}

type ProjectCSSLocalCacheState = "miss" | "expired" | "mismatch" | "hit";

const MAX_PROJECT_CSS_CACHE_ENTRY_BYTES = 40 * 1024 * 1024;

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function parseProjectCSSCacheEntry(
  raw: string,
): ParsedProjectCSSCacheEntry | undefined {
  if (
    typeof raw !== "string" ||
    utf8ByteLength(raw, MAX_PROJECT_CSS_CACHE_ENTRY_BYTES) > MAX_PROJECT_CSS_CACHE_ENTRY_BYTES
  ) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const css = readOwnDataProperty(parsed, "css");
  const hash = readOwnDataProperty(parsed, "hash");
  const candidatesHash = readOwnDataProperty(parsed, "candidatesHash");
  if (
    typeof css !== "string" ||
    !isCSSContentHash(hash) ||
    !isCSSContentHash(candidatesHash)
  ) return undefined;
  try {
    assertCSSOutputContent(css, "Cached project CSS output");
  } catch {
    return undefined;
  }
  return { css, hash, candidatesHash };
}

export function evaluateProjectCSSLocalCacheState(
  entry: { expiresAt: number; candidatesHash: string } | undefined,
  candidatesHash: string,
  now = Date.now(),
): ProjectCSSLocalCacheState {
  if (!entry) return "miss";
  if (now > entry.expiresAt) return "expired";
  if (entry.candidatesHash !== candidatesHash) return "mismatch";
  return "hit";
}

function extractQuotedToken(message: string): string | undefined {
  return /["']([^"']+)["']/.exec(message)?.[1];
}

export function formatCSSErrorMessage(message: string): CSSErrorDescriptor {
  if (message.includes("does not accept options")) {
    const pluginName = extractQuotedToken(message) ?? "configured plugin";
    return {
      title: "Plugin Options Not Supported",
      message: `${pluginName} does not accept options`,
      suggestion: `Remove the options block from @plugin "${pluginName}".`,
    };
  }
  if (
    message.includes("Could not resolve") ||
    message.includes("cannot resolve") ||
    message.includes("Failed to load plugin") ||
    message.includes("not an audited")
  ) {
    const pluginName = extractQuotedToken(message) ?? "unknown";
    return {
      title: "Plugin Not Available",
      message: `The configured CSS processor could not load: ${pluginName}`,
      suggestion:
        `Use a plugin from the explicitly registered provider's allowlist, named either ` +
        `bare ("${pluginName}") or at its exact audited version ("${pluginName}@<version>"). ` +
        `No other version resolves.`,
    };
  }
  if (message.includes("@theme") || message.includes("Invalid theme")) {
    return {
      title: "Invalid CSS Theme",
      message,
      suggestion: "Check the configured processor's theme syntax: @theme { --color-name: value; }",
    };
  }
  if (message.includes("Unexpected") || message.includes("Expected")) {
    return {
      title: "CSS Syntax Error",
      message,
      suggestion:
        "Check for missing semicolons, brackets, or typos, then check the stylesheet syntax " +
        "accepted by the configured CSS processor.",
    };
  }
  return {
    title: "CSS Compilation Error",
    message,
    suggestion: "Check the stylesheet and explicit CSS provider configuration.",
  };
}
