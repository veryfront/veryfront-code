function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value == null || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "_tenant") {
      continue;
    }
    sanitized[key] = sanitizeValue(entry);
  }

  return sanitized;
}

export function sanitizeJobOutputForLogging(value: unknown): unknown {
  return sanitizeValue(value);
}
