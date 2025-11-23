# Test Examples

This directory contains example test files demonstrating best practices for writing tests in Veryfront.

## Available Examples

### `unit-test.example.ts`
Demonstrates unit testing patterns:
- Testing pure functions
- Testing classes with state
- Async operations
- Error handling
- Using test fixtures
- Performance budgets

### `integration-server.example.ts`
Demonstrates integration testing with servers:
- Using TestContext for server tests
- Testing dev and production servers
- Environment variable management
- Concurrent request testing
- Error scenario testing
- Custom cleanup handlers

## Usage

These files are **not** executed in the test suite. They serve as:

1. **Learning Resources**: Study these examples to understand testing patterns
2. **Copy-Paste Templates**: Start new tests by copying these examples
3. **Reference Documentation**: Quick lookup for common testing patterns

## Running Examples

If you want to test the examples themselves:

```bash
# Run unit test examples
deno test tests/_examples/unit-test.example.ts --allow-all

# Run integration test examples
deno test tests/_examples/integration-server.example.ts --allow-all
```

## When to Use Each Example

| Scenario | Use This Example |
|----------|------------------|
| Testing utility functions | `unit-test.example.ts` |
| Testing classes/modules | `unit-test.example.ts` |
| Testing with dev server | `integration-server.example.ts` |
| Testing with production server | `integration-server.example.ts` |
| Testing API endpoints | `integration-server.example.ts` |
| Testing with environment variables | `integration-server.example.ts` |

## Quick Start: Copy Template

```bash
# Copy unit test template
cp tests/_examples/unit-test.example.ts src/my-module/my-function.test.ts

# Copy integration test template
cp tests/_examples/integration-server.example.ts tests/integration/my-feature/my-test.test.ts
```

## Key Principles Demonstrated

### 1. Test Structure
- ✅ Use `describe` for grouping related tests
- ✅ Use `it` for individual test cases
- ✅ Follow Arrange-Act-Assert pattern

### 2. Test Naming
- ✅ Descriptive names: "should do X when Y"
- ✅ Clear expectations in the name
- ✅ Avoid vague names like "test1" or "works"

### 3. Assertions
- ✅ Include assertion messages
- ✅ Test both happy paths and edge cases
- ✅ Use appropriate assertion functions

### 4. Resource Management
- ✅ Use `withTestContext` for server tests
- ✅ Automatic cleanup (no manual cleanup needed)
- ✅ Isolated environments per test

### 5. Timeouts
- ✅ Set appropriate timeouts using `TEST_TIMEOUTS`
- ✅ Unit tests: 5s
- ✅ Integration tests: 30s
- ✅ E2E tests: 60s

### 6. Performance
- ✅ Set performance budgets
- ✅ Measure execution time
- ✅ Fail tests that exceed budgets

## Related Documentation

- [Test Style Guide](../README.md) - Comprehensive testing guidelines
- [TestContext API](../_helpers/context.ts) - Server test utilities
- [Test Constants](../_helpers/constants.ts) - Timeout and configuration values

## Contributing Examples

To add a new example:

1. Create a new `.example.ts` file in this directory
2. Include comprehensive comments explaining each pattern
3. Add a checklist of best practices at the end
4. Update this README with the new example
5. Ensure the example can run standalone

## Questions?

If these examples don't cover your use case, check:
- [Test Style Guide](../README.md) for detailed guidelines
- [Existing Tests](../integration/) for real-world examples
- The team for guidance on complex scenarios
