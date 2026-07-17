/**
 * Message body renderers — the grouped-part anatomy shared by the default
 * `Message.Content` loop and the composed `Message.Part` / typed-leaf sub-parts.
 * Kept in one module so the composed path never drifts from the preset.
 *
 * @module react/components/chat/composition/message-body
 */

import * as React from "react";
import type { CodeBlockProps, Components } from "../../markdown.tsx";
import { Markdown } from "../../markdown.tsx";
import type { PartGroup } from "../utils/message-parts.ts";
import { useMessageContext } from "../contexts/message-context.tsx";
import { Reasoning } from "../components/reasoning.tsx";
import { ToolCall } from "../components/tool-ui.tsx";
import { StepIndicator } from "../components/step-indicator.tsx";
import { AttachmentPill } from "../components/attachment-pill.tsx";
import { SourcePill, useSourcesOptional } from "../components/sources.tsx";
import type { Source } from "../components/sources.tsx";

/** Options shared by the default part renderer and `Message.Part`. */
interface RenderPartOptions {
  stepCount: number;
  /** Forwarded to the answer `Markdown` — swap the code block. */
  codeBlock?: (props: CodeBlockProps) => React.ReactNode;
  /** Forwarded to the answer `Markdown` — override element renderers. */
  markdownComponents?: Components;
}

/**
 * Render one grouped assistant part with the default anatomy. Extracted so both
 * the default `Message.Content` loop and the `Message.Part` sub-part share one
 * source of truth — the composed path never drifts from the preset.
 */
export function renderAnswerPart(
  group: PartGroup,
  opts: RenderPartOptions,
): React.ReactNode {
  if (group.type === "text") {
    // `my-2` gives the answer text extra breathing room from an adjacent tool
    // card. In the flex-col container the gap doesn't collapse with margins, so
    // this widens text↔tool boundaries while tool↔tool stays at the base gap.
    return (
      <Markdown
        className="my-2 text-[15px] leading-7"
        renderCodeBlock={opts.codeBlock}
        components={opts.markdownComponents}
      >
        {group.content}
      </Markdown>
    );
  }
  if (group.type === "reasoning") {
    return <Reasoning text={group.text} isStreaming={group.isStreaming} />;
  }
  if (group.type === "step") {
    return opts.stepCount > 1
      ? (
        <StepIndicator
          stepIndex={group.stepIndex}
          isComplete={group.isComplete}
        />
      )
      : null;
  }
  if (group.type === "file") {
    const isImage = group.file.mediaType.startsWith("image/");
    return (
      <div className="my-1.5">
        <AttachmentPill
          className="w-[200px]"
          attachment={{
            id: "file",
            name: group.file.filename ?? "Attachment",
            type: group.file.mediaType,
            url: group.file.url,
            // No lifecycle `state`: this is a sent, read-only attachment, so
            // the pill shows the file type/size rather than an "Uploaded" badge.
            ...(group.file.size != null ? { size: group.file.size } : {}),
            preview: isImage ? group.file.url : undefined,
          }}
        />
      </div>
    );
  }
  // ToolCall renders the compact skill row for skill tools and the full
  // params/result card for everything else — one component either way.
  return <ToolCall tool={group.tool} />;
}

// ---------------------------------------------------------------------------
// Message.Part — the body sub-part used inside a composed `Message.Content`.
// Renders any grouped part with the default anatomy (so composition never drifts
// from the preset); special-case a part by checking `part.type` and rendering
// your own node instead.
// ---------------------------------------------------------------------------

/** Props for `Message.Part`. */
export interface MessagePartProps {
  part: PartGroup;
  codeBlock?: (props: CodeBlockProps) => React.ReactNode;
  markdownComponents?: Components;
}

/** Render a single grouped part with the default `Message.Content` anatomy. */
export function MessagePart({
  part,
  codeBlock,
  markdownComponents,
}: MessagePartProps): React.ReactElement {
  const { parts } = useMessageContext();
  const stepCount = parts.filter((g) => g.type === "step").length;
  return (
    <>
      {renderAnswerPart(part, {
        stepCount,
        codeBlock,
        markdownComponents,
      })}
    </>
  );
}
MessagePart.displayName = "Message.Part";

// ---------------------------------------------------------------------------
// Message.Text / .Reasoning / .Source — typed part-leaf sugar.
//
// Thin, typed wrappers so a consumer composing `Message.Content`'s function-child
// can write `<Message.Text part={p} />` on a narrowed part instead of switching
// on `part.type` themselves. `Text`/`Reasoning` delegate to `Message.Part` (one
// source of truth for the anatomy); `Source` renders a single citation pill.
// ---------------------------------------------------------------------------

/** Props for `Message.Text` — a `text` group from `Message.Content`. */
export interface MessageTextProps {
  part: Extract<PartGroup, { type: "text" }>;
  codeBlock?: (props: CodeBlockProps) => React.ReactNode;
  markdownComponents?: Components;
}

/** Render a text part with the default answer anatomy (typed sugar over `Message.Part`). */
export function MessageText(
  { part, codeBlock, markdownComponents }: MessageTextProps,
): React.ReactElement {
  return <MessagePart part={part} codeBlock={codeBlock} markdownComponents={markdownComponents} />;
}
MessageText.displayName = "Message.Text";

/** Props for `Message.Reasoning` — a `reasoning` group from `Message.Content`. */
export interface MessageReasoningProps {
  part: Extract<PartGroup, { type: "reasoning" }>;
}

/** Render a reasoning part with the default anatomy (typed sugar over `Message.Part`). */
export function MessageReasoning({ part }: MessageReasoningProps): React.ReactElement {
  return <MessagePart part={part} />;
}
MessageReasoning.displayName = "Message.Reasoning";

/** Props for `Message.Source` — a single citation from `Message.Sources`. */
export interface MessageSourceProps {
  source: Source;
  index: number;
  /** Override the click handler; falls back to the enclosing `Message.Sources`. */
  onClick?: () => void;
  className?: string;
}

/**
 * Render a single citation pill. Inside a `Message.Sources` function-child it
 * inherits the row's `onSourceClick`; pass `onClick` to override, or use it
 * standalone with no handler.
 */
export function MessageSource(
  { source, index, onClick, className }: MessageSourceProps,
): React.ReactElement {
  const sources = useSourcesOptional();
  const handleClick = onClick ??
    (sources?.onSourceClick ? () => sources.onSourceClick?.(source, index) : undefined);
  return <SourcePill source={source} index={index} onClick={handleClick} className={className} />;
}
MessageSource.displayName = "Message.Source";
