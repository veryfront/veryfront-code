/**
 * Builtin Disclosure adapter: the zero-dependency open/close machinery for the
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
  {
    open: boolean;
    toggle: () => void;
    triggerId: string;
    contentId: string;
    disabled?: boolean;
  } | null
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
  {
    open,
    defaultOpen,
    onOpenChange,
    disabled,
    triggerId: explicitTriggerId,
    contentId: explicitContentId,
    children,
    ref,
    ...props
  },
) => {
  const { open: isOpen, setOpen } = useDisclosure({ open, defaultOpen, onOpenChange });
  const toggle = React.useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);
  const generatedId = stableDomId(React.useId());
  const triggerId = explicitTriggerId ?? `vf-disclosure-${generatedId}-trigger`;
  const contentId = explicitContentId ?? `vf-disclosure-${generatedId}-content`;
  const ctx = React.useMemo(
    () => ({
      open: isOpen,
      toggle,
      triggerId,
      contentId,
      disabled,
    }),
    [isOpen, toggle, triggerId, contentId, disabled],
  );
  return (
    <div {...props} ref={ref} data-state={isOpen ? "open" : "closed"}>
      <DisclosureContext.Provider value={ctx}>{children}</DisclosureContext.Provider>
    </div>
  );
};

const DisclosureTrigger: DisclosureParts["Trigger"] = (
  {
    asChild,
    onClick,
    children,
    ref,
    disabled,
    id,
    "aria-controls": ariaControls,
    ...props
  },
) => {
  const ctx = useDisclosureContext("Disclosure Trigger");
  const Comp = asChild ? Slot : "button";
  const isDisabled = Boolean(ctx.disabled || disabled);
  const childId = asChild && React.isValidElement<{ id?: string }>(children)
    ? children.props.id
    : undefined;
  if (id !== undefined && childId !== undefined && id !== childId) {
    throw new Error("Disclosure Trigger id must match its composed child's id");
  }
  const declaredId = id ?? childId;
  const realizedId = declaredId ?? ctx.triggerId;
  return (
    <Comp
      {...props}
      {...(asChild ? {} : { type: "button" as const })}
      ref={ref}
      id={realizedId}
      aria-expanded={ctx.open}
      aria-controls={ariaControls === null ? undefined : ariaControls ?? ctx.contentId}
      aria-disabled={asChild && isDisabled ? true : undefined}
      data-state={ctx.open ? "open" : "closed"}
      disabled={isDisabled}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
        if (!e.defaultPrevented) ctx.toggle();
      }}
    >
      {children}
    </Comp>
  );
};

const DisclosureContent: DisclosureParts["Content"] = (
  { children, ref, id, hidden, "aria-labelledby": ariaLabelledBy, ...props },
) => {
  const ctx = useDisclosureContext("Disclosure Content");
  const realizedId = id ?? ctx.contentId;
  return (
    <div
      {...props}
      ref={ref}
      id={realizedId}
      aria-labelledby={ariaLabelledBy === null ? undefined : ariaLabelledBy ?? ctx.triggerId}
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
