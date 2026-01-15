# Plan: Veryfront - One Command to AI-Assisted Fullstack Development

## Vision

Pro coder experience:
```
mkdir my-app && cd my-app
npx veryfront              → Minimal scaffold
veryfront install          → AI assistant integration
```

**Result**: Seamless AI-assisted development with Cursor, Claude Code, Codex, Gemini CLI, etc.

---

## User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Empty Directory                                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
                      npx veryfront
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Minimal Project (pulled from remote or scaffolded)         │
│  ├── src/pages/index.tsx                                    │
│  ├── veryfront.config.ts                                    │
│  └── package.json (or deno.json)                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
                     veryfront install
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AI-Ready Project                                           │
│  ├── .cursorrules          (Cursor)                         │
│  ├── .claude/CLAUDE.md     (Claude Code)                    │
│  ├── AGENTS.md             (Codex, Gemini CLI)              │
│  ├── src/pages/index.tsx                                    │
│  └── ...                                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
            AI assistant has full Veryfront context
            "Build me a blog with auth" → Just works
```

---

## Command 1: `npx veryfront`

### Behavior (in empty directory)
```bash
$ npx veryfront

? Project name: my-app
? Template: minimal | ai | blog

Creating my-app...
✓ Scaffolded 3 files
✓ Ready to dev

Next:
  veryfront dev        # Start development
  veryfront install    # Setup AI assistant
```

### Minimal Scaffold
Only essential files - no bloat:

```
my-app/
├── src/
│   └── pages/
│       └── index.tsx       # Single page
├── veryfront.config.ts     # Config
└── package.json            # Dependencies (minimal)
```

**Philosophy**: Start small, grow as needed. AI assistant helps add features.

---

## Command 2: `veryfront install`

### Behavior (Multi-Select - like integrations)
```bash
$ veryfront install

Select AI Coding Tools (space to toggle, enter to confirm)
Install integrations for your AI assistants.

  [✓] Cursor                    .cursorrules
  [✓] Claude Code               .claude/CLAUDE.md
  [✓] Agent Skills              SKILL.md (open standard)
  [ ] GitHub Copilot            .github/copilot-instructions.md
  [ ] Windsurf                  .windsurfrules
  [ ] Codex / Gemini CLI        AGENTS.md

Tip: Auto-detected Cursor, Claude Code from project directories

↑↓ navigate · space toggle · enter confirm · a all · n none
```

After confirmation:
```
Installing AI integrations...
✓ .cursorrules
✓ .claude/CLAUDE.md
✓ AGENTS.md

Your AI assistants now know Veryfront!
Try: "Add a contact form with email validation"
```

### What It Installs

| AI Tool | File | Format |
|---------|------|--------|
| **Cursor** | `.cursorrules` | Cursor rules |
| **Claude Code** | `.claude/CLAUDE.md` | Claude instructions |
| **Agent Skills** | `SKILL.md` | Open standard (agentskills.io) |
| **Codex** | `AGENTS.md` | OpenAI Codex format |
| **Gemini CLI** | `AGENTS.md` | Shared format |
| **Windsurf** | `.windsurfrules` | Windsurf rules |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Copilot format |

### Auto-Detection
```typescript
// Detect which AI tools are in use
const detected = [];
if (process.env.CURSOR_SESSION) detected.push('cursor');
if (existsSync('.claude')) detected.push('claude-code');
if (existsSync('.cursor')) detected.push('cursor');
// ... etc

// Install all detected, or prompt if none
```

### Flags
```bash
veryfront install                    # Auto-detect
veryfront install --target cursor    # Specific tool
veryfront install --target all       # Everything
veryfront install --global           # Install to ~/.cursor, ~/.claude, etc.
```

---

## AI Integration Files

### .cursorrules (Cursor)
```markdown
# Veryfront Project

You are in a Veryfront project - zero-config React meta-framework.

