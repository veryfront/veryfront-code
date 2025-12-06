---
title: End-to-End Testing
description: Comprehensive guide to E2E testing Veryfront applications with Playwright and Cypress for real-world user scenarios
---

# End-to-End Testing

Learn how to write comprehensive end-to-end tests for your Veryfront application using Playwright or Cypress to ensure your application works correctly from a user's perspective.

## Overview

End-to-end (E2E) testing validates complete user workflows by simulating real user interactions with your application. E2E tests run against your full application stack, including UI, API, and database.

### Key Topics

- Playwright setup and configuration
- Cypress setup and configuration
- Testing user flows and journeys
- API mocking and network control
- Visual regression testing
- CI/CD integration
- Best practices and patterns

## Choosing a Testing Framework

### Playwright

**Strengths:**
- Multi-browser support (Chromium, Firefox, WebKit)
- Fast and reliable
- Built-in parallelization
- Excellent TypeScript support
- Auto-waiting for elements

**Best for:** Teams needing cross-browser testing and modern features.

### Cypress

**Strengths:**
- Excellent developer experience
- Time-travel debugging
- Real-time test runner
- Rich ecosystem of plugins
- Great documentation

**Best for:** Teams prioritizing developer experience and debugging capabilities.

## Playwright Setup

### Installation

```bash
npm install -D @playwright/test
npx playwright install
```

### Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewports
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Package Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:report": "playwright show-report"
  }
}
```

## Playwright Testing

### Basic Page Navigation

```typescript
// e2e/homepage.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('loads and displays content', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/Welcome/);

    // Check heading
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();

    // Check navigation
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('has working navigation links', async ({ page }) => {
    await page.goto('/');

    // Click "About" link
    await page.getByRole('link', { name: 'About' }).click();

    // Verify navigation
    await expect(page).toHaveURL('/about');
    await expect(page.getByRole('heading', { name: 'About Us' })).toBeVisible();
  });
});
```

### Form Testing

```typescript
// e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('displays login form', async ({ page }) => {
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('shows validation errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('Password is required')).toBeVisible();
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    // Fill form
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('password123');

    // Submit
    await page.getByRole('button', { name: 'Log in' }).click();

    // Wait for redirect
    await page.waitForURL('/dashboard');

    // Verify dashboard content
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Welcome, user@example.com')).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.getByLabel('Email').fill('wrong@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('alert')).toContainText('Invalid credentials');
  });
});
```

### Testing User Flows

```typescript
// e2e/checkout.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Checkout Flow', () => {
  test('complete purchase flow', async ({ page }) => {
    // Step 1: Browse products
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

    // Step 2: Add to cart
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    await expect(page.getByText('Added to cart')).toBeVisible();

    // Step 3: View cart
    await page.getByRole('link', { name: 'Cart (1)' }).click();
    await expect(page).toHaveURL('/cart');
    await expect(page.getByRole('heading', { name: 'Shopping Cart' })).toBeVisible();

    // Step 4: Proceed to checkout
    await page.getByRole('button', { name: 'Checkout' }).click();
    await expect(page).toHaveURL('/checkout');

    // Step 5: Fill shipping information
    await page.getByLabel('Full Name').fill('John Doe');
    await page.getByLabel('Address').fill('123 Main St');
    await page.getByLabel('City').fill('San Francisco');
    await page.getByLabel('ZIP Code').fill('94102');

    // Step 6: Fill payment information
    await page.getByLabel('Card Number').fill('4242424242424242');
    await page.getByLabel('Expiry Date').fill('12/25');
    await page.getByLabel('CVC').fill('123');

    // Step 7: Submit order
    await page.getByRole('button', { name: 'Place Order' }).click();

    // Step 8: Verify success
    await expect(page).toHaveURL(/\/order\/[a-z0-9-]+/);
    await expect(page.getByText('Order Confirmed')).toBeVisible();
    await expect(page.getByText('Thank you for your purchase')).toBeVisible();
  });
});
```

### API Mocking

```typescript
// e2e/api-mocking.spec.ts
import { test, expect } from '@playwright/test';

