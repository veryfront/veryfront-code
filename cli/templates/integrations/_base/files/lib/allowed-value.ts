/**
 * Narrow a schema-validated string at an API boundary while retaining a
 * defensive runtime check when a tool is invoked outside the normal parser.
 */
export function requireAllowedValue<
  const Values extends readonly [string, ...string[]],
>(
  value: string,
  allowed: Values,
  label: string,
): Values[number] {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value as Values[number];
}

export function optionalAllowedValue<
  const Values extends readonly [string, ...string[]],
>(
  value: string | undefined,
  allowed: Values,
  label: string,
): Values[number] | undefined {
  return value === undefined
    ? undefined
    : requireAllowedValue(value, allowed, label);
}
