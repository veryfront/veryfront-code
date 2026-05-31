---
title: "App"
description: "How apps own routes, API routes, data loading, and rendering."
order: 20
---

An app owns the user-facing surface of a Veryfront project. It contains pages,
API routes, data loading, static content, and runtime configuration.

The app is the entry point for browsers and HTTP clients. It decides which route
handles a request, which data is loaded, which UI is rendered, and which runtime
capability is invoked.

## Characteristics

- Routes turn URLs into pages or API handlers.
- Data loading prepares the information a page needs.
- Rendering turns React and MDX into the response sent to the client.
- API routes expose HTTP entry points for clients, webhooks, and app backends.

## Boundary

An app route can call an agent, tool, workflow, task, run, integration, or
sandbox. The app still owns the request and response boundary. The primitive it
calls owns the work behind that boundary.

This separation keeps routes readable. The route explains how the user or HTTP
client enters the system. The primitive explains what capability runs.

## Wrong fit

Do not put long-running work, model reasoning, tool execution policy, or
scheduled logic directly in a route. Use the route to start that work and let the
right primitive own it.

For implementation steps, see [Pages and routing](../guides/pages-and-routing.md)
and [API routes](../guides/api-routes.md).
