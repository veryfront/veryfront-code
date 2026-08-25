/**
 * DOM semantics shared by ChatInput action leaves.
 *
 * @module react/components/chat/chat/composition/chat-input-action-semantics
 */

import * as React from "react";
import { getPolymorphicButtonType } from "../../../ui/slot.tsx";
import type { WrapClick } from "./chat-composer.types.ts";

/** Invoke a wrapper after Button's internal `asChild` type erasure. */
export function invokeChatInputClick<T extends HTMLElement>(
  onClick: WrapClick | WrapClick<T> | undefined,
  event: React.MouseEvent<HTMLElement>,
  run: () => void,
): void {
  // The public action overload retains T; currentTarget is that slotted node.
  const erasedClick = onClick as WrapClick | undefined;
  erasedClick ? erasedClick(event, run) : run();
}

/**
 * Keep action buttons out of native form submission. Intrinsic non-buttons do
 * not receive button-only attributes. Opaque components own their native
 * semantics because their rendered element cannot be inspected here.
 */
export function getChatInputActionType(
  asChild: boolean | undefined,
  child: React.ReactNode,
): "button" | undefined {
  return getPolymorphicButtonType(asChild, child);
}
