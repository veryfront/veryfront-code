/**
 * DOM semantics shared by ChatInput action leaves.
 *
 * @module react/components/chat/chat/composition/chat-input-action-semantics
 */

import * as React from "react";
import { getPolymorphicButtonType } from "../../../ui/slot.tsx";

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
