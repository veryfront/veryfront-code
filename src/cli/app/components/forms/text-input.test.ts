/**
 * Tests for text input component
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  clearInput,
  compose,
  createTextInput,
  deleteBackward,
  deleteForward,
  handleTextInputKey,
  insertText,
  maxLength,
  minLength,
  moveCursorLeft,
  moveCursorRight,
  moveCursorToEnd,
  moveCursorToStart,
  pattern,
  renderTextInput,
  required,
  setValidation,
  slug,
  TextInputStateSchema as _TextInputStateSchema,
  validate,
  ValidationResultSchema,
} from "./text-input.ts";

describe("ValidationResultSchema", () => {
  it("validates result with message", () => {
    const result = ValidationResultSchema.parse({
      valid: false,
      message: "Error",
    });

    expect(result.valid).toBe(false);
    expect(result.message).toBe("Error");
  });

  it("validates result without message", () => {
    const result = ValidationResultSchema.parse({ valid: true });
    expect(result.valid).toBe(true);
  });
});

describe("createTextInput", () => {
  it("creates empty state", () => {
    const state = createTextInput("Name:");

    expect(state.prompt).toBe("Name:");
    expect(state.value).toBe("");
    expect(state.cursorPosition).toBe(0);
    expect(state.validation).toBeNull();
  });

  it("respects initial value", () => {
    const state = createTextInput("Name:", { initialValue: "test" });

    expect(state.value).toBe("test");
    expect(state.cursorPosition).toBe(4);
  });

  it("respects placeholder", () => {
    const state = createTextInput("Name:", { placeholder: "Enter name" });
    expect(state.placeholder).toBe("Enter name");
  });
});

describe("insertText", () => {
  it("inserts at cursor", () => {
    let state = createTextInput("Name:");
    state = insertText("hello")(state);

    expect(state.value).toBe("hello");
    expect(state.cursorPosition).toBe(5);
  });

  it("inserts in middle", () => {
    let state = createTextInput("Name:", { initialValue: "helo" });
    state = { ...state, cursorPosition: 3 };
    state = insertText("l")(state);

    expect(state.value).toBe("hello");
    expect(state.cursorPosition).toBe(4);
  });

  it("clears validation on change", () => {
    let state = createTextInput("Name:");
    state = setValidation({ valid: false, message: "Error" })(state);
    state = insertText("a")(state);

    expect(state.validation).toBeNull();
  });
});

describe("deleteBackward", () => {
  it("deletes before cursor", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = deleteBackward()(state);

    expect(state.value).toBe("hell");
    expect(state.cursorPosition).toBe(4);
  });

  it("does nothing at start", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = { ...state, cursorPosition: 0 };
    state = deleteBackward()(state);

    expect(state.value).toBe("hello");
    expect(state.cursorPosition).toBe(0);
  });
});

describe("deleteForward", () => {
  it("deletes after cursor", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = { ...state, cursorPosition: 0 };
    state = deleteForward()(state);

    expect(state.value).toBe("ello");
    expect(state.cursorPosition).toBe(0);
  });

  it("does nothing at end", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = deleteForward()(state);

    expect(state.value).toBe("hello");
  });
});

describe("moveCursorLeft", () => {
  it("moves left", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = moveCursorLeft()(state);

    expect(state.cursorPosition).toBe(4);
  });

  it("stops at start", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = { ...state, cursorPosition: 0 };
    state = moveCursorLeft()(state);

    expect(state.cursorPosition).toBe(0);
  });
});

describe("moveCursorRight", () => {
  it("moves right", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = { ...state, cursorPosition: 0 };
    state = moveCursorRight()(state);

    expect(state.cursorPosition).toBe(1);
  });

  it("stops at end", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = moveCursorRight()(state);

    expect(state.cursorPosition).toBe(5);
  });
});

describe("moveCursorToStart", () => {
  it("moves to start", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = moveCursorToStart()(state);

    expect(state.cursorPosition).toBe(0);
  });
});

describe("moveCursorToEnd", () => {
  it("moves to end", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = { ...state, cursorPosition: 0 };
    state = moveCursorToEnd()(state);

    expect(state.cursorPosition).toBe(5);
  });
});

describe("clearInput", () => {
  it("clears value and cursor", () => {
    let state = createTextInput("Name:", { initialValue: "hello" });
    state = clearInput()(state);

    expect(state.value).toBe("");
    expect(state.cursorPosition).toBe(0);
  });
});

describe("validators", () => {
  describe("required", () => {
    it("fails for empty", () => {
      const result = required()("");
      expect(result.valid).toBe(false);
    });

    it("passes for non-empty", () => {
      const result = required()("test");
      expect(result.valid).toBe(true);
    });
  });

  describe("minLength", () => {
    it("fails for short input", () => {
      const result = minLength(5)("abc");
      expect(result.valid).toBe(false);
    });

    it("passes for long enough input", () => {
      const result = minLength(3)("abc");
      expect(result.valid).toBe(true);
    });
  });

  describe("maxLength", () => {
    it("fails for long input", () => {
      const result = maxLength(3)("abcdef");
      expect(result.valid).toBe(false);
    });

    it("passes for short enough input", () => {
      const result = maxLength(5)("abc");
      expect(result.valid).toBe(true);
    });
  });

  describe("pattern", () => {
    it("fails for non-matching input", () => {
      const result = pattern(/^\d+$/)("abc");
      expect(result.valid).toBe(false);
    });

    it("passes for matching input", () => {
      const result = pattern(/^\d+$/)("123");
      expect(result.valid).toBe(true);
    });
  });

  describe("slug", () => {
    it("fails for invalid slug", () => {
      const result = slug()("Hello World");
      expect(result.valid).toBe(false);
    });

    it("passes for valid slug", () => {
      const result = slug()("hello-world-123");
      expect(result.valid).toBe(true);
    });
  });

  describe("compose", () => {
    it("runs validators in order", () => {
      const validator = compose(required(), minLength(3));

      expect(validator("").valid).toBe(false);
      expect(validator("ab").valid).toBe(false);
      expect(validator("abc").valid).toBe(true);
    });
  });
});

describe("validate", () => {
  it("sets validation result", () => {
    let state = createTextInput("Name:", { initialValue: "" });
    state = validate(required())(state);

    expect(state.validation?.valid).toBe(false);
  });
});

describe("renderTextInput", () => {
  it("renders prompt and cursor", () => {
    const state = createTextInput("Name:");
    const result = renderTextInput(state);

    expect(result).toContain("Name:");
    expect(result).toContain(">");
    expect(result).toContain("Enter to confirm");
  });

  it("shows placeholder when empty", () => {
    const state = createTextInput("Name:", { placeholder: "Enter name" });
    const result = renderTextInput(state);

    expect(result).toContain("Enter name");
  });

  it("shows validation error", () => {
    let state = createTextInput("Name:");
    state = setValidation({ valid: false, message: "Required" })(state);
    const result = renderTextInput(state);

    expect(result).toContain("✗");
    expect(result).toContain("Required");
  });

  it("shows validation success", () => {
    let state = createTextInput("Name:", { initialValue: "test" });
    state = setValidation({ valid: true, message: "Looks good" })(state);
    const result = renderTextInput(state);

    expect(result).toContain("✓");
    expect(result).toContain("Looks good");
  });
});

describe("handleTextInputKey", () => {
  it("handles enter to confirm", () => {
    const result = handleTextInputKey("\r");
    expect(result.confirmed).toBe(true);
  });

  it("handles escape to cancel", () => {
    const result = handleTextInputKey("\x1b");
    expect(result.cancelled).toBe(true);
  });

  it("handles backspace", () => {
    const result = handleTextInputKey("\x7f");
    expect(result.updater).toBeDefined();
  });

  it("handles left arrow", () => {
    const result = handleTextInputKey("\x1b[D");
    expect(result.updater).toBeDefined();
  });

  it("handles right arrow", () => {
    const result = handleTextInputKey("\x1b[C");
    expect(result.updater).toBeDefined();
  });

  it("handles Ctrl+A for start", () => {
    const result = handleTextInputKey("\x01");
    expect(result.updater).toBeDefined();
  });

  it("handles Ctrl+E for end", () => {
    const result = handleTextInputKey("\x05");
    expect(result.updater).toBeDefined();
  });

  it("handles Ctrl+U to clear", () => {
    const result = handleTextInputKey("\x15");
    expect(result.updater).toBeDefined();
  });

  it("handles character input", () => {
    const result = handleTextInputKey("a");
    expect(result.updater).toBeDefined();
  });
});
