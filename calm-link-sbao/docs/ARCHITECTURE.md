# Architecture

## Overview

This project uses Veryfront, a React meta-framework built on Deno.

## Request Flow

```
Browser Request
     │
     ▼
┌─────────────┐
│   Router    │  File-based routing
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Page/API  │  React component or API handler
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    SSR      │  Server-side rendering
└──────┬──────┘
       │
       ▼
Browser Response
```

## Directory Structure

| Directory | Purpose |
|-----------|---------|
| `src/pages/` | File-based routes |
| `src/api/` | API endpoints |
| `src/components/` | Reusable React components |
| `src/styles/` | Global CSS |
| `docs/` | Project documentation |


## AI Architecture

```
User Input
     │
     ▼
┌─────────────┐
│  Chat UI    │  React component
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  /api/chat  │  Streaming endpoint
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  AI Agent   │  Veryfront AI SDK
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   OpenAI    │  LLM provider
└─────────────┘
```

## Key Components

- **ChatInterface**: Main chat UI component
- **MessageList**: Renders conversation history
- **ChatInput**: User input with send button
- **useChat**: Hook for chat state management
