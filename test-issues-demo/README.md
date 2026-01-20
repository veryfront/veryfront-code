# Issues Demo - Spec-Driven Development

This demo shows how to use the file-based issue tracking system with spec-driven development.

## Core Principle

**Everything is just a file.** Specs, plans, RFCs, tasks, and bugs are all markdown files with YAML frontmatter in the `issues/` folder.

## Workflow

### 1. Write a Spec (Plan)

Create a plan file that describes what you're building:

```bash
veryfront issues create --type plan --title "Authentication System Specification"
```

This creates `issues/PLAN-xxx.md` with your spec. Edit it to add:
- Overview and goals
- Architecture diagrams
- Task checklist
- Security considerations
- API design
- Success metrics

See `issues/PLAN-1737348000000-example.md` for a complete example.

### 2. Break Into Tasks

Create tasks linked to the plan:

```bash
veryfront issues create \
  --type task \
  --title "Implement JWT signing" \
  --milestone PLAN-1737348000000-example \
  --priority high \
  --assignee alice
```

Each task references the plan via `milestone` field.

### 3. Track Progress

View all tasks for a plan:

```bash
veryfront issues list --milestone PLAN-1737348000000-example
```

View the kanban board:

```bash
veryfront issues list
```

Output:
```
⭕ todo

  🔴 Login page shows blank screen on Safari

🔄 in_progress

  🟠 Add OAuth provider integration · @bob
  🟠 Implement JWT signing and verification · @alice

3 issues
```

### 4. Update Status

As you work, update task status:

```bash
veryfront issues edit TASK-1737348100000-jwt-signing --status done
```

Or edit the file directly in your editor!

### 5. Ship & Close

When all tasks are done, mark the plan as complete:

```bash
veryfront issues edit PLAN-1737348000000-example --status done
```

## File Structure

```
issues/
├── PLAN-1737348000000-example.md          # Spec/plan
├── TASK-1737348100000-jwt-signing.md      # Task linked to plan
├── TASK-1737348200000-oauth-integration.md # Task linked to plan
└── ISSUE-1737348300000-login-bug.md       # Bug report
```

## Example Files

This demo includes:

1. **PLAN-1737348000000-example.md** - Complete authentication system spec
   - Architecture overview
   - Task breakdown
   - Security considerations
   - API design
   - Success metrics

2. **TASK-1737348100000-jwt-signing.md** - Task for JWT implementation
   - Linked to plan via `milestone: PLAN-1737348000000-example`
   - Acceptance criteria
   - Implementation notes

3. **TASK-1737348200000-oauth-integration.md** - Task for OAuth
   - Provider details
   - API design
   - Blocks/dependencies

4. **ISSUE-1737348300000-login-bug.md** - Bug report
   - Reproduction steps
   - Impact analysis
   - Investigation notes

## For AI Agents

AI agents can work with issues directly by reading/writing markdown files:

```typescript
// Read a plan
const planContent = await Deno.readTextFile('issues/PLAN-xxx.md')

// Create a task
const task = `---
type: task
title: Implement feature X
milestone: PLAN-xxx
status: todo
priority: high
---

# Implement feature X

Description here...
`
await Deno.writeTextFile('issues/TASK-yyy.md', task)

// Update status
// Just modify the frontmatter field and write back
```

## Why This Works

1. **Simple** - Files are the source of truth
2. **Git-friendly** - All changes tracked and diffable
3. **Editor-native** - Edit in VSCode, Vim, whatever you like
4. **AI-native** - Standard format (YAML + markdown)
5. **Flexible** - Add custom fields, embed diagrams, link to external docs
6. **No lock-in** - Just markdown files, migrate anywhere

## Commands Reference

```bash
# Create
veryfront issues create --type plan --title "My Spec"
veryfront issues create --type task --milestone PLAN-xxx

# List
veryfront issues list                    # Kanban board
veryfront issues list --type plan        # Just plans
veryfront issues list --milestone PLAN-xxx  # Tasks for a plan

# View
veryfront issues view PLAN-xxx

# Edit
veryfront issues edit TASK-xxx --status done
veryfront issues edit TASK-xxx --assignee alice

# Delete
veryfront issues edit TASK-xxx --delete
```

## Try It

```bash
cd test-issues-demo

# View the kanban board
veryfront issues list

# See the plan
veryfront issues view PLAN-1737348000000-example

# See a task
veryfront issues view TASK-1737348100000-jwt-signing

# Create your own task
veryfront issues create \
  --type task \
  --title "Add monitoring" \
  --milestone PLAN-1737348000000-example
```

That's it! Spec-driven development with just files and 4 commands.