test.describe('API Mocking', () => {
  test('mocks API response', async ({ page }) => {
    // Mock API endpoint
    await page.route('/api/users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, name: 'John Doe' },
          { id: 2, name: 'Jane Smith' },
        ]),
      });
    });

    await page.goto('/users');

    // Verify mocked data is displayed
    await expect(page.getByText('John Doe')).toBeVisible();
    await expect(page.getByText('Jane Smith')).toBeVisible();
  });

  test('mocks API error', async ({ page }) => {
    // Mock API failure
    await page.route('/api/posts', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    await page.goto('/posts');

    // Verify error message
    await expect(page.getByRole('alert')).toContainText('Failed to load posts');
  });

  test('delays API response', async ({ page }) => {
    // Mock slow API
    await page.route('/api/data', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ data: 'Slow response' }),
      });
    });

    await page.goto('/data');

    // Verify loading state
    await expect(page.getByText('Loading...')).toBeVisible();

    // Wait for data
    await expect(page.getByText('Slow response')).toBeVisible({ timeout: 5000 });
  });
});
```

### Authentication State

```typescript
// e2e/auth.setup.ts
import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Log in' }).click();

  await page.waitForURL('/dashboard');

  // Save authentication state
  await page.context().storageState({ path: authFile });
});
```

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

```typescript
// e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('displays user dashboard', async ({ page }) => {
    // Already authenticated via setup
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Welcome back')).toBeVisible();
  });
});
```

## Cypress Setup

### Installation

```bash
npm install -D cypress
npx cypress open
```

### Configuration

```typescript
// cypress.config.ts
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    video: true,
    screenshotOnRunFailure: true,
    viewportWidth: 1280,
    viewportHeight: 720,

    setupNodeEvents(on, config) {
      // Implement node event listeners here
    },
  },
});
```

### Support File

```typescript
// cypress/support/e2e.ts
import './commands';

// Hide fetch/XHR requests in command log
const app = window.top;
if (app && !app.document.head.querySelector('[data-hide-command-log-request]')) {
  const style = app.document.createElement('style');
  style.innerHTML = '.command-name-request, .command-name-xhr { display: none }';
  style.setAttribute('data-hide-command-log-request', '');
  app.document.head.appendChild(style);
}
```

### Custom Commands

```typescript
// cypress/support/commands.ts
declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
      logout(): Chainable<void>;
      getBySel(selector: string): Chainable<JQuery<HTMLElement>>;
    }
  }
}

Cypress.Commands.add('login', (email: string, password: string) => {
  cy.visit('/login');
  cy.get('input[name="email"]').type(email);
  cy.get('input[name="password"]').type(password);
  cy.get('button[type="submit"]').click();
  cy.url().should('include', '/dashboard');
});

Cypress.Commands.add('logout', () => {
  cy.get('[data-testid="user-menu"]').click();
  cy.get('[data-testid="logout-button"]').click();
  cy.url().should('eq', Cypress.config().baseUrl + '/');
});

