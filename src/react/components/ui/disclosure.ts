/**
 * useDisclosure: shared controlled/uncontrolled open state for overlay surfaces.
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
  const isOpen: boolean = open ?? internal;
  // Latest-ref pattern: setOpen keeps a stable identity across parent renders
  // (so effect consumers do not re-register listeners) while always invoking
  // the caller's current onOpenChange.
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternal(next);
      onOpenChangeRef.current?.(next);
    },
    [isControlled],
  );
  return { open: isOpen, setOpen };
}
