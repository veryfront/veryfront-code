/**
 * Prompt Discovery Handler
 */

import type { Prompt } from "#veryfront/prompt";
import { registerPrompt } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId } from "../discovery-utils.ts";

function isPrompt(value: unknown): value is Prompt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Prompt>;
  return (candidate.id === undefined || typeof candidate.id === "string") &&
    typeof candidate.description === "string" &&
    typeof candidate.getContent === "function" &&
    (candidate.suggestion === undefined || typeof candidate.suggestion === "string");
}

function hasGeneratedPromptId(prompt: Prompt): boolean {
  return typeof prompt.__veryfrontGeneratedId === "string" &&
    prompt.id === prompt.__veryfrontGeneratedId;
}

export const promptHandler: DiscoveryHandler<Prompt> = {
  typeName: "prompt",
  validate: isPrompt,
  getId: (discoveredPrompt, file) => {
    return typeof discoveredPrompt.id === "string" &&
        discoveredPrompt.id.trim().length > 0 &&
        !hasGeneratedPromptId(discoveredPrompt)
      ? discoveredPrompt.id
      : filenameToId(file);
  },
  register: (id, prompt) => {
    const promptWithId = prompt.id === id ? prompt : { ...prompt, id };
    registerPrompt(id, promptWithId);
    return promptWithId;
  },
  getResultMap: (result) => result.prompts,
};
