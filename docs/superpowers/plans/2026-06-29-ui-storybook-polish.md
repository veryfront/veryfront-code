# UI Storybook polish plan

## Goal

Make the Veryfront Code UI workbench useful for reviewing production-grade components. Each exported styled chat component must have a dedicated Storybook story, and the default visual treatment must align with the denser Veryfront Studio component language without importing Studio-only code.

## Constraints

- Keep shipped UI source under `src/react`.
- Keep Storybook isolated in `storybook/`.
- Preserve public exports and prop shapes.
- Do not import Studio aliases, Radix, or CVA into Veryfront Code.
- Use class-only styling changes unless a component has an actual behavior bug.

## Cleanup steps

1. Add a Storybook contract test that requires dedicated stories for reviewable exported chat UI components.
2. Port Studio visual patterns into existing Veryfront Code classes:
   - smaller radii,
   - flatter outline surfaces,
   - compact badges and controls,
   - no active scale on buttons,
   - composer shaped like a compact panel rather than a large pill.
3. Add dedicated story files for core components and state variants.
4. Keep primitive stories framed as composed building blocks, not raw product UI.
5. Verify with `deno task storybook:check`, `deno task build:storybook`, focused `deno check`, lint, fmt, and `git diff --check`.

## Non-goals

- Do not move UI out of `src/react`.
- Do not add Storybook to public framework exports.
- Do not copy Studio app containers or app-only dependencies.
