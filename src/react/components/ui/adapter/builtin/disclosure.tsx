/**
 * Builtin Disclosure adapter — the zero-dependency open/close machinery for the
 * Collapsible primitive (and each Accordion item), assembled as `DisclosureParts`.
 * Behaviour-preserving move of `collapsible.tsx`'s logic: controlled/uncontrolled
 * open state, `aria-expanded` on the trigger, `data-state`, content mounted only
 * while open. Parts self-wire through this file-local context, so the skin just
 * renders `Root` > `Trigger` / `Content`.
 *
 * @module react/components/ui/adapter/builtin/disclosure
 */
import * as React from "react";
import { Slot } from "../../slot.tsx";
import { useDisclosure } from "../../disclosure.ts";
import type { DisclosureParts } from "../contract.ts";

const DisclosureContext = React.createContext<
  { open: boolean; toggle: () => void; disabled?: boolean } | null
>(null);

const DisclosureRoot: DisclosureParts["Root"] = (
  { open, defaultOpen, onOpenChange, disabled, children, ref, ...props },
) => {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const toggle = React.useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
  const ctx = React.useMemo(() => ({ open: isOpen, toggle, disabled }), [isOpen, toggle, disabled]);
  return (
    <div ref={ref} data-state={isOpen ? "open" : "closed"} {...props}>
      <DisclosureContext.Provider value={ctx}>{children}</DisclosureContext.Provider>
    </div>
  );
};

const DisclosureTrigger: DisclosureParts["Trigger"] = (
  { asChild, onClick, children, ref, ...props },
) => {
  const ctx = React.useContext(DisclosureContext);
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      aria-expanded={ctx?.open}
      data-state={ctx?.open ? "open" : "closed"}
      disabled={ctx?.disabled}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        ctx?.toggle();
      }}
      {...props}
    >
      {children}
    </Comp>
  );
};

const DisclosureContent: DisclosureParts["Content"] = ({ children, ref, ...props }) => {
  const ctx = React.useContext(DisclosureContext);
  if (!ctx?.open) return null;
  return (
    <div ref={ref} data-state="open" {...props}>
      {children}
    </div>
  );
};

export const builtinDisclosure: DisclosureParts = {
  Root: DisclosureRoot,
  Trigger: DisclosureTrigger,
  Content: DisclosureContent,
};
