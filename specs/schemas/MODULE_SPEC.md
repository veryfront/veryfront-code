# NLSpec: src/schemas/

## Purpose
Reusable Zod validation schemas for common domain types (email, UUID, slug, URL, phone number, pagination, date range, password) and primitive value types (non-empty string, integers, port number, timestamp, JSON, hex color, semver, file paths). Provides a single import point for consistent validation across the platform.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `CommonSchemas` | object (namespace) | Collection of domain-level Zod schemas: `email`, `uuid`, `slug`, `url`, `phoneNumber`, `pagination`, `dateRange`, `strongPassword` |
| `Email` | type | Inferred type from `CommonSchemas.email` |
| `Uuid` | type | Inferred type from `CommonSchemas.uuid` |
| `Slug` | type | Inferred type from `CommonSchemas.slug` |
| `Url` | type | Inferred type from `CommonSchemas.url` |
| `PhoneNumber` | type | Inferred type from `CommonSchemas.phoneNumber` |
| `Pagination` | type | Inferred type from `CommonSchemas.pagination` |
| `DateRange` | type | Inferred type from `CommonSchemas.dateRange` |
| `StrongPassword` | type | Inferred type from `CommonSchemas.strongPassword` |
| `nonEmptyString` | Zod schema | String with min length 1 |
| `NonEmptyString` | type | Inferred type from `nonEmptyString` |
| `positiveInt` | Zod schema | Integer > 0 |
| `PositiveInt` | type | Inferred type from `positiveInt` |
| `nonNegativeInt` | Zod schema | Integer >= 0 |
| `NonNegativeInt` | type | Inferred type from `nonNegativeInt` |
| `portNumber` | Zod schema | Integer between 1 and 65535 |
| `PortNumber` | type | Inferred type from `portNumber` |
| `timestamp` | Zod schema | ISO 8601 datetime string |
| `Timestamp` | type | Inferred type from `timestamp` |
| `jsonValue` | Zod schema | Recursive union: string, number, boolean, null, array, or record of JSON values |
| `JsonValue` | type | Inferred type from `jsonValue` |
| `hexColor` | Zod schema | String matching `#RGB` or `#RRGGBB` hex format |
| `HexColor` | type | Inferred type from `hexColor` |
| `semver` | Zod schema | String matching semantic versioning (major.minor.patch with optional pre-release and build metadata) |
| `Semver` | type | Inferred type from `semver` |
| `filePath` | Zod schema | Non-empty string representing a file path |
| `FilePath` | type | Inferred type from `filePath` |
| `absolutePath` | Zod schema | String starting with `/` (Unix) or drive letter `X:\` (Windows) |
| `AbsolutePath` | type | Inferred type from `absolutePath` |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `z` | `zod` | Schema definition and validation engine |
| `MAX_URL_LENGTH_FOR_VALIDATION` | `#veryfront/utils/constants/index.ts` | Upper bound (2048) for URL length validation |

## Behaviors

### Behavior 1: Email validation
- **Given**: A string input
- **When**: Parsed with `CommonSchemas.email`
- **Then**: Accepts valid email format, max 255 characters
- **Edge cases**: Rejects non-email strings; rejects emails exceeding 255 characters

### Behavior 2: UUID validation
- **Given**: A string input
- **When**: Parsed with `CommonSchemas.uuid`
- **Then**: Accepts strings in standard UUID format (8-4-4-4-12 hex)
- **Edge cases**: Rejects non-UUID strings

### Behavior 3: Slug validation
- **Given**: A string input
- **When**: Parsed with `CommonSchemas.slug`
- **Then**: Accepts lowercase alphanumeric strings with hyphens, length 1-100
- **Edge cases**: Rejects empty strings; rejects uppercase letters; rejects spaces; rejects strings over 100 characters

### Behavior 4: URL validation
- **Given**: A string input
- **When**: Parsed with `CommonSchemas.url`
- **Then**: Accepts valid URLs up to `MAX_URL_LENGTH_FOR_VALIDATION` (2048) characters
- **Edge cases**: Rejects non-URL strings; rejects URLs exceeding max length

