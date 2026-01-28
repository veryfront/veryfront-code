# Veryfront Flywheel

**You describe it. Claude builds it.**

## Algorithm

```
flywheel(intent):
  outcome = ask("What's the outcome?")
  loop(intent, outcome)

loop(intent, outcome):
  write(intent)
  errors = vf_get_errors()

  if errors:
    fix(errors)
    return loop(intent, outcome)

  if not matches(outcome):
    return loop(refine(intent), outcome)

  return done()
```

## Execution

```
User: "Build a dashboard"

flywheel("dashboard"):
│
├─ outcome = "Show stats with chart"
│
└─ loop("dashboard", outcome):
   │
   ├─ write → app/page.tsx, app/api/stats/route.ts
   ├─ errors = ["TypeError at line 12"]
   ├─ fix(errors)
   │
   └─ loop("dashboard", outcome):      ← recurse
      │
      ├─ errors = []
      ├─ matches(outcome) = true
      │
      └─ done()
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `vf_get_errors` | Observe errors |
| `vf_get_logs` | Observe requests |
| `vf_trigger_hmr` | Force refresh |

## Verify

```bash
npx veryfront
curl localhost:8080/_dev/api/live-errors
curl localhost:8080/_dev/api/live-logs
```
