# CSS Optimizer Architecture

## Overview

The CSS Optimizer uses a **Strategy Pattern** architecture that separates concerns into independent, testable modules. This design enables easy extension, graceful degradation, and comprehensive testing.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Public API Layer                         │
│                                                                   │
│  ┌────────────────┐          ┌──────────────────┐              │
│  │ CSSOptimizer   │          │ optimizeCSS()    │              │
│  │ (Facade)       │◄─────────│ (Helper)         │              │
│  └────────┬───────┘          └──────────────────┘              │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │
            │ delegates to
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestration Layer                         │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │            CSSOptimizerService                       │       │
│  │  ┌──────────────────────────────────────────────┐   │       │
│  │  │ • init()           - Initialize strategies   │   │       │
│  │  │ • optimize()       - Run optimization        │   │       │
│  │  │ • optimizeFile()   - Process single file     │   │       │
│  │  │ • selectStrategy() - Choose best strategy    │   │       │
│  │  │ • getStats()       - Get statistics          │   │       │
│  │  └──────────────────────────────────────────────┘   │       │
│  └───────┬──────────────────────────────────────────────┘       │
│          │                                                       │
└──────────┼───────────────────────────────────────────────────────┘
           │
           ├─── uses ───┐
           │            │
           ▼            ▼
┌──────────────────┐  ┌─────────────────────────────────────────┐
│  CacheManager    │  │         Strategy Layer                   │
│                  │  │                                           │
│ • addBundle()    │  │  ┌─────────────────────────────────┐    │
│ • getBundle()    │  │  │  CSSOptimizationStrategy        │    │
│ • getAllBundles()│  │  │  (interface)                    │    │
│ • getStats()     │  │  │  • name: string                 │    │
│ • writeManifest()│  │  │  • priority: number             │    │
│ • clear()        │  │  │  • canProcess(options): boolean │    │
│ └────────────────┘  │  │  • process(...): Promise<...>   │    │
│                     │  │  └───────┬─────────────────────┘    │
│  ┌────────────────┐ │  │          │                           │
│  │ Manifest File  │ │  │          │ implements                │
│  │ (JSON)         │ │  │          │                           │
│  └────────────────┘ │  │  ┌───────┴──────┬─────────────┬────┤
│                     │  │  │              │              │     │
└─────────────────────┘  │  ▼              ▼              ▼     │
                         │ ┌──────────┐ ┌────────────┐ ┌──────┐│
                         │ │Lightning │ │  Purge     │ │Basic ││
                         │ │   CSS    │ │  Strategy  │ │Minif ││
                         │ │ Strategy │ │            │ │      ││
                         │ │          │ │            │ │      ││
                         │ │Priority  │ │Priority 50 │ │Prior ││
                         │ │   100    │ │            │ │ 10   ││
                         │ └──────────┘ └────────────┘ └──────┘│
                         └─────────────────────────────────────┘
                                        │
                                        │ uses
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Utility Layer                             │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      Utils Module                         │   │
│  │  • findCSSFiles()        - File discovery                │   │
│  │  • globFiles()           - Pattern matching              │   │
│  │  • extractSelectors()    - HTML/JSX analysis             │   │
│  │  • basicMinify()         - Fallback minification         │   │
│  │  • shouldKeepSelector()  - Purge rules logic             │   │
│  │  • calculateSavings()    - Stats calculation             │   │
│  │  • parseBrowserTargets() - Lightning CSS config          │   │
│  │  • getOutputPath()       - Path resolution               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Critical CSS Module                      │   │
│  │  • extractCriticalCSS()  - Above-fold extraction         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

                                ▲
                                │
                                │ defines
                                │
┌─────────────────────────────────────────────────────────────────┐
│                          Type Layer                              │
│                                                                   │
│  • CSSOptimizationOptions     - Configuration                   │
│  • CSSBundle                   - Result bundle                  │
│  • CSSOptimizationStrategy     - Strategy interface             │
│  • CSSProcessingResult         - Strategy output                │
│  • CriticalCSSResult           - Critical CSS output            │
│  • CSSOptimizerStats           - Statistics                     │
│  • LightningCSSModule          - External library types         │
│  • BrowserTargets              - Browser configuration          │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. Public API Layer

#### CSSOptimizer (Facade)

