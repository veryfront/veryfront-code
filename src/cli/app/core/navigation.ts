// Navigation Stack Module
// Pure, immutable navigation stack for TUI history management

import type { NavEntry, NavStack, View } from "./types.ts";

// ============================================================================
// State Updaters
// ============================================================================

export type NavStackUpdater = (stack: NavStack) => NavStack;

export function push(view: View, params?: Record<string, string>): NavStackUpdater {
  return (stack) => {
    const entry: NavEntry = { view, params };
    const newStack = [...stack.stack, entry];

    // Trim stack if exceeds max size (keep most recent)
    if (newStack.length > stack.maxSize) {
      return {
        ...stack,
        stack: newStack.slice(newStack.length - stack.maxSize),
      };
    }

    return { ...stack, stack: newStack };
  };
}

export function pop(stack: NavStack): { stack: NavStack; popped: NavEntry | null } {
  if (stack.stack.length === 0) {
    return { stack, popped: null };
  }

  const popped = stack.stack[stack.stack.length - 1] ?? null;
  return {
    stack: {
      ...stack,
      stack: stack.stack.slice(0, -1),
    },
    popped,
  };
}

export function peek(stack: NavStack): NavEntry | null {
  return stack.stack[stack.stack.length - 1] ?? null;
}

export function peekPrevious(stack: NavStack): NavEntry | null {
  if (stack.stack.length < 2) return null;
  return stack.stack[stack.stack.length - 2] ?? null;
}

export function replace(view: View, params?: Record<string, string>): NavStackUpdater {
  return (stack) => {
    if (stack.stack.length === 0) {
      return push(view, params)(stack);
    }

    const entry: NavEntry = { view, params };
    return {
      ...stack,
      stack: [...stack.stack.slice(0, -1), entry],
    };
  };
}

export function navigate(view: View, params?: Record<string, string>): NavStackUpdater {
  return push(view, params);
}

export function goTo(view: View): NavStackUpdater {
  return (stack) => {
    // Find the most recent occurrence of this view
    const idx = findLastIndex(stack.stack, (e) => e.view === view);

    if (idx >= 0) {
      // Found - pop back to it (keep it and everything before)
      return {
        ...stack,
        stack: stack.stack.slice(0, idx + 1),
      };
    }

    // Not found - push new entry
    return push(view)(stack);
  };
}

export function clear(): NavStackUpdater {
  return (stack) => ({ ...stack, stack: [] });
}

export function saveScrollPosition(position: number): NavStackUpdater {
  return (stack) => {
    if (stack.stack.length === 0) return stack;

    const current = stack.stack[stack.stack.length - 1];
    if (!current) return stack;

    const updated: NavEntry = { ...current, scrollPosition: position };
    return {
      ...stack,
      stack: [...stack.stack.slice(0, -1), updated],
    };
  };
}

// ============================================================================
// Go-To Shortcuts
// ============================================================================

export const GO_TO_SHORTCUTS: Record<string, View> = {
  d: "dashboard",
  p: "project-detail",
  r: "resources",
  s: "settings",
  h: "help",
};

export function handleGoToShortcut(key: string): View | null {
  return GO_TO_SHORTCUTS[key] ?? null;
}

// ============================================================================
// Query Functions
// ============================================================================

export function getBreadcrumbs(stack: NavStack): View[] {
  return stack.stack.map((e) => e.view);
}

export function canGoBack(stack: NavStack): boolean {
  return stack.stack.length > 0;
}

export function depth(stack: NavStack): number {
  return stack.stack.length;
}

export function hasView(stack: NavStack, view: View): boolean {
  return stack.stack.some((e) => e.view === view);
}

export function getParams(stack: NavStack, view: View): Record<string, string> | undefined {
  const idx = findLastIndex(stack.stack, (e) => e.view === view);
  if (idx < 0) return undefined;
  return stack.stack[idx]?.params;
}

// ============================================================================
// Helpers
// ============================================================================

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i] as T)) return i;
  }
  return -1;
}