### Behavior 5: Phone number validation
- **Given**: A string input
- **When**: Parsed with `CommonSchemas.phoneNumber`
- **Then**: Accepts E.164-like phone numbers: optional leading `+`, first digit 1-9, followed by 1-14 digits
- **Edge cases**: Rejects numbers starting with 0; rejects strings containing letters

### Behavior 6: Pagination parsing with defaults and coercion
- **Given**: An object (possibly with string values from query params)
- **When**: Parsed with `CommonSchemas.pagination`
- **Then**: Returns `{ page, limit, sort?, order? }` with defaults: page=1, limit=10. Coerces string numbers to integers.
- **Edge cases**: Rejects negative page; rejects limit > 100; rejects order values other than "asc"/"desc"; page=0 is rejected (must be positive)

### Behavior 7: Date range validation with chronological order enforcement
- **Given**: An object with `from` and `to` ISO 8601 datetime strings
- **When**: Parsed with `CommonSchemas.dateRange`
- **Then**: Accepts when `from <= to`
- **Edge cases**: Accepts same from and to dates (equal); rejects when from > to; rejects non-datetime strings

### Behavior 8: Strong password validation
- **Given**: A string input
- **When**: Parsed with `CommonSchemas.strongPassword`
- **Then**: Accepts strings with 8+ characters containing at least one uppercase letter, one lowercase letter, one digit, and one special character
- **Edge cases**: Rejects passwords shorter than 8 characters; rejects passwords missing any single character class

### Behavior 9: Recursive JSON value validation
- **Given**: Any value
- **When**: Parsed with `jsonValue`
- **Then**: Accepts string, number, boolean, null, arrays of JSON values, or objects (records) of JSON values, recursively
- **Edge cases**: Uses `z.lazy` for recursive self-reference; accepts deeply nested structures

### Behavior 10: Hex color validation
- **Given**: A string input
- **When**: Parsed with `hexColor`
- **Then**: Accepts `#RGB` (3 hex digits) or `#RRGGBB` (6 hex digits), case-insensitive
- **Edge cases**: Rejects strings without leading `#`; rejects 4 or 5 hex digit variants

### Behavior 11: Semantic version validation
- **Given**: A string input
- **When**: Parsed with `semver`
- **Then**: Accepts strings matching full semver spec (major.minor.patch with optional pre-release and build metadata)
- **Edge cases**: Rejects leading zeros in numeric identifiers (except 0 itself)

### Behavior 12: Absolute path validation
- **Given**: A string input
- **When**: Parsed with `absolutePath`
- **Then**: Accepts paths starting with `/` (Unix) or a drive letter followed by `:\` (Windows)
- **Edge cases**: Rejects relative paths

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/schemas/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: `deno fmt --check src/schemas/ && deno lint src/schemas/`

## Error Handling
- All schemas return Zod `SafeParseResult` when using `.safeParse()` -- failures contain structured `ZodError` with field-level issues
- Custom error messages are provided for: strongPassword (per-rule messages), primitives (descriptive messages), dateRange refinement ("From date must be before or equal to To date")
- No thrown exceptions -- callers choose between `.parse()` (throws) and `.safeParse()` (returns result)

## Side Effects
- None. All schemas are pure validation functions with no I/O, no state mutation, and no side effects.

## Performance Constraints
- `jsonValue` uses `z.lazy()` for recursive definition, which creates the schema on each parse. Deeply nested JSON structures will incur proportional parse time.
- No known hot-path concerns for other schemas.

## Invariants
- Every Zod schema has a corresponding exported TypeScript type alias (inferred via `z.infer`)
- `CommonSchemas` is a single object grouping all domain-level schemas; primitives are individually exported
- `pagination.page` and `pagination.limit` always have default values (1 and 10), so a valid parse of `{}` always produces those fields
- `dateRange` always enforces `from <= to` (chronological ordering)
