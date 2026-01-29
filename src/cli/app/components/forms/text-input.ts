/**
 * Text Input Component
 *
 * Single-line text input with optional validation.
 */

import { z } from "zod";
import { brand, dim, error as errorColor, muted, success } from "../../../ui/colors.ts";

// ============================================================================
// Schemas
// ============================================================================

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  message: z.string().optional(),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export type Validator = (value: string) => ValidationResult;

export const TextInputStateSchema = z.object({
  /** Current input value */
  value: z.string(),
  /** Cursor position */
  cursorPosition: z.number(),
  /** Prompt text */
  prompt: z.string(),
  /** Placeholder text */
  placeholder: z.string().optional(),
  /** Validation result */
  validation: ValidationResultSchema.nullable(),
});

export type TextInputState = z.infer<typeof TextInputStateSchema>;

// ============================================================================
// State Management
// ============================================================================

export type TextInputUpdater = (state: TextInputState) => TextInputState;

/** Create text input state */
export function createTextInput(
  prompt: string,
  options: { placeholder?: string; initialValue?: string } = {},
): TextInputState {
  const value = options.initialValue ?? "";
  return {
    prompt,
    value,
    cursorPosition: value.length,
    placeholder: options.placeholder,
    validation: null,
  };
}

/** Insert text at cursor */
export function insertText(text: string): TextInputUpdater {
  return (state) => {
    const before = state.value.slice(0, state.cursorPosition);
    const after = state.value.slice(state.cursorPosition);
    const newValue = before + text + after;

    return {
      ...state,
      value: newValue,
      cursorPosition: state.cursorPosition + text.length,
      validation: null, // Clear validation on change
    };
  };
}

/** Delete character before cursor */
export function deleteBackward(): TextInputUpdater {
  return (state) => {
    if (state.cursorPosition === 0) return state;

    const before = state.value.slice(0, state.cursorPosition - 1);
    const after = state.value.slice(state.cursorPosition);

    return {
      ...state,
      value: before + after,
      cursorPosition: state.cursorPosition - 1,
      validation: null,
    };
  };
}

/** Delete character after cursor */
export function deleteForward(): TextInputUpdater {
  return (state) => {
    if (state.cursorPosition >= state.value.length) return state;

    const before = state.value.slice(0, state.cursorPosition);
    const after = state.value.slice(state.cursorPosition + 1);

    return {
      ...state,
      value: before + after,
      validation: null,
    };
  };
}

/** Move cursor left */
export function moveCursorLeft(): TextInputUpdater {
  return (state) => ({
    ...state,
    cursorPosition: Math.max(0, state.cursorPosition - 1),
  });
}

/** Move cursor right */
export function moveCursorRight(): TextInputUpdater {
  return (state) => ({
    ...state,
    cursorPosition: Math.min(state.value.length, state.cursorPosition + 1),
  });
}

/** Move cursor to start */
export function moveCursorToStart(): TextInputUpdater {
  return (state) => ({
    ...state,
    cursorPosition: 0,
  });
}

/** Move cursor to end */
export function moveCursorToEnd(): TextInputUpdater {
  return (state) => ({
    ...state,
    cursorPosition: state.value.length,
  });
}

/** Clear input */
export function clearInput(): TextInputUpdater {
  return (state) => ({
    ...state,
    value: "",
    cursorPosition: 0,
    validation: null,
  });
}

/** Set validation result */
export function setValidation(result: ValidationResult): TextInputUpdater {
  return (state) => ({
    ...state,
    validation: result,
  });
}

/** Validate input with validator function */
export function validate(validator: Validator): TextInputUpdater {
  return (state) => ({
    ...state,
    validation: validator(state.value),
  });
}

// ============================================================================
// Built-in Validators
// ============================================================================

/** Required validator */
export function required(message = "This field is required"): Validator {
  return (value) => ({
    valid: value.trim().length > 0,
    message: value.trim().length > 0 ? undefined : message,
  });
}

