/**
 * Tests for confirmation dialog component
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  closeConfirmation,
  handleConfirmationKey,
  moveSelection,
  openConfirmation,
  renderConfirmation,
  selectCurrent,
} from "./confirmation.ts";
import { createConfirmationState } from "../../core/types.ts";

describe("openConfirmation", () => {
  it("opens dialog with options", () => {
    const state = createConfirmationState();
    const onConfirm = () => {};
    const onCancel = () => {};

    const result = openConfirmation(
      {
        title: "Delete Project",
        message: "Are you sure?",
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        variant: "danger",
      },
      onConfirm,
      onCancel,
    )(state);

    expect(result.open).toBe(true);
    expect(result.options?.title).toBe("Delete Project");
    expect(result.options?.variant).toBe("danger");
    expect(result.selectedIndex).toBe(0);
  });

  it("sets callbacks", () => {
    const state = createConfirmationState();
    let confirmed = false;
    let cancelled = false;

    const result = openConfirmation(
      { title: "Test", message: "Test" },
      () => {
        confirmed = true;
      },
      () => {
        cancelled = true;
      },
    )(state);

    result.onConfirm?.();
    result.onCancel?.();

    expect(confirmed).toBe(true);
    expect(cancelled).toBe(true);
  });
});

describe("closeConfirmation", () => {
  it("resets state", () => {
    let state = createConfirmationState();
    state = openConfirmation(
      { title: "Test", message: "Test" },
      () => {},
    )(state);

    const result = closeConfirmation()(state);

    expect(result.open).toBe(false);
    expect(result.options).toBeNull();
    expect(result.onConfirm).toBeNull();
  });
});

describe("moveSelection", () => {
  it("moves down", () => {
    let state = createConfirmationState();
    state = openConfirmation(
      { title: "Test", message: "Test" },
      () => {},
    )(state);

    const result = moveSelection(1)(state);
    expect(result.selectedIndex).toBe(1);
  });

  it("moves up", () => {
    let state = createConfirmationState();
    state = {
      ...state,
      open: true,
      selectedIndex: 1,
      options: null,
      onConfirm: null,
      onCancel: null,
    };

    const result = moveSelection(-1)(state);
    expect(result.selectedIndex).toBe(0);
  });

  it("wraps at bottom", () => {
    let state = createConfirmationState();
    state = {
      ...state,
      open: true,
      selectedIndex: 1,
      options: null,
      onConfirm: null,
      onCancel: null,
    };

    const result = moveSelection(1)(state);
    expect(result.selectedIndex).toBe(0);
  });

  it("wraps at top", () => {
    let state = createConfirmationState();
    state = {
      ...state,
      open: true,
      selectedIndex: 0,
      options: null,
      onConfirm: null,
      onCancel: null,
    };

    const result = moveSelection(-1)(state);
    expect(result.selectedIndex).toBe(1);
  });
});

describe("selectCurrent", () => {
  it("calls onConfirm when selected", () => {
    let confirmed = false;

    const state = {
      open: true,
      selectedIndex: 0,
      options: { title: "Test", message: "Test" },
      onConfirm: () => {
        confirmed = true;
      },
      onCancel: null,
    };

    selectCurrent(state);
    expect(confirmed).toBe(true);
  });

  it("calls onCancel when selected", () => {
    let cancelled = false;

    const state = {
      open: true,
      selectedIndex: 1,
      options: { title: "Test", message: "Test" },
      onConfirm: null,
      onCancel: () => {
        cancelled = true;
      },
    };

    selectCurrent(state);
    expect(cancelled).toBe(true);
  });

  it("returns true to close", () => {
    const state = {
      open: true,
      selectedIndex: 0,
      options: null,
      onConfirm: null,
      onCancel: null,
    };

    expect(selectCurrent(state)).toBe(true);
  });
});

describe("renderConfirmation", () => {
  it("returns empty string when closed", () => {
    const state = createConfirmationState();
    expect(renderConfirmation(state)).toBe("");
  });

  it("renders dialog content", () => {
    let state = createConfirmationState();
    state = openConfirmation(
      {
        title: "Confirm Action",
        message: "Are you sure you want to proceed?",
        confirmLabel: "Yes",
        cancelLabel: "No",
      },
      () => {},
    )(state);

    const result = renderConfirmation(state);

    expect(result).toContain("Confirm Action");
    expect(result).toContain("Are you sure");
    expect(result).toContain("Yes");
    expect(result).toContain("No");
  });

  it("shows selection indicator", () => {
    let state = createConfirmationState();
    state = openConfirmation(
      {
        title: "Test",
        message: "Test",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
      },
      () => {},
    )(state);

    const result = renderConfirmation(state);
    // First option should have indicator
    expect(result).toContain("›");
    expect(result).toContain("Confirm");
  });
});

describe("handleConfirmationKey", () => {
  it("returns not handled when closed", () => {
    const state = createConfirmationState();
    const result = handleConfirmationKey("j", state);
    expect(result.handled).toBe(false);
  });

  it("handles escape to cancel", () => {
    let cancelled = false;
    const state = {
      open: true,
      selectedIndex: 0,
      options: { title: "Test", message: "Test" },
      onConfirm: null,
      onCancel: () => {
        cancelled = true;
      },
    };

    const result = handleConfirmationKey("\x1b", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(cancelled).toBe(true);
  });

  it("handles enter to select", () => {
    let confirmed = false;
    const state = {
      open: true,
      selectedIndex: 0,
      options: { title: "Test", message: "Test" },
      onConfirm: () => {
        confirmed = true;
      },
      onCancel: null,
    };

    const result = handleConfirmationKey("\r", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(confirmed).toBe(true);
  });

  it("handles j to move down", () => {
    const state = {
      open: true,
      selectedIndex: 0,
      options: { title: "Test", message: "Test" },
      onConfirm: null,
      onCancel: null,
    };

    const result = handleConfirmationKey("j", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(false);
    expect(result.updater).toBeDefined();
  });

  it("handles k to move up", () => {
    const state = {
      open: true,
      selectedIndex: 1,
      options: { title: "Test", message: "Test" },
      onConfirm: null,
      onCancel: null,
    };

    const result = handleConfirmationKey("k", state);
    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles y for quick confirm", () => {
    let confirmed = false;
    const state = {
      open: true,
      selectedIndex: 1, // Even if cancel is selected
      options: { title: "Test", message: "Test" },
      onConfirm: () => {
        confirmed = true;
      },
      onCancel: null,
    };

    const result = handleConfirmationKey("y", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(confirmed).toBe(true);
  });

  it("handles n for quick cancel", () => {
    let cancelled = false;
    const state = {
      open: true,
      selectedIndex: 0, // Even if confirm is selected
      options: { title: "Test", message: "Test" },
      onConfirm: null,
      onCancel: () => {
        cancelled = true;
      },
    };

    const result = handleConfirmationKey("n", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(true);
    expect(cancelled).toBe(true);
  });

  it("consumes unhandled keys", () => {
    const state = {
      open: true,
      selectedIndex: 0,
      options: { title: "Test", message: "Test" },
      onConfirm: null,
      onCancel: null,
    };

    const result = handleConfirmationKey("x", state);
    expect(result.handled).toBe(true);
    expect(result.close).toBe(false);
  });
});