## Commands
- `veryfront dev` - Dev server with HMR
- `veryfront build` - Production build
- `veryfront deploy` - Deploy to cloud

## Structure
- `src/pages/` - File-based routing (pages/*.tsx → routes)
- `src/api/` - API routes (api/*.ts → /api/*)
- `src/ai/` - AI agents and MCP tools

## Adding Features
- New page: Create `src/pages/about.tsx`
- API endpoint: Create `src/api/users.ts`
- AI agent: Create `src/ai/agents/assistant.ts`

## Conventions
- TypeScript required
- React 19 features (use, Server Components)
- Tailwind for styling
```

### .claude/CLAUDE.md (Claude Code)
```markdown
# Veryfront Project

## Quick Reference
| Command | Purpose |
|---------|---------|
| `veryfront dev` | Start dev server |
| `veryfront build` | Production build |
| `veryfront deploy` | Deploy to Veryfront cloud |

## Project Structure
- `src/pages/*.tsx` → Routes (file-based)
- `src/api/*.ts` → API endpoints
- `src/ai/agents/` → AI agents
- `src/ai/tools/` → MCP tools

## When Asked to Add Features
1. Pages: Create in `src/pages/`
2. APIs: Create in `src/api/`
3. AI: Create in `src/ai/`

## Testing
- Run `veryfront dev` and check browser
- API endpoints at `/api/*`
```

### SKILL.md (Agent Skills - Open Standard)
```markdown
---
name: veryfront
description: Build and deploy fullstack AI-native React apps with Veryfront CLI
license: MIT
compatibility: Claude Code, Cursor, VS Code, Codex, Gemini CLI
metadata:
  author: veryfront
  version: "0.0.75"
---

# Veryfront

Zero-config React meta-framework for AI-native applications.

## Commands
- `veryfront dev` - Development server with HMR
- `veryfront build` - Production build
- `veryfront deploy` - Deploy to Veryfront cloud

## Project Structure
- `src/pages/*.tsx` → File-based routing
- `src/api/*.ts` → API endpoints
- `src/ai/agents/` → AI agents
- `src/ai/tools/` → MCP tools

## Adding Features
- New page: Create `src/pages/about.tsx`
- API endpoint: Create `src/api/users.ts`
- AI agent: Create `src/ai/agents/assistant.ts`
```

### AGENTS.md (Codex, Gemini, generic)
```markdown
# Veryfront Agent Instructions

This is a Veryfront project. Veryfront is a zero-config React meta-framework for AI-native apps.

## Commands
- `npx veryfront dev` - Development server
- `npx veryfront build` - Build for production
- `npx veryfront deploy` - Deploy to cloud

## File Conventions
- Pages: `src/pages/*.tsx` (file-based routing)
- APIs: `src/api/*.ts` (serverless functions)
- AI Agents: `src/ai/agents/*.ts`
- MCP Tools: `src/ai/tools/*.ts`

## Examples
Create a new page:
```tsx
// src/pages/about.tsx
export default function About() {
  return <h1>About</h1>;
}
```

Create an API:
```ts
// src/api/hello.ts
export function GET() {
  return Response.json({ message: "Hello" });
}
```
```

---

## Implementation

### Architecture (Modular & Extensible)

```
src/cli/
├── commands/
│   └── install/
│       ├── index.ts              # Public API (installCommand)
│       ├── install.ts            # Main command logic
│       ├── install.test.ts       # Unit tests (co-located)
│       ├── detect.ts             # Tool detection logic
│       ├── detect.test.ts        # Detection unit tests
│       ├── registry.ts           # AI tool registry (extensible)
│       └── registry.test.ts      # Registry unit tests
│
├── templates/
│   └── ai-rules/
│       ├── cursor.md             # Cursor template
│       ├── claude-code.md        # Claude Code template
│       ├── skill.md              # Agent Skills (SKILL.md format)
│       ├── copilot.md            # GitHub Copilot template
│       ├── windsurf.md           # Windsurf template
│       ├── agents.md             # Generic (Codex/Gemini)
│       └── _base.md              # Shared base content
│
└── tests/
    └── integration/
        └── install.integration.ts  # E2E install tests
```

### Module Boundaries

```typescript
// src/cli/commands/install/registry.ts
// Single source of truth for AI tools - easy to add new ones

export interface AITool {
  id: string;
  label: string;
  file: string;
  description: string;
  detect: () => Promise<boolean>;  // Detection logic per tool
  template: string;                 // Template filename
}

export const AI_TOOLS: AITool[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    file: '.cursorrules',
    description: 'Cursor IDE rules',
    detect: async () => await exists('.cursor') || !!Deno.env.get('CURSOR_SESSION'),
    template: 'cursor.md',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    file: '.claude/CLAUDE.md',
    description: 'Claude Code instructions',
    detect: async () => await exists('.claude'),
    template: 'claude-code.md',
  },
  {
    id: 'skill',
    label: 'Agent Skills',
    file: 'SKILL.md',
    description: 'Open standard (agentskills.io)',
    detect: async () => true,  // Always suggest - it's the universal format
    template: 'skill.md',
  },
  // ... more tools (copilot, windsurf, agents)
];

// To add a new IDE: Just add entry to AI_TOOLS array
// No changes needed to install.ts or detect.ts
```

### Files to Create

| File | Description |
|------|-------------|
| `src/cli/commands/install/index.ts` | Public API barrel |
| `src/cli/commands/install/install.ts` | Main command logic |
| `src/cli/commands/install/install.test.ts` | Unit tests |
| `src/cli/commands/install/detect.ts` | Tool detection |
| `src/cli/commands/install/detect.test.ts` | Detection tests |
| `src/cli/commands/install/registry.ts` | Tool registry (extensible) |
| `src/cli/commands/install/registry.test.ts` | Registry tests |
| `src/cli/templates/ai-rules/*.md` | Template files |
| `tests/integration/install.integration.ts` | Integration tests |

### Files to Modify

| File | Change |
|------|--------|
| `src/cli/index/command-router.ts` | Add `install` route |
| `src/cli/help/command-definitions.ts` | Add help entry |
| `src/cli/commands/main.ts` | Add "Install AI" to interactive menu |

### Install Command Implementation

```typescript
// src/cli/commands/install.ts
import { multiSelect } from '../ui/multi-select.ts';  // Multi-select component
import { colors } from '../ui/colors.ts';

const AI_TOOLS = [
  { id: 'cursor', label: 'Cursor', file: '.cursorrules', desc: '.cursorrules' },
  { id: 'claude-code', label: 'Claude Code', file: '.claude/CLAUDE.md', desc: '.claude/CLAUDE.md' },
  { id: 'skill', label: 'Agent Skills', file: 'SKILL.md', desc: 'SKILL.md (open standard)' },
  { id: 'copilot', label: 'GitHub Copilot', file: '.github/copilot-instructions.md', desc: '.github/copilot-instructions.md' },
  { id: 'windsurf', label: 'Windsurf', file: '.windsurfrules', desc: '.windsurfrules' },
  { id: 'agents', label: 'Codex / Gemini CLI', file: 'AGENTS.md', desc: 'AGENTS.md' },
];

export async function installCommand(options: {
  target?: string;  // Comma-separated: "cursor,claude-code"
  global?: boolean;
  force?: boolean;
}) {
  // Skip interactive if --target provided
  if (options.target) {
    const targets = options.target.split(',').map(t => t.trim());
    return installTargets(targets, options);
  }

  // Auto-detect which tools are in use (pre-select these)
  const detected = await detectAITools();

  // Multi-select UI (like integrations)
  console.log(colors.green('Select AI Coding Tools') + ' (space to toggle, enter to confirm)');
  console.log('Install integrations for your AI assistants.\n');

  const selected = await multiSelect({
    options: AI_TOOLS.map(t => ({
      label: t.label,
      value: t.id,
      description: t.desc,
      selected: detected.includes(t.id),  // Pre-select detected tools
    })),
    hint: detected.length > 0
      ? `Auto-detected ${detected.join(', ')} from project directories`
      : 'No AI tools detected - select the ones you use',
    shortcuts: { a: 'all', n: 'none' },
  });

  if (!selected || selected.length === 0) {
    console.log('No tools selected. Run `veryfront install` again to choose.');
    return;
  }

  await installTargets(selected, options);
}

async function detectAITools(): Promise<string[]> {
  const detected = [];
  if (await exists('.cursor') || Deno.env.get('CURSOR_SESSION')) detected.push('cursor');
  if (await exists('.claude')) detected.push('claude-code');
  if (await exists('.github')) detected.push('copilot');
  // Always suggest AGENTS.md as it's universal
  detected.push('agents');
  return detected;
}

async function installTargets(targets: string[], options: Options) {
  console.log('\nInstalling AI integrations...');

  for (const targetId of targets) {
    const tool = AI_TOOLS.find(t => t.id === targetId);
    if (!tool) continue;

    const content = await loadTemplate(targetId);
    const dest = options.global
      ? join(Deno.env.get('HOME')!, tool.file)
      : tool.file;

    // Create directories if needed
    await ensureDir(dirname(dest));

    // Check if file exists (unless --force)
    if (!options.force && await exists(dest)) {
      console.log(`${colors.yellow('!')} ${tool.file} exists (use --force to overwrite)`);
      continue;
    }

    await Deno.writeTextFile(dest, content);
    console.log(`${colors.green('✓')} ${tool.file}`);
  }

  console.log('\n' + colors.green('Your AI assistants now know Veryfront!'));
  console.log(colors.dim('Try: "Add a contact form with email validation"'));
}

async function loadTemplate(toolId: string): Promise<string> {
  // Templates bundled in CLI at src/cli/templates/ai-rules/
  const templatePath = new URL(`../templates/ai-rules/${toolId}.md`, import.meta.url);
  return await Deno.readTextFile(templatePath);
}
```

---

## Testing

### Unit Tests (Co-located)

```typescript
// src/cli/commands/install/registry.test.ts
import { assertEquals } from '@std/assert';
import { AI_TOOLS, getToolById, getTemplateContent } from './registry.ts';

Deno.test('registry - all tools have required fields', () => {
  for (const tool of AI_TOOLS) {
    assertEquals(typeof tool.id, 'string');
    assertEquals(typeof tool.label, 'string');
    assertEquals(typeof tool.file, 'string');
    assertEquals(typeof tool.detect, 'function');
  }
});

Deno.test('registry - getToolById returns correct tool', () => {
  const cursor = getToolById('cursor');
  assertEquals(cursor?.label, 'Cursor');
});

Deno.test('registry - getTemplateContent loads template', async () => {
  const content = await getTemplateContent('cursor');
  assertEquals(content.includes('Veryfront'), true);
});
```

```typescript
// src/cli/commands/install/detect.test.ts
import { assertEquals } from '@std/assert';
import { detectAITools } from './detect.ts';

Deno.test('detect - returns empty array when no tools detected', async () => {
  const detected = await detectAITools({ cwd: '/nonexistent' });
  assertEquals(detected, []);
});

Deno.test('detect - detects cursor from .cursor directory', async () => {
  // Create temp dir with .cursor
  const tempDir = await Deno.makeTempDir();
  await Deno.mkdir(`${tempDir}/.cursor`);

  const detected = await detectAITools({ cwd: tempDir });
  assertEquals(detected.includes('cursor'), true);

  await Deno.remove(tempDir, { recursive: true });
});
```

```typescript
// src/cli/commands/install/install.test.ts
import { assertEquals } from '@std/assert';
import { installTargets, parseTargetFlag } from './install.ts';

Deno.test('install - parseTargetFlag splits comma-separated values', () => {
  assertEquals(parseTargetFlag('cursor,claude-code'), ['cursor', 'claude-code']);
  assertEquals(parseTargetFlag('cursor'), ['cursor']);
});

Deno.test('install - writes file to correct location', async () => {
  const tempDir = await Deno.makeTempDir();

  await installTargets(['cursor'], { cwd: tempDir, force: true });

  const content = await Deno.readTextFile(`${tempDir}/.cursorrules`);
  assertEquals(content.includes('Veryfront'), true);

  await Deno.remove(tempDir, { recursive: true });
});
```

### Integration Tests

```typescript
// tests/integration/install.integration.ts
import { assertEquals } from '@std/assert';
import { runCli } from '../helpers/run-cli.ts';

Deno.test('install integration - full flow with auto-detect', async () => {
  const tempDir = await Deno.makeTempDir();

  // Setup: Create .cursor directory to trigger detection
  await Deno.mkdir(`${tempDir}/.cursor`);

  // Run: veryfront install --target cursor (non-interactive)
  const result = await runCli(['install', '--target', 'cursor'], { cwd: tempDir });

  // Assert: .cursorrules created
  assertEquals(result.exitCode, 0);
  assertEquals(await exists(`${tempDir}/.cursorrules`), true);

  // Assert: Content is valid
  const content = await Deno.readTextFile(`${tempDir}/.cursorrules`);
  assertEquals(content.includes('veryfront dev'), true);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test('install integration - multiple targets', async () => {
  const tempDir = await Deno.makeTempDir();

  await runCli(['install', '--target', 'cursor,claude-code,agents'], { cwd: tempDir });

  assertEquals(await exists(`${tempDir}/.cursorrules`), true);
  assertEquals(await exists(`${tempDir}/.claude/CLAUDE.md`), true);
  assertEquals(await exists(`${tempDir}/AGENTS.md`), true);

  await Deno.remove(tempDir, { recursive: true });
});

Deno.test('install integration - respects --force flag', async () => {
  const tempDir = await Deno.makeTempDir();

  // Create existing file
  await Deno.writeTextFile(`${tempDir}/.cursorrules`, 'existing content');

  // Without --force: should skip
  await runCli(['install', '--target', 'cursor'], { cwd: tempDir });
  assertEquals(await Deno.readTextFile(`${tempDir}/.cursorrules`), 'existing content');

  // With --force: should overwrite
  await runCli(['install', '--target', 'cursor', '--force'], { cwd: tempDir });
  const content = await Deno.readTextFile(`${tempDir}/.cursorrules`);
  assertEquals(content.includes('Veryfront'), true);

  await Deno.remove(tempDir, { recursive: true });
});
```

### Run Tests

```bash
# Unit tests only
deno task test:unit src/cli/commands/install/

# Integration tests
deno task test:integration tests/integration/install.integration.ts

# All tests
deno task test
```

---

## Verification

1. **Unit tests pass**: `deno task test:unit src/cli/commands/install/`
2. **Integration tests pass**: `deno task test:integration`
3. **Manual test scaffold**: `mkdir test && cd test && npx veryfront`
4. **Manual test install**: `veryfront install` in the scaffolded project
5. **Test with Cursor**: Open project, ask "Add a contact page"
6. **Test with Claude Code**: Run `claude`, ask "Add an API endpoint"
7. **Test detection**: Verify correct files pre-selected based on environment
8. **Test extensibility**: Add a mock tool to registry, verify it appears in UI

---

## Summary

**Two commands for AI-native development**:

```bash
npx veryfront              # Scaffold minimal project
veryfront install          # Setup AI assistant integration
```

**Result**: Any AI coding tool (Cursor, Claude Code, Codex, Gemini) instantly understands the project and can help build features.

**Key principles**:
- Minimal scaffold (grow as needed)
- Meet users where they are (support all AI tools)
- One command to enable AI assistance
- Standard formats (.cursorrules, CLAUDE.md, AGENTS.md)
