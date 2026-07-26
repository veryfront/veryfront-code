/**
 * Prompt Discovery Handler
 */

import type { Prompt } from "#veryfront/prompt";
import { registerPrompt } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filePathToId } from "../discovery-utils.ts";
import { assertPromptMCPConfig } from "#veryfront/prompt/validation.ts";

function isPrompt(value: unknown): value is Prompt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Prompt>;
  const validShape = (candidate.id === undefined || typeof candidate.id === "string") &&
    typeof candidate.description === "string" &&
    typeof candidate.getContent === "function" &&
    (candidate.suggestion === undefined || typeof candidate.suggestion === "string");
  if (!validShape) return false;
  if (candidate.mcp === undefined) return true;
  try {
    assertPromptMCPConfig(candidate.mcp);
    return true;
  } catch {
    return false;
  }
}

function hasGeneratedPromptId(prompt: Prompt): boolean {
  return typeof prompt.__veryfrontGeneratedId === "string" &&
    prompt.id === prompt.__veryfrontGeneratedId;
}

export const promptHandler: DiscoveryHandler<Prompt> = {
  typeName: "prompt",
  validate: isPrompt,
  getId: (discoveredPrompt, file, dir) => {
    return typeof discoveredPrompt.id === "string" &&
        discoveredPrompt.id.trim().length > 0 &&
        !hasGeneratedPromptId(discoveredPrompt)
      ? discoveredPrompt.id
      : filePathToId(file, dir);
  },
  register: (id, prompt) => {
    const promptWithId = prompt.id === id ? prompt : { ...prompt, id };
    registerPrompt(id, promptWithId);
    return promptWithId;
  },
  getResultMap: (result) => result.prompts,
};
