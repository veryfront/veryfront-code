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
  const closedDetails = element.closest("details:not([open])");
  if (closedDetails) {
    const summary = closedDetails.querySelector(":scope > summary");
    if (!summary?.contains(element)) return true;
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

function isTabStopRadio(element: HTMLElement): boolean {
  if (element.tagName !== "INPUT") return true;
  const input = element as HTMLInputElement;
  if (input.type !== "radio" || input.name === "") return true;

  const root = input.getRootNode() as ParentNode;
  if (typeof root.querySelectorAll !== "function") return true;
  const group = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    .filter((candidate) =>
      candidate.name === input.name && candidate.form === input.form &&
      !candidate.matches(":disabled") && candidate.tabIndex >= 0 &&
      !isHiddenOrInert(candidate)
    );
  return (group.find((candidate) => candidate.checked) ?? group[0]) === input;
}

/** Return enabled, sequentially focusable descendants in DOM order. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      element.getAttribute("aria-disabled") !== "true" &&
      !isHiddenOrInert(element) &&
      isTabStopRadio(element)
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
  const first = getFocusableElements(container)[0];
  if (first) {
    focusWithoutScroll(first);
    if (container.ownerDocument.activeElement === first) return;
  }
  focusWithoutScroll(container);
}

function focusOrFallback(element: HTMLElement, container: HTMLElement): void {
  focusWithoutScroll(element);
  if (container.ownerDocument.activeElement !== element) focusWithoutScroll(container);
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
    focusOrFallback(last, container);
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    focusOrFallback(first, container);
  }
}
