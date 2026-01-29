# Veryfront Code

The simplest way to build AI-powered apps. One command. Zero config. Just build.

```bash
npx veryfront
```

```
╭──────────────────────────────────────────────────────────╮
│                                                          │
│  ○ ○ ○ ○ ○ ○ ○                                           │
│  ○ ● ● ● ○ ○ ○   Veryfront Code is now running           │
│  ○ ● ● ● ○ ○ ○                                           │
│  ○ ● ● ○ ● ● ○   Url http://veryfront.me:8080            │
│  ○ ○ ○ ● ● ● ○   Mcp http://veryfront.me:9999/mcp        │
│  ○ ○ ○ ● ● ● ○                                           │
│  ○ ○ ○ ○ ○ ○ ○                                           │
│                                                          │
╰──────────────────────────────────────────────────────────╯
```

## Terminal UI

The interactive TUI gives you full control from your terminal.

<details>
<summary>Keyboard Shortcuts</summary>

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate projects |
| `enter` | Open selected project |
| `o` | Open in browser |
| `s` | Open in Studio |
| `i` | Open in IDE |
| `n` | Create new project |
| `l` | Toggle logs |
| `j` `k` | Scroll logs |
| `?` | Show all shortcuts |
| `q` | Quit |

**When logged in:**

| Key | Action |
|-----|--------|
| `p` | Pull remote project |
| `u` | Push to remote |
| `a` | Login |
| `x` | Logout |

</details>

## Connect Your Coding Agent

Veryfront exposes an MCP server that gives AI coding agents access to live dev server state—errors, logs, and HMR triggers.

### Claude Code

<details>
<summary>Option 1: Install the plugin</summary>

```bash
/plugin install veryfront@veryfront/claude-plugins
```

</details>

<details>
<summary>Option 2: Manual configuration</summary>

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "veryfront": {
      "command": "veryfront",
      "args": ["mcp"]
    }
  }
}
```

</details>

### Codex CLI

<details>
<summary>Configuration</summary>

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.veryfront]
command = "veryfront"
args = ["mcp"]
```

</details>

### Gemini CLI

<details>
<summary>Configuration</summary>

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "veryfront": {
      "command": "veryfront",
      "args": ["mcp"]
    }
  }
}
```

</details>

### Available Tools

Once connected, your agent gets access to:

| Tool | Description |
|------|-------------|
| `vf_get_errors` | Live compile, runtime, and bundle errors |
| `vf_get_logs` | Recent server logs with filtering |
| `vf_get_status` | Dev server status and stats |
| `vf_trigger_hmr` | Trigger hot module reload |


