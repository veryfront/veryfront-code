# Getting Started

Welcome to Acme Platform. This guide covers initial setup and core concepts.

## Installation

Install the CLI globally:

```bash
npm install -g @acme/cli
```

## Creating a Project

Run the init command to scaffold a new project:

```bash
acme init my-project
cd my-project
```

## Project Structure

- `src/` — Application source code
- `config/` — Configuration files
- `tests/` — Test suite
- `docs/` — Documentation

## Configuration

Create an `acme.config.ts` file in your project root:

```ts
export default {
  name: "my-project",
  region: "us-east-1",
  features: ["auth", "storage"],
};
```

## Next Steps

- Read the [Architecture Guide](./architecture) to understand the system design
- Check [API Reference](./api-reference) for available endpoints
- Join our Discord community for support
