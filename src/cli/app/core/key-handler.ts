// Key Handler Module
// Routes key events to appropriate handlers based on current app state

import type { AppState, AppUpdater } from "./app-state.ts";
import {
  closeAllModals,
  compose,
  getActiveModal,
  setMode,
  setView,
  updateAgents,
  updateCommandPalette,
  updateConfirmation,
  updateKeyChord,
  updateProjectDetail,
  updateResourceViewer,
  updateSearch,
} from "./app-state.ts";

import { clearChord as _clearChord, handleVimKey } from "./keybindings.ts";
import { COMMAND_KEY, SEARCH_KEY } from "./mode.ts";
import { GO_TO_SHORTCUTS } from "./navigation.ts";
import type { View } from "./types.ts";

import {
  handleCommandPaletteKey,
  openCommandPalette,
} from "../components/modals/command-palette.ts";
import { handleSearchKey, openSearch } from "../components/modals/search.ts";
import { handleAgentPickerKey, openAgentPicker } from "../components/modals/agent-picker.ts";
import { handleConfirmationKey } from "../components/modals/confirmation.ts";
import { handleResourceViewerKey } from "../components/views/resource-viewer.ts";
import { handleProjectDetailKey } from "../components/views/project-detail.ts";

// ============================================================================
// Key Handler Result
// ============================================================================

export interface KeyHandlerResult {
  handled: boolean;
  updater?: AppUpdater;
  action?: KeyAction;
}

export type KeyAction =
  | { type: "quit" }
  | { type: "navigate"; view: View }
  | { type: "execute-command"; commandId: string }
  | { type: "launch-agent"; agentId: string }
  | { type: "open-file"; path: string }
  | { type: "open-route"; path: string }
  | { type: "open-browser"; url?: string }
  | { type: "open-ide" }
  | { type: "deploy" }
  | { type: "confirm"; result: boolean }
  | { type: "refresh" };

// ============================================================================
// Main Key Handler
// ============================================================================

export function handleKey(key: string, _state: AppState): KeyHandlerResult {
  // 1. Handle modals first (they capture all input)
  const modal = getActiveModal(state);
  if (modal) {
    return handleModalKey(key, state, modal);
  }

  // 2. Handle global keys (available in any mode)
  const globalResult = handleGlobalKey(key, state);
  if (globalResult.handled) {
    return globalResult;
  }

  // 3. Handle mode-specific keys
  switch (state.mode) {
    case "NORMAL":
      return handleNormalModeKey(key, state);
    case "COMMAND":
      return {
        handled: true,
        updater: compose(
          updateCommandPalette(openCommandPalette()),
          setMode("COMMAND"),
        ),
      };
    case "SEARCH":
      return {
        handled: true,
        updater: compose(
          updateSearch(openSearch()),
          setMode("SEARCH"),
        ),
      };
    case "INSERT":
      return { handled: false };
    default:
      return { handled: false };
  }
}

// ============================================================================
// Modal Key Handling
// ============================================================================

function handleModalKey(
  key: string,
  state: AppState,
  modal: "command" | "search" | "agent" | "confirmation",
): KeyHandlerResult {
  switch (modal) {
    case "command":
      return handleCommandModalKey(key, state);
    case "search":
      return handleSearchModalKey(key, state);
    case "agent":
      return handleAgentModalKey(key, state);
    case "confirmation":
      return handleConfirmModalKey(key, state);
    default:
      return { handled: false };
  }
}

function handleCommandModalKey(key: string, _state: AppState): KeyHandlerResult {
  const result = handleCommandPaletteKey(key, state.commandPalette);

  if (!result.handled) {
    return { handled: false };
  }

  const updaters: AppUpdater[] = [];

  if (result.updater) {
    updaters.push(updateCommandPalette(result.updater));
  }

  if (result.close) {
    updaters.push(closeAllModals());
  }

  if (result.executeCommand) {
    return {
      handled: true,
      updater: updaters.length > 0 ? compose(...updaters) : undefined,
      action: { type: "execute-command", commandId: result.executeCommand.id },
    };
  }

  return {
    handled: true,
    updater: updaters.length > 0 ? compose(...updaters) : undefined,
  };
}

