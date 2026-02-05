/**
 * Prompt Discovery Handler
 */

import type { Prompt } from "#veryfront/prompt";
import { registerPrompt } from "#veryfront/mcp";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId } from "../discovery-utils.ts";

export const promptHandler: DiscoveryHandler<Prompt> = {
  typeName: "prompt",
  validate: (item): item is Prompt =>
    item !== null && typeof item === "object" && typeof (item as Prompt).getContent === "function",
  getId: (_item, file) => filenameToId(file),
  register: (id, prompt) => {
    const promptWithId = { ...prompt, id };
    registerPrompt(id, promptWithId);
    return promptWithId;
  },
  getResultMap: (result) => result.prompts,
};
