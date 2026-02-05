import { z } from "zod";

export const nonEmptyString = z.string().min(1, "String cannot be empty");
export type NonEmptyString = z.infer<typeof nonEmptyString>;

export const positiveInt = z.number().int().positive("Must be a positive integer");
export type PositiveInt = z.infer<typeof positiveInt>;

export const nonNegativeInt = z.number().int().nonnegative("Must be a non-negative integer");
export type NonNegativeInt = z.infer<typeof nonNegativeInt>;

export const portNumber = z.number().int().min(1).max(65535, "Port must be between 1 and 65535");
export type PortNumber = z.infer<typeof portNumber>;

export const timestamp = z.string().datetime();
export type Timestamp = z.infer<typeof timestamp>;

export const jsonValue: z.ZodType<
  string | number | boolean | null | { [key: string]: unknown } | unknown[]
> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(jsonValue),
  ])
);
export type JsonValue = z.infer<typeof jsonValue>;

export const hexColor = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color");
export type HexColor = z.infer<typeof hexColor>;

export const semver = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  "Invalid semantic version",
);
export type Semver = z.infer<typeof semver>;

export const filePath = z.string().min(1, "File path cannot be empty");
export type FilePath = z.infer<typeof filePath>;

export const absolutePath = z.string().regex(
  /^(?:\/|[A-Za-z]:\\)/,
  "Path must be absolute (start with / or drive letter)",
);
export type AbsolutePath = z.infer<typeof absolutePath>;