Cypress.Commands.add('getBySel', (selector: string) => {
  return cy.get(`[data-testid="${selector}"]`);
});
```

### Package Scripts

```json
{
  "scripts": {
    "cypress:open": "cypress open",
    "cypress:run": "cypress run",
    "cypress:run:chrome": "cypress run --browser chrome",
    "cypress:run:firefox": "cypress run --browser firefox"
  }
}
```

## Cypress Testing

### Basic Tests

```typescript
// cypress/e2e/homepage.cy.ts
describe('Homepage', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('displays welcome message', () => {
    cy.contains('h1', 'Welcome').should('be.visible');
  });

  it('navigates to about page', () => {
    cy.contains('a', 'About').click();
    cy.url().should('include', '/about');
    cy.contains('h1', 'About Us').should('be.visible');
  });
});
```

### Form Testing

```typescript
// cypress/e2e/contact.cy.ts
describe('Contact Form', () => {
  beforeEach(() => {
    cy.visit('/contact');
  });

  it('submits form successfully', () => {
    cy.get('input[name="name"]').type('John Doe');
    cy.get('input[name="email"]').type('john@example.com');
    cy.get('textarea[name="message"]').type('Hello, this is a test message.');

    cy.get('button[type="submit"]').click();

    cy.contains('Thank you for your message').should('be.visible');
  });

  it('shows validation errors', () => {
    cy.get('button[type="submit"]').click();

    cy.contains('Name is required').should('be.visible');
    cy.contains('Email is required').should('be.visible');
    cy.contains('Message is required').should('be.visible');
  });
});
```

### API Mocking with Cypress

```typescript
// cypress/e2e/users.cy.ts
describe('Users List', () => {
  beforeEach(() => {
    // Mock API response
    cy.intercept('GET', '/api/users', {
      statusCode: 200,
      body: [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
      ],
    }).as('getUsers');

    cy.visit('/users');
  });

  it('displays user list', () => {
    cy.wait('@getUsers');

    cy.contains('John Doe').should('be.visible');
    cy.contains('jane@example.com').should('be.visible');
  });

  it('handles API errors', () => {
    cy.intercept('GET', '/api/users', {
      statusCode: 500,
      body: { error: 'Internal Server Error' },
    }).as('getUsersError');

    cy.reload();
    cy.wait('@getUsersError');

    cy.contains('Failed to load users').should('be.visible');
  });
});
```

### Authentication

```typescript
// cypress/e2e/auth.cy.ts
describe('Authentication', () => {
  it('logs in successfully', () => {
    cy.login('user@example.com', 'password123');
    cy.contains('Welcome back').should('be.visible');
  });

  it('logs out successfully', () => {
    cy.login('user@example.com', 'password123');
    cy.logout();
    cy.url().should('eq', Cypress.config().baseUrl + '/');
  });

  it('persists authentication', () => {
    cy.login('user@example.com', 'password123');
    cy.visit('/profile');
    cy.contains('Profile').should('be.visible');
  });
});
```

## Visual Regression Testing

### Playwright Visual Comparisons

```typescript
// e2e/visual.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('homepage matches snapshot', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveScreenshot('homepage.png');
  });

  test('product card matches snapshot', async ({ page }) => {
    await page.goto('/products');
    const card = page.locator('.product-card').first();
    await expect(card).toHaveScreenshot('product-card.png');
  });

  test('mobile viewport matches snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page).toHaveScreenshot('homepage-mobile.png');
  });
});
```

### Cypress Visual Testing

```bash
npm install -D @percy/cypress
```

```typescript
// cypress/support/e2e.ts
import '@percy/cypress';
```

```typescript
// cypress/e2e/visual.cy.ts
describe('Visual Regression', () => {
  it('captures homepage', () => {
    cy.visit('/');
    cy.percySnapshot('Homepage');
  });

  it('captures product page', () => {
    cy.visit('/products/1');
    cy.percySnapshot('Product Page');
  });
});
```

## Testing Best Practices

### 1. Use Data Attributes for Selectors

```tsx
// ❌ Fragile - Breaks with styling changes
cy.get('.submit-btn-primary');

// ✅ Stable - Semantic test selector
cy.get('[data-testid="submit-button"]');
```

```tsx
// Component with test ID
export function SubmitButton() {
  return (
    <button
      data-testid="submit-button"
      className="btn-primary"
      type="submit"
    >
      Submit
    </button>
  );
}
```

### 2. Avoid Hard-Coded Waits

```typescript
// ❌ Bad - Arbitrary wait
cy.wait(5000);

// ✅ Good - Wait for specific condition
cy.get('[data-testid="loading"]').should('not.exist');
cy.get('[data-testid="content"]').should('be.visible');
```

### 3. Test User Flows, Not Implementation

```typescript
// ❌ Bad - Testing implementation details
test('increments state variable', async ({ page }) => {
  // Testing internal state
});

