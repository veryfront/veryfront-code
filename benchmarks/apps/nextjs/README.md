# Next.js Benchmark App

This directory contains the matched Next.js benchmark app used in phase-1 local
comparisons.

Current shape:

- Pages Router app with canonical benchmark routes
- Browser/server artifacts emitted via:
  - `deno task bench:browser -- --framework nextjs`
  - `deno task bench:server -- --framework nextjs`

First run note:

- dependencies are installed locally in `benchmarks/apps/nextjs/`
- the runner builds the app before starting `next start`
