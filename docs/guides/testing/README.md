---
title: Testing Guides
description: Test your Veryfront application with unit and end-to-end tests
category: guides
keywords: [testing, unit tests, e2e, integration, vitest, playwright, quality]
---

# Testing Guides

Comprehensive guides for testing your Veryfront applications. Learn how to write effective tests to ensure code quality and reliability.

## Available Guides

### [Unit Testing](./unit.md)
Write unit tests for your components and functions. Learn about:
- Setting up Vitest or other test frameworks
- Testing React components
- Testing server-side code
- Mocking dependencies and APIs
- Test coverage and best practices
- Snapshot testing

### [End-to-End Testing](./e2e.md)
Write E2E tests for complete user flows. Learn about:
- Setting up Playwright or Cypress
- Testing user interactions
- Testing navigation and routing
- Testing forms and data submission
- Visual regression testing
- CI/CD integration for E2E tests

## Prerequisites

Before writing tests, ensure you have:
- [Veryfront installed](/learn/installation.md) - Development environment set up
- [Application built](/learn/quickstart.md) - Working Veryfront application
- **Test framework** - Vitest or preferred testing framework installed
- **E2E framework** - Playwright or Cypress installed (for E2E tests)

## Testing Guides

### Test Types
- [Unit Testing](./unit.md) - Test components and functions
- [End-to-End Testing](./e2e.md) - Test complete user flows

## Related Guides

### Testing Different Features

#### Routing & Navigation
- [Routing System](/guides/routing/README.md) - Test routing behavior
- [App Router](/guides/routing/app-router.md) - Test nested layouts
- [Dynamic Routes](/guides/routing/dynamic-routes.md) - Test parameterized routes
- [API Routes](/guides/routing/api-routes.md) - Test API endpoints

#### Rendering Modes
- [Rendering Overview](/guides/rendering/README.md) - Test rendering strategies
- [SSR Guide](/guides/rendering/ssr.md) - Test server-side rendering
- [SSG Guide](/guides/rendering/ssg.md) - Test static generation

#### Components
- [Component Guides](/guides/components/README.md) - Test built-in components
- [Link Component](/guides/components/link.md) - Test navigation
- [Head Component](/guides/components/head.md) - Test metadata

### Deployment & CI/CD
- [Deployment Overview](/guides/deployment/README.md) - Run tests in CI/CD
- [Deno Deployment](/guides/deployment/deno.md) - Deno Deploy testing
- [Node.js Deployment](/guides/deployment/node.md) - Node.js testing

## Reference

### Configuration
- [Configuration Reference](/reference/configuration/README.md) - Test configuration
- [File Conventions](/reference/file-conventions/README.md) - Test file structure

## Testing Best Practices

### Unit Testing
1. Test components in isolation
2. Mock external dependencies
3. Aim for high code coverage (80%+)
4. Test edge cases and error states
5. Keep tests fast and focused

### E2E Testing
1. Test critical user journeys
2. Test on multiple browsers
3. Use page object pattern
4. Avoid flaky tests
5. Run in CI/CD pipeline

## Next Steps

1. Set up testing framework with [Unit Testing Guide](./unit.md)
2. Write tests for critical components
3. Add E2E tests with [E2E Testing Guide](./e2e.md)
4. Integrate tests into [CI/CD pipeline](/guides/deployment/README.md)
5. Monitor test coverage and quality

## Troubleshooting

Having testing issues? Check:
- [Debugging Guide](/guides/troubleshooting/debugging.md) - Debug test failures
- [Troubleshooting](/guides/troubleshooting/README.md) - Common testing issues
