/**
 * Builtin Tabs adapter — the zero-dependency single-select tablist machinery
 * (`role="tablist"` / `role="tab"` / `aria-selected`, select-on-click), assembled
 * as `TabsParts`. The Root owns the selected value; each Tab self-wires through
 * the file-local context. Panel-less (the consumer renders content by value). The
 * Tab sets `data-state="active"|"inactive"` and carries NO visual classes — the
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

const TabsTab: TabsParts["Tab"] = ({ value, asChild, onClick, ref, ...props }) => {
  const ctx = React.useContext(TabsContext);
  const isActive = ctx?.value === value;
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      role="tab"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (!e.defaultPrevented) ctx?.onValueChange(value);
      }}
      {...props}
    />
  );
};

export const builtinTabs: TabsParts = {
  Root: TabsRoot,
  Tab: TabsTab,
};
