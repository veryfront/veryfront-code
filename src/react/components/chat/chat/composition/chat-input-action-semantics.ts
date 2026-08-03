/**
 * DOM semantics shared by ChatInput action leaves.
 *
 * @module react/components/chat/chat/composition/chat-input-action-semantics
 */

import * as React from "react";

/**
 * Keep action buttons out of native form submission. Intrinsic non-buttons do
 * not receive button-only attributes; opaque components receive the safe
 * button default because their rendered element cannot be inspected here.
 */
export function getChatInputActionType(
  asChild: boolean | undefined,
  child: React.ReactNode,
): "button" | undefined {
  if (!asChild) return "button";
  if (!React.isValidElement(child)) return undefined;
  if (typeof child.type === "string") return child.type === "button" ? "button" : undefined;
  return "button";
}
