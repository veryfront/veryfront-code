# Releasing

Create a new release with `gh release create vX.X.X`. The publish workflow runs automatically and takes ~4-5 minutes:

1. Builds native binaries for 5 platforms (macOS arm64/x64, Linux x64/arm64, Windows x64)
2. Publishes to npm with provenance
3. Creates GitHub releases in both repos
4. Updates Homebrew formula
