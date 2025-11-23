# Veryfront AI - Agent Enhancements Example

This example demonstrates advanced agent features:

- Multiple memory strategies (conversation, buffer, summary)
- Agent composition (agents calling other agents)
- Multi-agent workflows (sequential and parallel)
- Agent-as-tool pattern for reusability
- Memory management and optimization

## Setup

1. Set your API key (optional for demonstration):

**Option A: Environment variable**
```bash
export OPENAI_API_KEY=sk-...
```

**Option B: .env file (recommended)**
```bash
cp ../../.env.example .env
# Then edit .env and add your API key
```

2. Run the example:

```bash
deno run --allow-net --allow-env --allow-read example.ts
```

Note: If you have an API key set, the workflow execution will take 10-20 seconds as it makes sequential API calls to demonstrate multi-agent workflows.

## What It Does

1. **Memory Strategies**:
   - Conversation memory: Keeps all messages
   - Buffer memory: Keeps only last N messages
   - Summary memory: Summarizes old messages to save tokens

2. **Agent Composition**:
   - Convert agents into tools
   - Agents can call other specialized agents
   - Modular and reusable agent design

3. **Multi-Agent Workflows**:
   - Sequential workflows (step-by-step processing)
   - Parallel workflows (concurrent execution)
   - Data passing between workflow steps

## Files

- `example.ts` - Main example demonstrating agent enhancements

## Memory Strategies

### Conversation Memory (Default)
```typescript
const agent = agent({
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },
});
// Keeps all messages, best for context retention
```

### Buffer Memory
```typescript
const agent = agent({
  memory: {
    type: 'buffer',
    maxMessages: 10,
  },
});
// Keeps only last N messages, good for long conversations
```

### Summary Memory
```typescript
const agent = agent({
  memory: {
    type: 'summary',
    maxTokens: 2000,
  },
});
// Summarizes old messages, best for token optimization
```

## Agent Composition

```typescript
// Create specialized agents
const researchAgent = agent({ /* ... */ });
const writerAgent = agent({ /* ... */ });

// Convert agent to tool
const researchTool = agentAsTool(researchAgent, {
  name: 'research',
  description: 'Research a topic',
});

// Use in another agent
const mainAgent = agent({
  tools: { research: researchTool },
});
```

## Multi-Agent Workflows

```typescript
const workflow = createWorkflow({
  steps: [
    { agent: researchAgent, name: 'research' },
    { agent: writerAgent, name: 'write' },
  ],
});

const result = await workflow.execute('Write about AI');
```

## Use Cases

- **Long Conversations**: Use buffer or summary memory
- **Specialized Tasks**: Compose agents for modular workflows
- **Complex Pipelines**: Chain agents for multi-step processing
- **Token Optimization**: Choose appropriate memory strategy
