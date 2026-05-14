import type { Suggestion } from "./types.ts";

const inlinePromptSuggestion: Suggestion = {
  type: "prompt",
  title: "Create a landing page",
  prompt: "Build a concise product landing page.",
};

const promptReferenceSuggestion: Suggestion = {
  id: "landing-page",
  type: "prompt",
};

const taskReferenceSuggestion: Suggestion = {
  id: "sync-content",
  type: "task",
};

void inlinePromptSuggestion;
void promptReferenceSuggestion;
void taskReferenceSuggestion;

// @ts-expect-error Prompt references cannot carry inline prompt fields.
const promptReferenceWithInlineFields: Suggestion = {
  id: "landing-page",
  type: "prompt",
  title: "Create a landing page",
  prompt: "Build a concise product landing page.",
};

// @ts-expect-error Inline prompts cannot carry prompt reference ids.
const inlinePromptWithReferenceId: Suggestion = {
  id: "landing-page",
  type: "prompt",
  title: "Create a landing page",
  prompt: "Build a concise product landing page.",
};

const taskSuggestionWithLegacyTaskBody: Suggestion = {
  id: "sync-content",
  type: "task",
  // @ts-expect-error Task suggestions only reference project task ids.
  task: "Sync content from CMS.",
};

const promptSuggestionWithDescription: Suggestion = {
  type: "prompt",
  title: "Create a landing page",
  prompt: "Build a concise product landing page.",
  // @ts-expect-error Suggestions do not carry descriptions.
  description: "Old metadata is not part of the suggestions contract.",
};

void promptReferenceWithInlineFields;
void inlinePromptWithReferenceId;
void taskSuggestionWithLegacyTaskBody;
void promptSuggestionWithDescription;
