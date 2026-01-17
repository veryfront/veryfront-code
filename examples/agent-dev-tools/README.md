# Veryfront AI - Developer Tools Example

This example demonstrates the testing and debugging utilities for AI agents:

- Testing agents with expected behaviors
- Testing tools with various inputs
- Inspecting agent configuration and capabilities
- Registry overview and debugging
- Agent execution flow analysis

## Setup

1. No API key required for basic testing (some tests use mock results)

   For full testing with real API calls, set your API key:
   ```bash
   # Option A: Environment variable
   export OPENAI_API_KEY=sk-...

   # Option B: .env file (recommended)
   cp ../../.env.example .env
   # Then edit .env and add your API key
   ```

2. Run the example:

```bash
deno run --allow-net --allow-env --allow-read example.ts
```

## What It Does

1. **Tool Testing**: Tests individual tools with various inputs
2. **Agent Testing**: Tests agents with expected behaviors and tool calls
3. **Agent Inspection**: Analyzes agent configuration and available tools
4. **Registry Overview**: Shows all registered components
5. **Test Reporting**: Pretty-printed test results with pass/fail status

## Files

- `example.ts` - Main example demonstrating developer tools

## Developer Tools API

### testTool()
```typescript
const results = await testTool(calculatorTool, [
  {
    name: 'Addition test',
    input: { a: 2, b: 3 },
    expected: 5,
  },
]);
```

### testAgent()
```typescript
const results = await testAgent(myAgent, [
  {
    name: 'Greeting test',
    input: 'Hello',
    expected: /hi|hello/i,
  },
  {
    name: 'Tool usage',
    input: 'Calculate 2+2',
    expectToolCalls: ['calculator'],
  },
]);
```

### inspectAgent()
```typescript
const report = inspectAgent(myAgent);
printInspectionReport(report);
```

### printRegistryOverview()
```typescript
printRegistryOverview();
// Shows all registered tools, agents, resources, prompts
```

## Use Cases

- **CI/CD**: Run agent tests in continuous integration
- **Development**: Validate agent behavior during development
- **Debugging**: Inspect agent configuration and tool availability
- **Documentation**: Generate reports on agent capabilities
- **Quality Assurance**: Ensure agents behave as expected
