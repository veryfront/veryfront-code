# NLSpec: src/<module>/

## Purpose
<1-2 sentences: what this module does and why it exists>

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `functionName` | function | <what it does> |
| `ClassName` | class | <what it does> |
| `TypeName` | type | <what it represents> |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `foo` | `src/other/` | <why this module needs it> |

## Behaviors

### Behavior 1: <descriptive name>
- **Given**: <preconditions>
- **When**: <action/trigger>
- **Then**: <expected outcome>
- **Edge cases**: <boundary conditions, error scenarios>

### Behavior 2: <descriptive name>
...

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/<module>/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: deno task verify:quick && deno test --no-check --allow-all src/<module>/

## Error Handling
- <what errors can occur and how they're handled>

## Side Effects
- <filesystem, network, state mutations, etc.>

## Performance Constraints
- <any known performance requirements or hot paths>

## Invariants
- <things that must always be true, regardless of input>
