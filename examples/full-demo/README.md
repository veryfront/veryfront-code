# Veryfront AI - Full Demo Application

**Complete end-to-end demonstration** of the Veryfront AI Native Framework.

## What This Demo Shows

✅ **All 8 Phases** implemented and working:

1. ✅ **Foundation** - Agent runtime, tool execution
2. ✅ **MCP Integration** - Auto-discovery, MCP server
3. ✅ **Agent Enhancements** - Memory, composition, workflows
4. ✅ **Headless Hooks** - useChat, useAgent (Layer 1)
5. ✅ **Unstyled Primitives** - Custom-styled UI (Layer 2)
6. ✅ **Styled Components** - Production chat UI (Layer 3)
7. ✅ **Developer Experience** - Testing, debugging
8. ✅ **Production Features** - Rate limiting, caching, cost tracking, security

## Features Demonstrated

### Backend
- ✅ Convention-driven tool creation (auto-discovery)
- ✅ Agent with memory and tools
- ✅ Multi-agent composition
- ✅ Multi-agent workflow
- ✅ MCP server with JSON-RPC
- ✅ Rate limiting
- ✅ Response caching
- ✅ Cost tracking
- ✅ Input validation
- ✅ Output filtering

### Frontend (All 3 Layers)
- ✅ Layer 1: Custom UI with headless hooks
- ✅ Layer 2: Design system integration with primitives
- ✅ Layer 3: Production chat with styled components
- ✅ Error boundary
- ✅ Streaming responses
- ✅ Tool call visualization

### Developer Tools
- ✅ Agent testing
- ✅ Tool testing
- ✅ Execution inspection
- ✅ Registry debugging

## Run the Demo

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-...

# Run the demo
deno run --allow-net --allow-env --allow-read demo.ts
```

## Demo Structure

```
full-demo/
├── ai/                    # Auto-discovered!
│   ├── tools/
│   │   ├── search.ts     # Web search tool
│   │   └── calculate.ts  # Calculator tool
│   ├── agents/
│   │   ├── assistant.ts  # Main assistant
│   │   ├── researcher.ts # Research agent
│   │   └── writer.ts     # Writing agent
│   ├── resources/
│   │   └── docs/[id]/
│   │       └── content.ts
│   └── prompts/
│       └── system.ts
│
├── demo.ts               # Main demo script
└── README.md            # This file
```

## What Happens

1. **Auto-Discovery**: Scans `ai/` and registers all components
2. **MCP Server**: Starts server on port 3001
3. **Production Features**: Demonstrates rate limiting, caching, cost tracking
4. **Agent Testing**: Tests agents with multiple test cases
5. **Multi-Agent Workflow**: Shows agents collaborating
6. **Cost Report**: Displays API usage and costs
7. **Security**: Shows input validation and output filtering

## Expected Output

```
=== Veryfront AI - Full Demo ===

Phase 1: Foundation ✅
Phase 2: MCP Integration ✅
Phase 3: Agent Enhancements ✅
Phase 4: Headless Hooks ✅
Phase 5: Unstyled Primitives ✅
Phase 6: Styled Components ✅
Phase 7: Developer Experience ✅
Phase 8: Production Features ✅

=== All 8 Phases Working ===

[Auto-Discovery]
  Tools: 2 discovered
  Agents: 3 discovered
  Resources: 1 discovered
  Prompts: 1 discovered

[MCP Server]
  Running on port 3001
  Tools exposed: 2
  Resources exposed: 1

[Production Features]
  ✅ Rate limiting active
  ✅ Caching enabled
  ✅ Cost tracking running
  ✅ Security filters active

[Testing]
  Agent tests: 3/3 passed
  Tool tests: 5/5 passed

[Workflow Execution]
  Step 1: Research ✅
  Step 2: Write ✅
  Output: [Generated content]

[Cost Report]
  Total cost: $0.05
  Tokens used: 2,500
  Cached responses: 2

=== Demo Complete ===
All features working! 🎉
```

## Integration Example (Frontend)

See `ui-demo.tsx` for React component examples using all 3 layers.
