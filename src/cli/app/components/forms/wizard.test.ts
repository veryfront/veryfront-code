/**
 * Tests for wizard component
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  clearStepError,
  createWizard,
  getCurrentStep,
  getProgress,
  getStepData,
  goToStep,
  handleWizardKey,
  isFirstStep,
  isLastStep,
  nextStep,
  prevStep,
  renderProgressBar,
  renderStepHeader,
  renderWizardHelp,
  renderWizardTabs,
  setStepData,
  setStepError,
  WizardStateSchema as _WizardStateSchema,
  WizardStepSchema,
  WizardStepStatusSchema,
} from "./wizard.ts";

describe("WizardStepStatusSchema", () => {
  it("validates statuses", () => {
    expect(WizardStepStatusSchema.parse("pending")).toBe("pending");
    expect(WizardStepStatusSchema.parse("current")).toBe("current");
    expect(WizardStepStatusSchema.parse("completed")).toBe("completed");
    expect(WizardStepStatusSchema.parse("error")).toBe("error");
  });
});

describe("WizardStepSchema", () => {
  it("validates step", () => {
    const result = WizardStepSchema.parse({
      id: "step1",
      label: "Step 1",
      status: "current",
    });

    expect(result.id).toBe("step1");
    expect(result.status).toBe("current");
  });
});

describe("createWizard", () => {
  it("creates wizard with steps", () => {
    const state = createWizard([
      { id: "template", label: "Template" },
      { id: "name", label: "Name" },
      { id: "integrations", label: "Integrations" },
    ]);

    expect(state.steps.length).toBe(3);
    expect(state.currentIndex).toBe(0);
    expect(state.steps[0]?.status).toBe("current");
    expect(state.steps[1]?.status).toBe("pending");
  });
});

describe("nextStep", () => {
  it("moves to next step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);

    state = nextStep()(state);

    expect(state.currentIndex).toBe(1);
    expect(state.steps[0]?.status).toBe("completed");
    expect(state.steps[1]?.status).toBe("current");
  });

  it("does nothing on last step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);
    state = nextStep()(state);

    expect(state.currentIndex).toBe(1);
  });
});

describe("prevStep", () => {
  it("moves to previous step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);
    state = prevStep()(state);

    expect(state.currentIndex).toBe(0);
    expect(state.steps[0]?.status).toBe("current");
  });

  it("does nothing on first step", () => {
    const state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);

    const result = prevStep()(state);

    expect(result.currentIndex).toBe(0);
  });
});

describe("goToStep", () => {
  it("goes to specific step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ]);

    state = goToStep(2)(state);

    expect(state.currentIndex).toBe(2);
    expect(state.steps[2]?.status).toBe("current");
  });

  it("ignores invalid index", () => {
    const state = createWizard([
      { id: "a", label: "A" },
    ]);

    const result = goToStep(5)(state);

    expect(result.currentIndex).toBe(0);
  });
});

describe("setStepError", () => {
  it("sets error on current step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
    ]);

    state = setStepError("Invalid input")(state);

    expect(state.steps[0]?.status).toBe("error");
    expect(state.steps[0]?.error).toBe("Invalid input");
  });
});

describe("clearStepError", () => {
  it("clears error on current step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
    ]);
    state = setStepError("Error")(state);
    state = clearStepError()(state);

    expect(state.steps[0]?.status).toBe("current");
    expect(state.steps[0]?.error).toBeUndefined();
  });
});

describe("setStepData", () => {
  it("stores data by key", () => {
    let state = createWizard([{ id: "a", label: "A" }]);
    state = setStepData("template", "ai")(state);

    expect(state.data.template).toBe("ai");
  });
});

describe("getStepData", () => {
  it("retrieves stored data", () => {
    let state = createWizard([{ id: "a", label: "A" }]);
    state = setStepData("name", "my-app")(state);

    expect(getStepData(state, "name")).toBe("my-app");
  });

  it("returns undefined for missing key", () => {
    const state = createWizard([{ id: "a", label: "A" }]);
    expect(getStepData(state, "missing")).toBeUndefined();
  });
});

describe("getCurrentStep", () => {
  it("returns current step", () => {
    const state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);

    const step = getCurrentStep(state);

    expect(step?.id).toBe("a");
    expect(step?.status).toBe("current");
  });
});

describe("isFirstStep", () => {
  it("returns true on first step", () => {
    const state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);

    expect(isFirstStep(state)).toBe(true);
  });

  it("returns false on other steps", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    expect(isFirstStep(state)).toBe(false);
  });
});

describe("isLastStep", () => {
  it("returns false on first step", () => {
    const state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);

    expect(isLastStep(state)).toBe(false);
  });

  it("returns true on last step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    expect(isLastStep(state)).toBe(true);
  });
});

describe("getProgress", () => {
  it("calculates progress", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
    ]);

    expect(getProgress(state)).toBe(25);

    state = nextStep()(state);
    expect(getProgress(state)).toBe(50);

    state = nextStep()(state);
    expect(getProgress(state)).toBe(75);

    state = nextStep()(state);
    expect(getProgress(state)).toBe(100);
  });
});

describe("renderWizardTabs", () => {
  it("renders tab bar", () => {
    const state = createWizard([
      { id: "a", label: "Template" },
      { id: "b", label: "Name" },
      { id: "c", label: "Submit" },
    ]);

    const result = renderWizardTabs(state);

    expect(result).toContain("Template");
    expect(result).toContain("Name");
    expect(result).toContain("Submit");
    expect(result).toContain("←");
    expect(result).toContain("→");
  });

  it("shows completed indicator", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    const result = renderWizardTabs(state);

    expect(result).toContain("✓");
  });
});

describe("renderProgressBar", () => {
  it("renders progress", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    const result = renderProgressBar(state);

    expect(result).toContain("100%");
  });
});

describe("renderStepHeader", () => {
  it("renders step info", () => {
    const state = createWizard([
      { id: "template", label: "Choose Template" },
      { id: "name", label: "Name" },
    ]);

    const result = renderStepHeader(state);

    expect(result).toContain("Step 1 of 2");
    expect(result).toContain("Choose Template");
  });
});

describe("renderWizardHelp", () => {
  it("shows back on non-first step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    const result = renderWizardHelp(state);

    expect(result).toContain("back");
  });

  it("shows next on non-last step", () => {
    const state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);

    const result = renderWizardHelp(state);

    expect(result).toContain("next");
  });

  it("shows submit on last step", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    const result = renderWizardHelp(state);

    expect(result).toContain("submit");
  });
});

describe("handleWizardKey", () => {
  it("handles left arrow for back", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    const result = handleWizardKey("\x1b[D", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles right arrow for next", () => {
    const state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);

    const result = handleWizardKey("\x1b[C", state);

    expect(result.handled).toBe(true);
    expect(result.updater).toBeDefined();
  });

  it("handles enter on last step to submit", () => {
    let state = createWizard([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    state = nextStep()(state);

    const result = handleWizardKey("\r", state);

    expect(result.handled).toBe(true);
    expect(result.submitted).toBe(true);
  });

  it("handles escape to cancel", () => {
    const state = createWizard([{ id: "a", label: "A" }]);
    const result = handleWizardKey("\x1b", state);

    expect(result.handled).toBe(true);
    expect(result.cancelled).toBe(true);
  });

  it("passes through other keys", () => {
    const state = createWizard([{ id: "a", label: "A" }]);
    const result = handleWizardKey("a", state);

    expect(result.handled).toBe(false);
  });
});