function handleSearchModalKey(key: string, _state: AppState): KeyHandlerResult {
  const result = handleSearchKey(key, state.search);

  if (!result.handled) {
    return { handled: false };
  }

  const updaters: AppUpdater[] = [];

  if (result.updater) {
    updaters.push(updateSearch(result.updater));
  }

  if (result.close) {
    updaters.push(closeAllModals());
  }

  if (result.selectResult) {
    const resultItem = result.selectResult;
    if (resultItem.type === "file") {
      return {
        handled: true,
        updater: updaters.length > 0 ? compose(...updaters) : undefined,
        action: { type: "open-file", path: resultItem.path ?? resultItem.id },
      };
    }
    if (resultItem.type === "route") {
      return {
        handled: true,
        updater: updaters.length > 0 ? compose(...updaters) : undefined,
        action: { type: "open-route", path: resultItem.path ?? resultItem.id },
      };
    }
    if (resultItem.type === "command") {
      return {
        handled: true,
        updater: updaters.length > 0 ? compose(...updaters) : undefined,
        action: { type: "execute-command", commandId: resultItem.id },
      };
    }
  }

  return {
    handled: true,
    updater: updaters.length > 0 ? compose(...updaters) : undefined,
  };
}

function handleAgentModalKey(key: string, _state: AppState): KeyHandlerResult {
  const result = handleAgentPickerKey(key, state.agents);

  if (!result.handled) {
    return { handled: false };
  }

  const updaters: AppUpdater[] = [];

  if (result.updater) {
    updaters.push(updateAgents(result.updater));
  }

  if (result.close) {
    updaters.push(closeAllModals());
  }

  if (result.launchAgent) {
    return {
      handled: true,
      updater: updaters.length > 0 ? compose(...updaters) : undefined,
      action: { type: "launch-agent", agentId: result.launchAgent.id },
    };
  }

  return {
    handled: true,
    updater: updaters.length > 0 ? compose(...updaters) : undefined,
  };
}

function handleConfirmModalKey(key: string, _state: AppState): KeyHandlerResult {
  const result = handleConfirmationKey(key, state.confirmation);

  if (!result.handled) {
    return { handled: false };
  }

  const updaters: AppUpdater[] = [];

  if (result.updater) {
    updaters.push(updateConfirmation(result.updater));
  }

  if (result.close) {
    updaters.push(closeAllModals());
    const confirmed = key === "y" || key === "Y" ||
      (key === "\r" && state.confirmation.selectedIndex === 0);
    return {
      handled: true,
      updater: compose(...updaters),
      action: { type: "confirm", result: confirmed },
    };
  }

  return {
    handled: true,
    updater: updaters.length > 0 ? compose(...updaters) : undefined,
  };
}

// ============================================================================
// Global Key Handling
// ============================================================================

function handleGlobalKey(key: string, _state: AppState): KeyHandlerResult {
  // Ctrl+C - force quit
  if (key === "\x03") {
    return { handled: true, action: { type: "quit" } };
  }

  // Ctrl+P - open search
  if (key === "\x10") {
    return {
      handled: true,
      updater: compose(
        updateSearch(openSearch()),
        setMode("SEARCH"),
      ),
    };
  }

  // Ctrl+A - open agent picker
  if (key === "\x01" && state.mode === "NORMAL") {
    return {
      handled: true,
      updater: updateAgents(openAgentPicker()),
    };
  }

  return { handled: false };
}

// ============================================================================
// Normal Mode Key Handling
// ============================================================================

