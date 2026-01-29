/**
 * Wizard Component
 *
 * Step-based wizard for multi-step forms (Codex style with tabs).
 */

import { z } from "zod";
import { brand, dim, muted, success } from "../../../ui/colors.ts";

// ============================================================================
// Schemas
// ============================================================================

export const WizardStepStatusSchema = z.enum([
  "pending",
  "current",
  "completed",
  "error",
]);

export type WizardStepStatus = z.infer<typeof WizardStepStatusSchema>;

export const WizardStepSchema = z.object({
  /** Step ID */
  id: z.string(),
  /** Step label (shown in tab bar) */
  label: z.string(),
  /** Step status */
  status: WizardStepStatusSchema,
  /** Validation error message */
  error: z.string().optional(),
});

export type WizardStep = z.infer<typeof WizardStepSchema>;

export const WizardStateSchema = z.object({
  /** All steps */
  steps: z.array(WizardStepSchema),
  /** Current step index */
  currentIndex: z.number(),
  /** Step data storage */
  data: z.record(z.unknown()),
});

export type WizardState = z.infer<typeof WizardStateSchema>;

// ============================================================================
// State Management
// ============================================================================

export type WizardUpdater = (state: WizardState) => WizardState;

/** Create wizard state */
export function createWizard(steps: Array<{ id: string; label: string }>): WizardState {
  return {
    steps: steps.map((s, i) => ({
      id: s.id,
      label: s.label,
      status: i === 0 ? "current" : "pending",
    })),
    currentIndex: 0,
    data: {},
  };
}

/** Move to next step */
export function nextStep(): WizardUpdater {
  return (state) => {
    if (state.currentIndex >= state.steps.length - 1) return state;

    const newSteps = state.steps.map((step, i) => {
      if (i === state.currentIndex) {
        return { ...step, status: "completed" as WizardStepStatus };
      }
      if (i === state.currentIndex + 1) {
        return { ...step, status: "current" as WizardStepStatus };
      }
      return step;
    });

    return {
      ...state,
      steps: newSteps,
      currentIndex: state.currentIndex + 1,
    };
  };
}

/** Move to previous step */
export function prevStep(): WizardUpdater {
  return (state) => {
    if (state.currentIndex <= 0) return state;

    const newSteps = state.steps.map((step, i) => {
      if (i === state.currentIndex) {
        return { ...step, status: "pending" as WizardStepStatus };
      }
      if (i === state.currentIndex - 1) {
        return { ...step, status: "current" as WizardStepStatus };
      }
      return step;
    });

    return {
      ...state,
      steps: newSteps,
      currentIndex: state.currentIndex - 1,
    };
  };
}

/** Go to specific step */
export function goToStep(index: number): WizardUpdater {
  return (state) => {
    if (index < 0 || index >= state.steps.length) return state;

    const newSteps = state.steps.map((step, i) => {
      if (i === index) {
        return { ...step, status: "current" as WizardStepStatus };
      }
      if (i === state.currentIndex) {
        return { ...step, status: "pending" as WizardStepStatus };
      }
      return step;
    });

    return {
      ...state,
      steps: newSteps,
      currentIndex: index,
    };
  };
}

/** Mark current step as error */
export function setStepError(message: string): WizardUpdater {
  return (state) => {
    const newSteps = state.steps.map((step, i) => {
      if (i === state.currentIndex) {
        return { ...step, status: "error" as WizardStepStatus, error: message };
      }
      return step;
    });

    return { ...state, steps: newSteps };
  };
}

/** Clear step error */
export function clearStepError(): WizardUpdater {
  return (state) => {
    const newSteps = state.steps.map((step, i) => {
      if (i === state.currentIndex) {
        return { ...step, status: "current" as WizardStepStatus, error: undefined };
      }
      return step;
    });

    return { ...state, steps: newSteps };
  };
}

