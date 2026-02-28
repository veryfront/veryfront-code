/**
 * Bridge DOM Helpers
 *
 * Micro-utilities for the most repeated DOM creation patterns
 * in the markdown editor. Reduces boilerplate without introducing
 * a full abstraction layer.
 */

import { DATA_VF_IGNORE } from "./bridge-constants.ts";

/** Create an element with className, DATA_VF_IGNORE, and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.setAttribute(DATA_VF_IGNORE, "true");
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

/** Create a button with className, DATA_VF_IGNORE, text, and click handler. */
export function btn(
  className: string,
  textContent: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = el("button", className, textContent);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}
