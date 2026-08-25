import * as React from "react";
import { focusWithoutScroll, getFocusableElements } from "./focus-management.ts";

const TYPEAHEAD_RESET_MS = 700;

export interface MenuKeyboardOptions {
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  setOpen: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function useMenuContentKeyboard({
  onKeyDown,
  setOpen,
  triggerRef,
}: MenuKeyboardOptions): React.KeyboardEventHandler<HTMLDivElement> {
  const typeaheadRef = React.useRef({ buffer: "", lastTypedAt: 0 });

  return React.useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      return;
    }

    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(
      "[role='menuitem']:not([aria-disabled='true'])",
    )];
    const activeIndex = items.indexOf(
      event.currentTarget.ownerDocument.activeElement as HTMLElement,
    );
    const focusAt = (index: number): void => {
      const item = items[(index + items.length) % items.length];
      if (item) focusWithoutScroll(item);
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(activeIndex + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(activeIndex < 0 ? items.length - 1 : activeIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        return;
      case "Tab": {
        event.preventDefault();
        const trigger = triggerRef?.current;
        const document = event.currentTarget.ownerDocument;
        const candidates = getFocusableElements(document.body).filter((element) =>
          !event.currentTarget.contains(element)
        );
        const triggerIndex = trigger ? candidates.indexOf(trigger) : -1;
        const next = event.shiftKey ? candidates[triggerIndex - 1] : candidates[triggerIndex + 1];
        setOpen(false);
        queueMicrotask(() => {
          if (next?.isConnected) focusWithoutScroll(next);
          else if (trigger?.isConnected) focusWithoutScroll(trigger);
        });
        return;
      }
    }

    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;

    const now = Date.now();
    const previous = typeaheadRef.current;
    const buffer = now - previous.lastTypedAt > TYPEAHEAD_RESET_MS
      ? event.key
      : previous.buffer + event.key;
    typeaheadRef.current = { buffer, lastTypedAt: now };
    const normalizedBuffer = buffer.normalize("NFKC").toLocaleLowerCase();
    const repeatedCharacter = [...normalizedBuffer].every((character) =>
      character === normalizedBuffer[0]
    );
    const query = repeatedCharacter ? normalizedBuffer[0]! : normalizedBuffer;
    for (let offset = 1; offset <= items.length; offset += 1) {
      const item = items[(activeIndex + offset + items.length) % items.length];
      const text = item?.textContent?.normalize("NFKC").trim()
        .replace(/\s+/g, " ").toLocaleLowerCase();
      if (item && text?.startsWith(query)) {
        event.preventDefault();
        focusWithoutScroll(item);
        break;
      }
    }
  }, [onKeyDown, setOpen, triggerRef]);
}
