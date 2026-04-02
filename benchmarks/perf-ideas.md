# Veryfront Performance Ideas

Current high-signal candidates from the local Veryfront-vs-Next.js benchmark:

1. **`/_vf_modules` request waterfall**
   - interactive routes still trigger multiple module fetches
   - likely hurts TTFB-adjacent route completion and LCP

2. **Large HTML shell / inline payload**
   - benchmark HTML is materially larger than the Next.js baseline
   - likely contributors: import maps, hydration metadata, inline runtime helpers

3. **Client boot/runtime startup cost**
   - router/context/head/runtime boot path may be doing too much before the route becomes interactive

4. **SSR response assembly cost**
   - high-percentile server latency suggests request-path work still dominates the local benchmark

## Guardrails

- preserve the general **JIT-friendly architecture** of the runtime
- avoid benchmark-specific special cases for benchmark routes
- keep optimizations framework-wide and evidence-driven
- prefer architectural wins over fragile micro-tuning
