# Async Worker with Redis Streams

This example demonstrates a scalable, production-ready architecture for long-running AI tasks.

It uses **Redis Streams** to decouple the API (producer) from the Agents (consumers), allowing you to scale workers horizontally.

## Architecture

1. **API (`server.ts`)**: Receives requests, creates a `run` record in Redis, pushes a job to the stream.
2. **Worker (`worker.ts`)**: Listens to the stream via consumer groups. Picks up a job, executes the Veryfront Agent, and updates the run status.
3. **Redis**: Stores the stream (`agent:stream`) and run state (`agent:run:{id}`).

## Prerequisites

- Docker (to run Redis)
- Deno

## Setup

1. **Start Redis**:
   ```bash
   docker-compose up -d
   ```

2. **Set API Keys (Optional)**:
   If you want to run real AI models, set your keys:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```
   _If skipped, the worker runs in "simulation mode" (fake processing)._

## Running

You need two terminal windows:

**Terminal 1: Start the API**

```bash
deno task api
```

_Listens on port 8080._

**Terminal 2: Start a Worker**

```bash
deno task worker
```

_You can run multiple workers in separate terminals to scale processing._

## Usage

**1. Create a Run**

```bash
curl -X POST http://localhost:8080/runs \
  -H "content-type: application/json" \
  -d '{"input":"Calculate 5 + 5 and tell me a joke about it"}'
```

Response: `{"runId":"<RUN_ID>"}`

**2. Check Status**

```bash
curl http://localhost:8080/runs/<RUN_ID>
```

Response (Queued/Running):

```json
{
  "id": "...",
  "status": "queued",
  ...
}
```

Response (Completed):

```json
{
  "id": "...",
  "status": "completed",
  "result": "The result is 10. Why was 6 afraid of 7? ..."
}
```

**3. Cancel a Run**

```bash
curl -X POST http://localhost:8080/runs/<RUN_ID>/cancel
```

## Key Concepts Demonstrated

- **Redis Streams Consumer Groups**: Reliable message delivery (at-least-once).
- **Horizontal Scaling**: Run `deno task worker` 10 times to handle 10x load.
- **State Persistence**: Job status is queryable even if workers crash.
- **Veryfront Agent Integration**: The worker wraps a standard Veryfront agent instance.