/** Min length validator */
export function minLength(min: number, message?: string): Validator {
  return (value) => ({
    valid: value.length >= min,
    message: value.length >= min ? undefined : message ?? `Minimum ${min} characters`,
  });
}

/** Max length validator */
export function maxLength(max: number, message?: string): Validator {
  return (value) => ({
    valid: value.length <= max,
    message: value.length <= max ? undefined : message ?? `Maximum ${max} characters`,
  });
}

/** Pattern validator */
export function pattern(regex: RegExp, message = "Invalid format"): Validator {
  return (value) => ({
    valid: regex.test(value),
    message: regex.test(value) ? undefined : message,
  });
}

/** Slug validator (lowercase, numbers, hyphens) */
export function slug(message = "Only lowercase letters, numbers, and hyphens"): Validator {
  return pattern(/^[a-z0-9-]+$/, message);
}

/** Combine validators */
export function compose(...validators: Validator[]): Validator {
  return (value) => {
    for (const validator of validators) {
      const result = validator(value);
      if (!result.valid) return result;
    }
    return { valid: true };
  };
}

// ============================================================================
// Rendering
// ============================================================================

/** Render text input */
export function renderTextInput(state: TextInputState): string {
  const lines: string[] = [];

  // Prompt
  lines.push(state.prompt);
  lines.push("");

  // Input line with cursor
  const before = state.value.slice(0, state.cursorPosition);
  const cursor = brand("_");
  const after = state.value.slice(state.cursorPosition);

  const _displayValue = state.value || state.placeholder;
  if (!state.value && state.placeholder) {
    lines.push(`> ${dim(state.placeholder)}${cursor}`);
  } else {
    lines.push(`> ${before}${cursor}${after}`);
  }

  lines.push("");

  // Validation message
  if (state.validation) {
    if (state.validation.valid) {
      lines.push(success("✓") + " " + (state.validation.message || "Valid"));
    } else {
      lines.push(errorColor("✗") + " " + (state.validation.message || "Invalid"));
    }
  }

  lines.push("");
  lines.push(muted("Enter to confirm  Esc to cancel  Ctrl+U to clear"));

  return lines.join("\n");
}

// ============================================================================
// Key Handling
// ============================================================================

export interface TextInputKeyResult {
  handled: boolean;
  confirmed: boolean;
  cancelled: boolean;
  updater?: TextInputUpdater;
}

/** Handle key in text input */
export function handleTextInputKey(key: string): TextInputKeyResult {
  // Enter
  if (key === "\r" || key === "\n") {
    return { handled: true, confirmed: true, cancelled: false };
  }

  // Escape
  if (key === "\x1b") {
    return { handled: true, confirmed: false, cancelled: true };
  }

  // Backspace
  if (key === "\x7f" || key === "\b") {
    return { handled: true, confirmed: false, cancelled: false, updater: deleteBackward() };
  }

  // Delete (Ctrl+D when empty will exit, but with text it deletes forward)
  if (key === "\x04") {
    return { handled: true, confirmed: false, cancelled: false, updater: deleteForward() };
  }

  // Left arrow
  if (key === "\x1b[D") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveCursorLeft() };
  }

  // Right arrow
  if (key === "\x1b[C") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveCursorRight() };
  }

  // Home (Ctrl+A)
  if (key === "\x01") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveCursorToStart() };
  }

  // End (Ctrl+E)
  if (key === "\x05") {
    return { handled: true, confirmed: false, cancelled: false, updater: moveCursorToEnd() };
  }

  // Clear (Ctrl+U)
  if (key === "\x15") {
    return { handled: true, confirmed: false, cancelled: false, updater: clearInput() };
  }

  // Regular character input
  if (key.length === 1 && key >= " " && key <= "~") {
    return { handled: true, confirmed: false, cancelled: false, updater: insertText(key) };
  }

  // Consume other keys
  return { handled: true, confirmed: false, cancelled: false };
}
