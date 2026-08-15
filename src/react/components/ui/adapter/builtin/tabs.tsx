/**
 * Builtin Tabs adapter - the zero-dependency single-select tablist machinery
 * (`role="tablist"` / `role="tab"` / `aria-selected`, select-on-click), assembled
 * as `TabsParts`. The Root owns the selected value; each Tab self-wires through
 * the file-local context. Panel-less (the consumer renders content by value). The
 * Tab sets `data-state="active"|"inactive"` and carries NO visual classes - the
 * skin passes those.
 *
 * @module react/components/ui/adapter/builtin/tabs
 */
import * as React from "react";
import { Slot } from "../../slot.tsx";
import type { TabsParts } from "../contract.ts";

const TabsContext = React.createContext<
  { value: string; onValueChange: (value: string) => void } | null
>(null);

const TabsRoot: TabsParts["Root"] = ({ value, onValueChange, children, ref, ...props }) => {
  const ctx = React.useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return (
    <TabsContext.Provider value={ctx}>
      <div ref={ref} role="tablist" {...props}>{children}</div>
    </TabsContext.Provider>
  );
};

const TabsTab: TabsParts["Tab"] = ({ value, asChild, onClick, onKeyDown, ref, ...props }) => {
  const ctx = React.useContext(TabsContext);
  const isActive = ctx?.value === value;
  const Comp = asChild ? Slot : "button";
  const moveFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    direction: "first" | "last" | 1 | -1,
  ) => {
    const list = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
    const tabs = Array.from(list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
      .filter((tab) =>
        !tab.hasAttribute("disabled") &&
        tab.getAttribute("aria-disabled") !== "true"
      );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex === -1 || tabs.length === 0) return;
    const nextIndex = direction === "first"
      ? 0
      : direction === "last"
      ? tabs.length - 1
      : (currentIndex + direction + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    next?.focus();
    next?.click();
  };
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      tabIndex={isActive ? 0 : -1}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (!e.defaultPrevented) ctx?.onValueChange(value);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        switch (e.key) {
          case "ArrowRight":
          case "ArrowDown":
            e.preventDefault();
            moveFocus(e, 1);
            break;
          case "ArrowLeft":
          case "ArrowUp":
            e.preventDefault();
            moveFocus(e, -1);
            break;
          case "Home":
            e.preventDefault();
            moveFocus(e, "first");
            break;
          case "End":
            e.preventDefault();
            moveFocus(e, "last");
            break;
        }
      }}
      {...props}
    />
  );
};

export const builtinTabs: TabsParts = {
  Root: TabsRoot,
  Tab: TabsTab,
};
