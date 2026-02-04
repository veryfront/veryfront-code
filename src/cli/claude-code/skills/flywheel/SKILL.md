---
name: flywheel
description: Development flywheel - autonomous cycle of run, observe, fix, verify. Use for continuous development with browser automation.
license: MIT
compatibility: Veryfront server + Chrome MCP
metadata:
  author: veryfront
  version: "1.0"
  tools: vf_wait_for_ready, vf_get_flywheel_status, vf_trigger_hmr, vf_get_errors, vf_get_logs
---

# Development Flywheel

Self-reinforcing development loop: **Run → Observe → Fix → Verify → Repeat**

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│   RUN   │────────▶│ OBSERVE │────────▶│   FIX   │
└─────────┘         └─────────┘         └─────────┘
     ▲                                       │
     │              ┌─────────┐              │
     └──────────────│ VERIFY  │◀─────────────┘
                    └─────────┘
```

## Quick Start

```
# 1. Start server in background
Bash: deno task start &

# 2. Wait for ready
vf_wait_for_ready({ port: 8080 })

# 3. Open browser (Chrome MCP)
tabs_context_mcp() → tabs_create_mcp() → navigate({ url: "http://localhost:8080" })

# 4. Take baseline screenshot
computer({ action: "screenshot" })

# 5. Begin flywheel loop
```

## Tools

### Flywheel Core

| Tool                     | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `vf_wait_for_ready`      | Poll until server accepts requests            |
| `vf_get_flywheel_status` | Aggregated view: server + errors + logs + HMR |
| `vf_trigger_hmr`         | Force browser refresh after code changes      |

### Server Errors & Logs

| Tool              | Purpose                            |
| ----------------- | ---------------------------------- |
| `vf_get_errors`   | Compile, runtime, bundle errors    |
| `vf_get_logs`     | Server logs with filtering         |
| `vf_clear_errors` | Clear error collector after fixing |

### Browser (Chrome MCP)

| Tool                                 | Purpose                |
| ------------------------------------ | ---------------------- |
| `computer({ action: "screenshot" })` | Visual verification    |
| `read_console_messages`              | Browser console errors |
| `read_network_requests`              | Failed API calls       |

## Observe Loop

```typescript
// Check all error sources in one call
const status = await vf_get_flywheel_status({ port: 8080 });

if (!status.server.running) {
  // Server crashed - restart
}

if (status.errors.total > 0) {
  // Compilation or runtime errors
  // Get details: vf_get_errors()
}

if (status.logs.errors > 0) {
  // Server logged errors
  // Get details: vf_get_logs({ level: "error" })
}

// Browser side (Chrome MCP)
read_console_messages({ tabId, pattern: "error|Error" });
read_network_requests({ tabId, urlPattern: "/api/" });
```

## Fix → Verify Cycle

```
1. Read error details
   vf_get_errors() → { file, line, message }

2. Read source file
   Read({ file_path: error.file })

3. Fix the issue
   Edit({ file_path, old_string, new_string })

4. Trigger HMR
   vf_trigger_hmr({ path: error.file })

5. Wait for debounce (300ms)
   Bash: sleep 0.5

6. Verify fix
   vf_get_flywheel_status() → errors.total should be 0
   computer({ action: "screenshot" }) → visual check
```

## Edge Cases

### Server Crash

```
vf_get_flywheel_status() → server.running = false

# Restart
Bash: deno task start &
vf_wait_for_ready({ port: 8080 })
```

### Port In Use

```
vf_wait_for_ready() → timeout

# Check what's using the port
Bash: lsof -i :8080
```

### HMR Not Working

```
vf_get_flywheel_status() → hmr.enabled = false

# Server may have started without HMR
# Restart with HMR enabled
Bash: deno task start --hmr &
```

### Browser Disconnected

```
vf_trigger_hmr() → success but no visual change

# Force full page reload via Chrome MCP
navigate({ url: "http://localhost:8080", tabId })
```

## Full Example

```
# === SETUP ===
Bash: deno task start &
vf_wait_for_ready({ port: 8080, timeout: 30000 })
tabs_context_mcp({ createIfEmpty: true })
tabs_create_mcp()
navigate({ url: "http://localhost:8080", tabId })
computer({ action: "screenshot", tabId })

# === OBSERVE ===
status = vf_get_flywheel_status({ port: 8080 })

if (status.errors.compile > 0) {
  errors = vf_get_errors({ type: "compile" })
  # Fix compile error...
}

browserErrors = read_console_messages({ tabId, onlyErrors: true })
if (browserErrors.length > 0) {
  # Fix runtime error...
}

# === FIX ===
Read({ file_path: "app/page.tsx" })
Edit({ file_path: "app/page.tsx", old_string, new_string })

# === VERIFY ===
vf_trigger_hmr({ path: "app/page.tsx" })
computer({ action: "wait", duration: 0.5 })
computer({ action: "screenshot", tabId })
vf_get_flywheel_status() # Confirm errors.total = 0

# === REPEAT ===
```

## Status Response

```json
{
  "server": {
    "running": true,
    "port": 8080,
    "url": "http://localhost:8080",
    "uptime": 12345
  },
  "errors": {
    "total": 1,
    "compile": 1,
    "runtime": 0,
    "bundle": 0,
    "hmr": 0,
    "module": 0,
    "latest": {
      "type": "compile",
      "message": "Cannot find name 'foo'",
      "file": "app/page.tsx",
      "timestamp": 1705432100000
    }
  },
  "logs": {
    "total": 50,
    "errors": 2,
    "warnings": 5
  },
  "hmr": {
    "enabled": true,
    "reloadListeners": 1,
    "invalidateListeners": 1,
    "triggerCalls": 3,
    "broadcastsSent": 2
  }
}
```
