/**
 * Remote Project Navigation Handlers
 *
 * Handles keyboard navigation for the remote projects list,
 * including focus management and scroll offset calculations.
 */

import type { AppState, StateUpdater } from "../state.ts";
import { updateRemote } from "../state.ts";

const VISIBLE_COUNT = 5;

/**
 * Update focus to a specific index with scroll offset adjustment
 */
export function updateRemoteFocus(
  state: AppState,
  newIndex: number,
): StateUpdater {
  let scrollOffset = state.remote.scrollOffset;

  if (newIndex < scrollOffset) {
    scrollOffset = newIndex;
  } else if (newIndex >= scrollOffset + VISIBLE_COUNT) {
    scrollOffset = newIndex - VISIBLE_COUNT + 1;
  }

  return updateRemote({ focusedIndex: newIndex, scrollOffset });
}

/**
 * Move focus up in the remote projects list (with wrap-around)
 */
export function moveRemoteFocusUp(state: AppState): StateUpdater {
  const total = state.remote.projects.length;
  const newIndex = state.remote.focusedIndex > 0 ? state.remote.focusedIndex - 1 : total - 1;

  let scrollOffset = state.remote.scrollOffset;

  if (newIndex < scrollOffset) {
    scrollOffset = newIndex;
  } else if (newIndex === total - 1) {
    scrollOffset = Math.max(0, total - VISIBLE_COUNT);
  }

  return updateRemote({ focusedIndex: newIndex, scrollOffset });
}

/**
 * Move focus down in the remote projects list (with wrap-around)
 */
export function moveRemoteFocusDown(state: AppState): StateUpdater {
  const total = state.remote.projects.length;
  const newIndex = state.remote.focusedIndex < total - 1 ? state.remote.focusedIndex + 1 : 0;

  let scrollOffset = state.remote.scrollOffset;

  if (newIndex === 0) {
    scrollOffset = 0;
  } else if (newIndex >= scrollOffset + VISIBLE_COUNT) {
    scrollOffset = newIndex - VISIBLE_COUNT + 1;
  }

  return updateRemote({ focusedIndex: newIndex, scrollOffset });
}
