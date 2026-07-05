/**
 * Chat composability contract — the single guard that keeps every compound
 * chat component customisable by a consuming developer.
 *
 * Each entry in `COMPOUNDS` is a component we promise is render-or-compose. This
 * test asserts, for every one of them:
 *   1. the callable is render-or-compose (an `Object.assign` compound);
 *   2. every documented sub-part is actually reachable off the namespace;
 *   3. the `use*` hook throws when used outside its provider (fail-fast, so a
 *      misplaced sub-part is a loud error, never a silent null).
 *
 * Adding a new compound component? Add a row here. If it can't satisfy the row,
 * it isn't composable — this registry is the definition, not the documentation.
 *
 * Per-part behaviour (recompose / slot injection / className restyle) is proven
 * in each component's own `*.test.tsx`; this file is the cross-cutting backstop.
 */

import { renderToString } from "react-dom/server";
import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ToolCall, useToolCall } from "./components/tool-ui.tsx";
import { Reasoning, useReasoning } from "./components/reasoning.tsx";
import { Sources, useSources } from "./components/sources.tsx";
import { AttachmentPill, useAttachmentPill } from "./components/attachment-pill.tsx";
import { StepIndicator, useStepIndicator } from "./components/step-indicator.tsx";
import { Message } from "./composition/message.tsx";
import { useMessageContext } from "./contexts/message-context.tsx";
import { AgentCard, useAgentCard } from "../agent-card.tsx";
import { AttachmentsPanel, useAttachmentsPanel } from "./components/attachments-panel.tsx";
import { ChatActions, useChatActions } from "../chat-actions.tsx";
import { AgentPicker, useAgentPicker } from "../agent-picker.tsx";
import { ModelSelector, useModelSelector } from "../model-selector.tsx";

interface CompoundSpec {
  name: string;
  // deno-lint-ignore no-explicit-any
  component: any;
  /** Sub-parts that must hang off the compound object. */
  parts: string[];
  /** The context hook that must throw outside its provider. */
  hook: () => unknown;
}

const COMPOUNDS: CompoundSpec[] = [
  {
    name: "ToolCall",
    component: ToolCall,
    parts: ["Root", "Trigger", "Body", "Input", "Output", "Error"],
    hook: useToolCall,
  },
  {
    name: "Reasoning",
    component: Reasoning,
    parts: ["Root", "Trigger", "Content"],
    hook: useReasoning,
  },
  {
    name: "Sources",
    component: Sources,
    parts: ["Root", "List", "Pill"],
    hook: useSources,
  },
  {
    name: "Message",
    component: Message,
    parts: [
      "Root",
      "Header",
      "Avatar",
      "Content",
      "Part",
      "Sources",
      "Actions",
      "CopyAction",
      "RegenerateAction",
      "EditAction",
      "Feedback",
      "BranchPicker",
      "Tokens",
      "Continuing",
    ],
    hook: useMessageContext,
  },
  {
    name: "AgentCard",
    component: AgentCard,
    parts: ["Root", "Header", "Reasoning", "Tools", "Body"],
    hook: useAgentCard,
  },
  {
    name: "AttachmentPill",
    component: AttachmentPill,
    parts: ["Root", "Thumbnail", "Icon", "Label", "Retry", "Remove"],
    hook: useAttachmentPill,
  },
  {
    name: "StepIndicator",
    component: StepIndicator,
    parts: ["Root", "Rule", "Label"],
    hook: useStepIndicator,
  },
  {
    name: "AttachmentsPanel",
    component: AttachmentsPanel,
    parts: ["Root", "Header", "List", "Item", "Empty", "Action"],
    hook: useAttachmentsPanel,
  },
  {
    name: "ChatActions",
    component: ChatActions,
    parts: ["Root", "Trigger", "Content", "Item", "Preset"],
    hook: useChatActions,
  },
  {
    name: "AgentPicker",
    component: AgentPicker,
    parts: ["Root", "Trigger", "Content", "List", "Item"],
    hook: useAgentPicker,
  },
  {
    name: "ModelSelector",
    component: ModelSelector,
    parts: ["Root", "Trigger", "Content", "List", "Item"],
    hook: useModelSelector,
  },
];

describe("chat composability contract", () => {
  for (const spec of COMPOUNDS) {
    it(`${spec.name} is render-or-compose (callable)`, () => {
      assert(
        typeof spec.component === "function" ||
          typeof spec.component === "object",
        `${spec.name} must be a callable compound`,
      );
    });

    it(`${spec.name} exposes every documented sub-part`, () => {
      for (const part of spec.parts) {
        assert(
          typeof spec.component[part] === "function" ||
            typeof spec.component[part] === "object",
          `${spec.name}.${part} is missing — the compound is incomplete`,
        );
      }
    });

    it(`${spec.name}: sub-part hook throws outside its provider`, () => {
      function Orphan() {
        spec.hook();
        return null;
      }
      let threw = false;
      try {
        renderToString(<Orphan />);
      } catch {
        threw = true;
      }
      assertEquals(
        threw,
        true,
        `${spec.name}'s hook must throw outside its provider`,
      );
    });
  }
});
