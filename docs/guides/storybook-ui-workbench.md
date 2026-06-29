# Storybook UI workbench

Veryfront Code keeps shipped UI source in `src/react`.

Keep shipped UI source under `src/react`.

Storybook lives in the dev-only `storybook/` package. Use it to review the components that Veryfront ships without adding Storybook to the framework runtime.

Run the local workbench with `deno task storybook`:

```bash
deno task storybook
```

Build the static review bundle with `deno task build:storybook`:

```bash
deno task build:storybook
```

Check the Storybook package boundary:

```bash
deno task storybook:check
```

Storybook must import real Veryfront source modules, such as `veryfront/chat` or `src/react` barrels. Do not copy framework components into stories.

Storybook must not become a public `deno.json` export.
