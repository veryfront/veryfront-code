/**
 * DOM semantics shared by ChatInput action leaves.
 *
 * @module react/components/chat/chat/composition/chat-input-action-semantics
 */

import * as React from "react";

/** Default native button children away from form submission without leaking `type` to links. */
export function getChatInputActionType(
  asChild: boolean | undefined,
  child: React.ReactNode,
): "button" | undefined {
  if (!asChild) return "button";
  return React.isValidElement(child) && child.type === "button" ? "button" : undefined;
}