function handleNormalModeKey(key: string, _state: AppState): KeyHandlerResult {
  // q - quit
  if (key === "q" && !state.keyChord.pending) {
    return { handled: true, action: { type: "quit" } };
  }

  // : - enter command mode
  if (key === COMMAND_KEY) {
    return {
      handled: true,
      updater: compose(
        updateCommandPalette(openCommandPalette()),
        setMode("COMMAND"),
      ),
    };
  }

  // / - enter search mode
  if (key === SEARCH_KEY) {
    return {
      handled: true,
      updater: compose(
        updateSearch(openSearch()),
        setMode("SEARCH"),
      ),
    };
  }

  // ? - help
  if (key === "?") {
    return { handled: true, updater: setView("help") };
  }

  // Escape - go back or cancel
  if (key === "\x1b") {
    if (state.navStack.length > 1) {
      return {
        handled: true,
        updater: (s) => {
          const newStack = s.navStack.slice(0, -1);
          const prev = newStack[newStack.length - 1];
          return {
            ...s,
            navStack: newStack,
            view: (prev?.view as View) ?? "dashboard",
          };
        },
      };
    }
    return { handled: true };
  }

  // Handle vim keys with chords
  const vimResult = handleVimKey(key, state.keyChord);

  if (vimResult.consumed) {
    const updaters: AppUpdater[] = [];

    updaters.push(updateKeyChord(() => vimResult.chord));

    // Handle go-to shortcut (g + key)
    if (vimResult.stringAction?.startsWith("go:")) {
      const target = vimResult.stringAction.slice(3);
      const view = GO_TO_SHORTCUTS[target];
      if (view) {
        updaters.push(setView(view));
      }
    }

    // Handle navigation in current view
    if (vimResult.navAction) {
      const viewResult = handleViewNavigation(key, state);
      if (viewResult.updater) {
        updaters.push(viewResult.updater);
      }
    }

    return {
      handled: true,
      updater: updaters.length > 0 ? compose(...updaters) : undefined,
    };
  }

  // Delegate to view-specific handler
  return handleViewKey(key, state);
}

// ============================================================================
// View-Specific Key Handling
// ============================================================================

function handleViewKey(key: string, _state: AppState): KeyHandlerResult {
  switch (state.view) {
    case "resources":
      return handleResourcesViewKey(key, state);
    case "project-detail":
      return handleProjectDetailViewKey(key, state);
    default:
      return handleViewNavigation(key, state);
  }
}

function handleResourcesViewKey(key: string, _state: AppState): KeyHandlerResult {
  const result = handleResourceViewerKey(key, state.resourceViewer);

  if (!result.handled) {
    return { handled: false };
  }

  const updaters: AppUpdater[] = [];

  if (result.updater) {
    updaters.push(updateResourceViewer(result.updater));
  }

  if (result.close) {
    updaters.push(setView("dashboard"));
  }

  if (result.action === "open" && result.selectedItem) {
    const item = result.selectedItem;
    if (item.type === "files") {
      return {
        handled: true,
        updater: updaters.length > 0 ? compose(...updaters) : undefined,
        action: { type: "open-file", path: item.id },
      };
    }
  }

  return {
    handled: true,
    updater: updaters.length > 0 ? compose(...updaters) : undefined,
  };
}

function handleProjectDetailViewKey(key: string, _state: AppState): KeyHandlerResult {
  const result = handleProjectDetailKey(key, state.projectDetail);

  if (!result.handled) {
    return { handled: false };
  }

  const updaters: AppUpdater[] = [];

  if (result.updater) {
    updaters.push(updateProjectDetail(result.updater));
  }

  if (result.close) {
    updaters.push(setView("dashboard"));
  }

  if (result.action) {
    switch (result.action) {
      case "browser":
        return {
          handled: true,
          updater: updaters.length > 0 ? compose(...updaters) : undefined,
          action: { type: "open-browser" },
        };
      case "ide":
        return {
          handled: true,
          updater: updaters.length > 0 ? compose(...updaters) : undefined,
          action: { type: "open-ide" },
        };
      case "deploy":
        return {
          handled: true,
          updater: updaters.length > 0 ? compose(...updaters) : undefined,
          action: { type: "deploy" },
        };
      case "open":
        if (result.selectedFile) {
          return {
            handled: true,
            updater: updaters.length > 0 ? compose(...updaters) : undefined,
            action: { type: "open-file", path: result.selectedFile.path },
          };
        }
        if (result.selectedRoute) {
          return {
            handled: true,
            updater: updaters.length > 0 ? compose(...updaters) : undefined,
            action: { type: "open-route", path: result.selectedRoute.path },
          };
        }
        break;
    }
  }

  return {
    handled: true,
    updater: updaters.length > 0 ? compose(...updaters) : undefined,
  };
}

function handleViewNavigation(key: string, _state: AppState): KeyHandlerResult {
  // n - new project
  if (key === "n") {
    return { handled: true, updater: setView("new-project") };
  }

  // r - refresh
  if (key === "r") {
    return { handled: true, action: { type: "refresh" } };
  }

  return { handled: false };
}
