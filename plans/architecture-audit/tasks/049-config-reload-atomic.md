# 049 - Atomic Config Reload

## Priority: P2 - STABILITY

## North Star
Config file reads never see partial writes. Hot reload always gets complete, valid config.

## References
- Issue: [017.5-config-reload-race.md](../017.5-config-reload-race.md)
- Related: [014-config-change-invalidation.md](./014-config-change-invalidation.md)

## The Problem

File reads during writes can return truncated/malformed config, causing parse failures.

## Checklist
- [ ] Implement atomic write pattern (temp + rename)
- [ ] Add read retry with backoff
- [ ] Debounce file watcher events
- [ ] Keep previous valid config on failure
- [ ] Test hot reload during rapid saves

## Acceptance Criteria
- [ ] Config always valid or previous kept
- [ ] No JSON parse errors during save
- [ ] Hot reload works with rapid saves

## Quality Gates
- [ ] Rapid save test doesn't cause errors
- [ ] Previous config preserved on parse failure
- [ ] Reload latency < 200ms

## Test Coverage
- [ ] Unit: Atomic write verified
- [ ] Unit: Read retry works
- [ ] Unit: Invalid config keeps previous
- [ ] Integration: Hot reload during edits

## Implementation

```typescript
// Atomic write
async function writeConfig(config: Config): Promise<void> {
  const tempPath = `${CONFIG_PATH}.tmp.${Date.now()}`;
  await Deno.writeTextFile(tempPath, JSON.stringify(config, null, 2));
  await Deno.rename(tempPath, CONFIG_PATH);
}

// Read with retry
async function readConfig(retries = 3): Promise<Config> {
  for (let i = 0; i < retries; i++) {
    try {
      const content = await Deno.readTextFile(CONFIG_PATH);
      return JSON.parse(content);
    } catch {
      if (i < retries - 1) await delay(50 * (i + 1));
    }
  }
  throw new Error("Config read failed after retries");
}
```
