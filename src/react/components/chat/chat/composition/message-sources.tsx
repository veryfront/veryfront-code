/**
 * `Message.Sources` — the inline citation sources extracted from a message's
 * tool results. Composable like the underlying `Sources` collection.
 *
 * @module react/components/chat/composition/message-sources
 */

import * as React from "react";
import { Sources as SourcesImpl } from "../components/sources.tsx";
import type { Source } from "../components/sources.tsx";
import { useMessageContext } from "../contexts/message-context.tsx";
import { useChatContextOptional } from "../contexts/chat-context.tsx";
import { extractSourcesFromParts } from "../utils/message-parts.ts";

/** Props for `Message.Sources`. */
export interface MessageSourcesProps {
  onSourceClick?: (source: Source, index: number) => void;
  className?: string;
  /**
   * Render each citation yourself. Pass a function-child to map every source
   * (e.g. a restyled `SourcePill`), or `Sources.List` / `Sources.Pill` nodes to
   * recompose the row. Omit for the default anatomy (a wrap of pills).
   */
  children?: React.ReactNode | ((source: Source, index: number) => React.ReactNode);
  /** Render each source yourself instead of using the default `Sources.Pill`. */
  renderItem?: (options: { item: Source; index: number }) => React.ReactNode;
}

/**
 * The inline citation sources extracted from this message's tool results.
 * A black-box wrap of pills by default; compose it like the underlying
 * `Sources` collection — a function-child, `renderItem`, or `Sources.List` /
 * `Sources.Pill` leaves reading `useSources()`.
 */
export function MessageSources(
  { onSourceClick, className, children, renderItem }: MessageSourcesProps,
): React.ReactElement | null {
  const { message } = useMessageContext();
  const chat = useChatContextOptional();
  const sources = extractSourcesFromParts(message.parts);
  if (sources.length === 0) return null;
  // A function-child maps each source — normalize it to the collection's
  // `renderItem` so a consumer never has to reach for the underlying `Sources`.
  const itemRenderer = typeof children === "function"
    ? ({ item, index }: { item: Source; index: number }) => children(item, index)
    : renderItem;
  return (
    <SourcesImpl
      sources={sources}
      onSourceClick={onSourceClick ?? chat?.onSourceClick}
      className={className}
      renderItem={itemRenderer}
    >
      {typeof children === "function" ? undefined : children}
    </SourcesImpl>
  );
}
MessageSources.displayName = "Message.Sources";