- **Purpose**: Provides backward-compatible API for existing code
- **Pattern**: Facade Pattern
- **Responsibility**: Delegates to CSSOptimizerService
- **File**: `index.ts`

#### optimizeCSS()

- **Purpose**: Helper function for one-shot optimization
- **Usage**: `await optimizeCSS({ inputDir: './styles' })`

### 2. Orchestration Layer

#### CSSOptimizerService

- **Purpose**: Main orchestrator coordinating all optimization
- **Pattern**: Strategy Pattern (Context)
- **Responsibilities**:
  - Initialize and manage strategies
  - Select best strategy based on options
  - Process CSS files through pipeline
  - Coordinate with CacheManager
  - Collect and report statistics
- **File**: `optimizer-service.ts`

### 3. Strategy Layer

All strategies implement the `CSSOptimizationStrategy` interface:

```typescript
interface CSSOptimizationStrategy {
  readonly name: string;
  readonly priority: number;
  canProcess(options: CSSOptimizationOptions): boolean;
  process(
    content: string,
    filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult>;
}
```

#### LightningCSSStrategy (Priority: 100)

- **Purpose**: Advanced CSS optimization using Lightning CSS
- **Features**:
  - Minification
  - Autoprefixing
  - Modern CSS compilation
  - Source map generation
- **File**: `strategies/lightning-strategy.ts`
- **Availability**: Optional (graceful degradation)

#### PurgeStrategy (Priority: 50)

- **Purpose**: Remove unused CSS rules
- **Features**:
  - Content analysis for used selectors
  - Intelligent rule filtering
  - Preserves universal rules
- **File**: `strategies/purge-strategy.ts`
- **Use Case**: Production builds to reduce CSS size

#### MinificationStrategy (Priority: 10)

- **Purpose**: Basic CSS minification
- **Features**:
  - Comment removal
  - Whitespace reduction
  - Always available fallback
- **File**: `strategies/minification-strategy.ts`
- **Availability**: Always (no external dependencies)

### 4. Cache Layer

#### CacheManager

- **Purpose**: Bundle storage and manifest management
- **Pattern**: Repository Pattern
- **Responsibilities**:
  - Store optimization results in memory
  - Calculate statistics
  - Write/load manifest files
  - Exclude content from manifest for efficiency
- **File**: `cache-manager.ts`

### 5. Utility Layer

#### Utils Module

- **Purpose**: Shared utility functions
- **Responsibilities**:
  - File system operations
  - Pattern matching
  - Selector extraction
  - Basic minification
  - Path resolution
- **File**: `utils.ts`

#### Critical CSS Module

- **Purpose**: Extract above-the-fold CSS
- **Responsibilities**:
  - Parse HTML content for selectors
  - Split CSS into critical/remaining
  - Optional minification
- **File**: `critical-css.ts`

### 6. Type Layer

#### Types Module

- **Purpose**: TypeScript type definitions
- **Responsibilities**:
  - Define all public interfaces
  - Define strategy interfaces
  - Define result types
  - External library type definitions
- **File**: `types/index.ts`

## Data Flow

### Optimization Pipeline

```
1. User creates CSSOptimizer
   ↓
2. CSSOptimizer delegates to CSSOptimizerService
   ↓
3. Service initializes strategies
   ↓
4. Service finds CSS files (Utils.findCSSFiles)
   ↓
5. For each file:
   a. Service selects best strategy (priority-based)
   b. Strategy processes CSS content
   c. Service writes optimized file
   d. Service stores result in CacheManager
   ↓
6. Service writes manifest (CacheManager.writeManifest)
   ↓
7. Service returns bundles Map
   ↓
8. User receives optimization results
```

### Strategy Selection

```
Options: { minify: true, purge: false, autoprefixer: true }
         ↓
1. Sort strategies by priority (desc)
   [LightningCSS(100), PurgeCSS(50), Minification(10)]
         ↓
2. For each strategy, call canProcess(options)
   - LightningCSS.canProcess() → true (if loaded)
   - PurgeCSS.canProcess() → false (purge: false)
   - Minification.canProcess() → true (always)
         ↓
3. Select first matching strategy
   → LightningCSSStrategy (if available)
   → MinificationStrategy (fallback)
```

## Extension Points

### Adding a New Strategy