/** Set step data */
export function setStepData<T>(key: string, value: T): WizardUpdater {
  return (state) => ({
    ...state,
    data: { ...state.data, [key]: value },
  });
}

/** Get step data */
export function getStepData<T>(state: WizardState, key: string): T | undefined {
  return state.data[key] as T | undefined;
}

/** Get current step */
export function getCurrentStep(state: WizardState): WizardStep | undefined {
  return state.steps[state.currentIndex];
}

/** Check if on first step */
export function isFirstStep(state: WizardState): boolean {
  return state.currentIndex === 0;
}

/** Check if on last step */
export function isLastStep(state: WizardState): boolean {
  return state.currentIndex === state.steps.length - 1;
}

/** Get progress percentage */
export function getProgress(state: WizardState): number {
  return Math.round(((state.currentIndex + 1) / state.steps.length) * 100);
}

// ============================================================================
// Rendering
// ============================================================================

/** Render step indicator */
function renderStepIndicator(step: WizardStep): string {
  switch (step.status) {
    case "completed":
      return success("✓");
    case "current":
      return brand("●");
    case "error":
      return "✗";
    case "pending":
    default:
      return dim("○");
  }
}

/** Render wizard tab bar */
export function renderWizardTabs(state: WizardState): string {
  const parts: string[] = ["←"];

  for (let i = 0; i < state.steps.length; i++) {
    const step = state.steps[i];
    if (!step) continue;

    const indicator = renderStepIndicator(step);
    const label = step.status === "current" ? step.label : dim(step.label);

    parts.push(`${indicator} ${label}`);

    if (i < state.steps.length - 1) {
      parts.push(" ");
    }
  }

  parts.push("→");

  return parts.join(" ");
}

/** Render wizard progress bar */
export function renderProgressBar(state: WizardState, width = 40): string {
  const progress = getProgress(state);
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;

  const bar = brand("█".repeat(filled)) + dim("░".repeat(empty));
  return `[${bar}] ${progress}%`;
}

/** Render step header */
export function renderStepHeader(state: WizardState): string {
  const step = getCurrentStep(state);
  if (!step) return "";

  const stepNum = state.currentIndex + 1;
  const totalSteps = state.steps.length;

  return `Step ${stepNum} of ${totalSteps}: ${step.label}`;
}

/** Render wizard navigation help */
export function renderWizardHelp(state: WizardState): string {
  const parts: string[] = [];

  if (!isFirstStep(state)) {
    parts.push("← back");
  }

  if (!isLastStep(state)) {
    parts.push("→ next");
  } else {
    parts.push("Enter submit");
  }

  parts.push("Esc cancel");

  return muted(parts.join("  "));
}

// ============================================================================
// Key Handling
// ============================================================================

export interface WizardKeyResult {
  handled: boolean;
  submitted: boolean;
  cancelled: boolean;
  updater?: WizardUpdater;
}

/** Handle key in wizard navigation */
export function handleWizardKey(key: string, state: WizardState): WizardKeyResult {
  // Left arrow - previous step
  if (key === "\x1b[D" || key === "h") {
    if (!isFirstStep(state)) {
      return { handled: true, submitted: false, cancelled: false, updater: prevStep() };
    }
    return { handled: true, submitted: false, cancelled: false };
  }

  // Right arrow - next step
  if (key === "\x1b[C" || key === "l") {
    if (!isLastStep(state)) {
      return { handled: true, submitted: false, cancelled: false, updater: nextStep() };
    }
    return { handled: true, submitted: false, cancelled: false };
  }

  // Enter on last step - submit
  if ((key === "\r" || key === "\n") && isLastStep(state)) {
    return { handled: true, submitted: true, cancelled: false };
  }

  // Escape - cancel
  if (key === "\x1b") {
    return { handled: true, submitted: false, cancelled: true };
  }

  // Don't consume other keys (let step content handle them)
  return { handled: false, submitted: false, cancelled: false };
}
