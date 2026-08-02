/**
 * Commit-time ID registration shared by public disclosure skins. Registration
 * follows rendered DOM ownership through refs, so opaque React wrappers do not
 * need to be inspected or rewritten.
 *
 * @module react/components/ui/disclosure-id-registry
 */
import * as React from "react";

export type RegisterDisclosurePart = (
  registrationKey: string,
  id: string,
) => () => void;

/** Track the realized IDs of one kind of disclosure part in commit order. */
export function useDisclosureIdRegistry(
  part: "trigger" | "content",
  fallbackIds: readonly string[],
): readonly [readonly string[], boolean, RegisterDisclosurePart] {
  const registrations = React.useRef(new Map<string, string>());
  const [registeredIds, setRegisteredIds] = React.useState<readonly string[]>([]);
  const register = React.useCallback<RegisterDisclosurePart>((registrationKey, id) => {
    for (const [existingKey, existingId] of registrations.current) {
      if (existingKey !== registrationKey && existingId === id) {
        throw new Error(`Disclosure ${part} ids must be unique: ${id}`);
      }
    }

    registrations.current.set(registrationKey, id);
    setRegisteredIds([...registrations.current.values()]);

    let active = true;
    return () => {
      if (!active || registrations.current.get(registrationKey) !== id) return;
      active = false;
      registrations.current.delete(registrationKey);
      setRegisteredIds([...registrations.current.values()]);
    };
  }, [part]);

  return [
    registeredIds.length > 0 ? registeredIds : fallbackIds,
    registeredIds.length > 0,
    register,
  ];
}