1. **Create strategy file**: `strategies/my-strategy.ts`
2. **Implement interface**: `CSSOptimizationStrategy`
3. **Export from**: `strategies/index.ts`
4. **Register in service**: `optimizer-service.ts`
5. **Add tests**: `tests/css-optimizer/strategies.test.ts`

Example:

```typescript
// strategies/postcss-strategy.ts
export class PostCSSStrategy implements CSSOptimizationStrategy {
  readonly name = "postcss";
  readonly priority = 75; // Between Lightning and Purge

  canProcess(options: CSSOptimizationOptions): boolean {
    return options.postcss === true;
  }

  async process(
    content: string,
    filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult> {
    // PostCSS implementation
  }
}
```

### Adding Utility Functions

Add to `utils.ts` and export:

```typescript
export function myUtility(input: string): string {
  // Implementation
}
```

### Extending Types

Add to `types/index.ts`:

```typescript
export interface MyNewType {
  // Type definition
}
```

## Design Patterns

### 1. Strategy Pattern

- **Context**: `CSSOptimizerService`
- **Strategy Interface**: `CSSOptimizationStrategy`
- **Concrete Strategies**: Lightning, Purge, Minification
- **Benefit**: Easy to add new optimization strategies

### 2. Facade Pattern

- **Facade**: `CSSOptimizer` class
- **Subsystem**: `CSSOptimizerService` + Strategies
- **Benefit**: Simple API for common cases

### 3. Repository Pattern

- **Repository**: `CacheManager`
- **Entity**: `CSSBundle`
- **Benefit**: Abstracted storage with clean interface

## Error Handling

### Graceful Degradation

1. Lightning CSS fails to load → Use MinificationStrategy
2. Strategy processing fails → Log warning, use fallback
3. File read/write fails → Log error, continue with other files
4. Manifest write fails → Log warning (not critical)

### Error Flow

```
Strategy.process() throws
         ↓
Service catches error
         ↓
Service logs warning with strategy name
         ↓
Service tries basicMinify() fallback
         ↓
Service continues with next file
```

## Testing Strategy

### Unit Tests (36 tests)

- **strategies.test.ts**: Test each strategy independently
- **utils.test.ts**: Test utility functions
- **cache-manager.test.ts**: Test cache operations

### Integration Tests (37 tests)

- **css-optimizer.test.ts**: Test full optimization pipeline
- Test all features end-to-end
- Test error cases and edge cases

### Test Structure

```
tests/build/asset-pipeline/
├── css-optimizer.test.ts              # Integration tests
└── css-optimizer/
    ├── strategies.test.ts             # Strategy unit tests
    ├── utils.test.ts                  # Utility unit tests
    └── cache-manager.test.ts          # Cache unit tests
```

## Performance Characteristics

### Strategy Priority System

- **High Priority (100)**: Fast, feature-rich (Lightning CSS)
- **Medium Priority (50)**: Targeted optimization (Purge)
- **Low Priority (10)**: Always-available fallback (Basic)

### Caching Strategy

- In-memory during optimization (fast access)
- Manifest written once at end (batch I/O)
- Manifest excludes content (smaller files)

### File Processing

- Sequential file processing (predictable behavior)
- Error isolation (one file failure doesn't stop others)
- Efficient I/O with Deno APIs

## Dependencies

### Required (Deno Standard Library)

- `std/path/mod.ts` - Path operations
- `std/fs/mod.ts` - File system operations
- `std/assert/mod.ts` - Testing utilities

### Optional (External)

- `https://esm.sh/lightningcss@1.22.0` - Advanced CSS optimization

### Internal

- `@veryfront/internal` - Logging utilities
- `../../../shared/constants/network.ts` - Constants

## Compatibility

### Backward Compatibility

- All existing APIs preserved
- Original CSSOptimizer class works unchanged
- All options supported
- Return types unchanged

### Deno Compatibility

- Uses Deno standard library
- File operations via Deno APIs
- Test with `deno test`
- Type check with `deno check`
- Import maps supported

## Conclusion

This architecture provides:

- **Modularity**: Clear separation of concerns
- **Extensibility**: Easy to add new strategies
- **Testability**: Each module independently testable
- **Maintainability**: Small, focused modules
- **Reliability**: Comprehensive error handling
- **Performance**: Efficient strategy selection and caching
- **Compatibility**: 100% backward compatible
