const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
  "audio[controls]",
  "video[controls]",
  "summary",
].join(",");

function isHiddenOrInert(element: HTMLElement): boolean {
  if (
    element.hidden || element.getAttribute("aria-hidden") === "true" ||
    element.closest("[hidden],[inert],[aria-hidden='true']") !== null
  ) {
    return true;
  }
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (
      style.display === "none" || style.visibility === "hidden" ||
      style.visibility === "collapse" || style.contentVisibility === "hidden"
    ) {
      return true;
    }
  }
  return false;
}

/** Return enabled, sequentially focusable descendants in DOM order. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) =>
      element.tabIndex >= 0 &&
      element.getAttribute("aria-disabled") !== "true" &&
      !isHiddenOrInert(element)
    )
    .map((element, domIndex) => ({ domIndex, element }))
    .sort((left, right) => {
      const leftOrder = left.element.tabIndex > 0 ? left.element.tabIndex : Number.MAX_SAFE_INTEGER;
      const rightOrder = right.element.tabIndex > 0
        ? right.element.tabIndex
        : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.domIndex - right.domIndex;
    })
    .map(({ element }) => element);
}

/** Focus without scrolling when supported by the current document. */
export function focusWithoutScroll(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

/** Focus the first interactive descendant, or the container as a fallback. */
export function focusFirst(container: HTMLElement): void {
  focusWithoutScroll(getFocusableElements(container)[0] ?? container);
}

/** Keep keyboard Tab navigation inside a modal container. */
export function trapTabKey(
  event: KeyboardEvent,
  container: HTMLElement,
): void {
  if (event.key !== "Tab") return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    focusWithoutScroll(container);
    return;
  }

  const active = container.ownerDocument.activeElement;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    focusWithoutScroll(last);
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    focusWithoutScroll(first);
  }
}
