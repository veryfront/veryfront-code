/**
 * Builtin Disclosure adapter — the zero-dependency open/close machinery for the
 * Collapsible primitive (and each Accordion item), assembled as `DisclosureParts`.
 * Behaviour-preserving move of `collapsible.tsx`'s logic: controlled/uncontrolled
 * open state, stable ARIA wiring, disabled/default-prevented semantics, and
 * content retained with `hidden` while closed. Parts self-wire through this file-local context, so the skin just
 * renders `Root` > `Trigger` / `Content`.
 *
 * @module react/components/ui/adapter/builtin/disclosure
 */
import * as React from "react";
import { Slot } from "../../slot.tsx";
import { useDisclosure } from "../../disclosure.ts";
import type { DisclosureParts } from "../contract.ts";

const DisclosureContext = React.createContext<
  { open: boolean; toggle: () => void; contentId: string; disabled?: boolean } | null
>(null);

function stableDomId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

function useDisclosureContext(part: string) {
  const context = React.useContext(DisclosureContext);
  if (!context) throw new Error(`${part} must be used within a disclosure Root`);
  return context;
}

const DisclosureRoot: DisclosureParts["Root"] = (
  { open, defaultOpen, onOpenChange, disabled, children, ref, ...props },
) => {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const toggle = React.useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
  const contentId = `vf-disclosure-${stableDomId(React.useId())}-content`;
  const ctx = React.useMemo(
    () => ({ open: isOpen, toggle, contentId, disabled }),
    [isOpen, toggle, contentId, disabled],
  );
  return (
    <div {...props} ref={ref} data-state={isOpen ? "open" : "closed"}>
      <DisclosureContext.Provider value={ctx}>{children}</DisclosureContext.Provider>
    </div>
  );
};

const DisclosureTrigger: DisclosureParts["Trigger"] = (
  { asChild, onClick, children, ref, disabled, ...props },
) => {
  const ctx = useDisclosureContext("Disclosure Trigger");
  const Comp = asChild ? Slot : "button";
  const isDisabled = Boolean(ctx.disabled || disabled);
  return (
    <Comp
      {...props}
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      aria-expanded={ctx.open}
      aria-controls={ctx.contentId}
      aria-disabled={asChild && isDisabled ? true : undefined}
      data-state={ctx.open ? "open" : "closed"}
      disabled={asChild ? undefined : isDisabled}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (!e.defaultPrevented && !isDisabled) ctx.toggle();
      }}
    >
      {children}
    </Comp>
  );
};

const DisclosureContent: DisclosureParts["Content"] = (
  { children, ref, id, hidden, ...props },
) => {
  const ctx = useDisclosureContext("Disclosure Content");
  return (
    <div
      {...props}
      ref={ref}
      id={id ?? ctx.contentId}
      data-state={ctx.open ? "open" : "closed"}
      hidden={Boolean(hidden || !ctx.open)}
    >
      {children}
    </div>
  );
};

export const builtinDisclosure: DisclosureParts = {
  Root: DisclosureRoot,
  Trigger: DisclosureTrigger,
  Content: DisclosureContent,
};