// ✅ Good - Testing user-visible behavior
test('displays incremented count', async ({ page }) => {
  await page.goto('/counter');
  await page.getByRole('button', { name: 'Increment' }).click();
  await expect(page.getByText('Count: 1')).toBeVisible();
});
```

### 4. Keep Tests Independent

```typescript
// ❌ Bad - Tests depend on each other
test('creates user', async ({ page }) => {
  // Create user
});

test('updates user', async ({ page }) => {
  // Assumes user exists from previous test
});

// ✅ Good - Each test is independent
test('creates user', async ({ page }) => {
  // Create and test user
});

test('updates user', async ({ page }) => {
  // Create user, then update
});
```

### 5. Use Page Object Model

```typescript
// e2e/pages/LoginPage.ts
import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByRole('button', { name: 'Log in' });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

```typescript
// e2e/login.spec.ts
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

test('successful login', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('user@example.com', 'password123');

  await expect(page).toHaveURL('/dashboard');
});
```

## CI/CD Integration

### GitHub Actions with Playwright

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    timeout-minutes: 60
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Browsers
        run: npx playwright install --with-deps

      - name: Build application
        run: npm run build

      - name: Run Playwright tests
        run: npm run test:e2e

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

### GitHub Actions with Cypress

```yaml
# .github/workflows/cypress.yml
name: Cypress Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Cypress run
        uses: cypress-io/github-action@v6
        with:
          build: npm run build
          start: npm start
          wait-on: 'http://localhost:3000'
          wait-on-timeout: 120

      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: cypress-screenshots
          path: cypress/screenshots

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: cypress-videos
          path: cypress/videos
```

## Debugging

### Playwright Debugging

```bash
# Run tests in headed mode
npx playwright test --headed

# Run tests in debug mode
npx playwright test --debug

# Run tests with UI mode
npx playwright test --ui

# Run specific test
npx playwright test login.spec.ts --debug
```

### Cypress Debugging

```typescript
// Add debugger
it('debugs test', () => {
  cy.visit('/');
  cy.get('.selector').debug(); // Pause and inspect
  cy.pause(); // Pause execution
});
```

```bash
# Open Cypress Test Runner
npx cypress open

# Run tests with video
npx cypress run --video

# Run specific test
npx cypress run --spec "cypress/e2e/login.cy.ts"
```

## Performance Testing

### Measuring Page Load

```typescript
// e2e/performance.spec.ts
import { test, expect } from '@playwright/test';

test('homepage loads within 3 seconds', async ({ page }) => {
  const startTime = Date.now();

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000);
});
```

### Lighthouse Integration

```bash
npm install -D @playwright/test lighthouse
```

```typescript
// e2e/lighthouse.spec.ts
import { test } from '@playwright/test';
import { playAudit } from 'playwright-lighthouse';

test('lighthouse audit', async ({ page }) => {
  await page.goto('/');

  await playAudit({
    page,
    thresholds: {
      performance: 90,
      accessibility: 90,
      'best-practices': 90,
      seo: 90,
    },
    port: 9222,
  });
});
```

## Troubleshooting

### Common Issues

**Flaky tests:**
```typescript
// Use built-in retry logic
test('flaky test', async ({ page }) => {
  // Playwright auto-waits and retries
  await expect(page.getByText('Loading...')).toBeVisible();
});

// Or configure retry count
test.describe.configure({ retries: 2 });
```

**Timeout errors:**
```typescript
// Increase timeout for slow operations
test('slow test', async ({ page }) => {
  await page.goto('/', { timeout: 60000 });
}, { timeout: 90000 });
```

**Authentication issues:**
```typescript
// Reuse authentication state
test.use({ storageState: 'playwright/.auth/user.json' });
```

## Next Steps

- [Unit Testing](/guides/testing/unit.md) - Unit and integration testing
- [Performance](/guides/performance/optimization.md) - Optimize your app
- [Deployment](/guides/deployment/node.md) - Deploy to production

## Related

- [Component APIs](/reference/components/README.md) - Component reference
- [Hook APIs](/reference/hooks/README.md) - Hook reference
- [TypeScript](/guides/troubleshooting/README.md) - TypeScript configuration
