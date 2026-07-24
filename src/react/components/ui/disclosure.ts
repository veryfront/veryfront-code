/**
 * useDisclosure — shared controlled/uncontrolled open state for overlay surfaces.
 * @module react/components/ui/disclosure
 */
import * as React from "react";

/** Options accepted by `useDisclosure`. */
export interface DisclosureOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Returns `{ open, setOpen }`, handling controlled and uncontrolled usage. */
export function useDisclosure({ open, defaultOpen, onOpenChange }: DisclosureOptions) {
  const [internal, setInternal] = React.useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internal;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternal(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  return { open: isOpen, setOpen };
}
