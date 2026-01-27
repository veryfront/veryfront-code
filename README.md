# Veryfront Code

The simplest way to build AI-powered apps.

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

One command. Zero config. Just build.

[Docs](https://veryfront.com/docs/framework) · [Discord](https://discord.gg/veryfront) · [X](https://x.com/veryfrontdev) · MIT

## Releasing

Create a new release with `gh release create vX.X.X`. The publish workflow runs automatically and takes ~4-5 minutes:

1. Builds native binaries for 5 platforms (macOS arm64/x64, Linux x64/arm64, Windows x64)
2. Publishes to npm with provenance
3. Creates GitHub releases in both repos
4. Updates Homebrew formula
