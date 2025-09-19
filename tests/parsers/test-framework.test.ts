import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { TestFrameworkParser } from '../../src/parsers/test-framework';
import { SymbolType, DependencyType, TestFrameworkType } from '../../src/database/models';

describe('TestFrameworkParser', () => {
  let parser: TestFrameworkParser;

  beforeEach(() => {
    parser = new TestFrameworkParser();
  });

  describe('getSupportedExtensions', () => {
    it('should return correct test file extensions', () => {
      const extensions = parser.getSupportedExtensions();
      expect(extensions).toEqual([
        '.test.js', '.test.ts', '.spec.js', '.spec.ts',
        '.test.jsx', '.test.tsx', '.spec.jsx', '.spec.tsx',
        '.e2e.js', '.e2e.ts'
      ]);
    });
  });

  describe('getFrameworkPatterns', () => {
    it('should return test framework patterns', () => {
      const patterns = parser.getFrameworkPatterns();
      expect(patterns).toHaveLength(4);
      expect(patterns[0].name).toBe('jest-test');
      expect(patterns[1].name).toBe('vitest-test');
      expect(patterns[2].name).toBe('cypress-test');
      expect(patterns[3].name).toBe('playwright-test');
    });
  });

  describe('parseFile', () => {
    it('should parse Jest test suite', async () => {
      const content = `
        describe('Calculator', () => {
          it('should add two numbers', () => {
            expect(add(2, 3)).toBe(5);
          });

          it('should multiply numbers', () => {
            expect(multiply(4, 5)).toBe(20);
          });

          beforeEach(() => {
            jest.clearAllMocks();
          });
        });
      `;

      const result = await parser.parseFile('calculator.test.js', content);

      expect(result.symbols).toHaveLength(4); // file test suite + describe + 2 it
      expect(result.symbols[1]).toMatchObject({
        name: 'Calculator',
        symbol_type: SymbolType.TEST_CASE,
        is_exported: false,
      });

      expect(result.dependencies.length).toBeGreaterThan(0);
      const expectCall = result.dependencies.find(d => d.to_symbol === 'expect');
      expect(expectCall).toBeDefined();
      expect(expectCall).toMatchObject({
        dependency_type: DependencyType.CALLS,
      });
    });

    it('should parse Vitest test suite', async () => {
      const content = `
        import { describe, it, expect, beforeEach } from 'vitest';

        describe('User service', () => {
          beforeEach(() => {
            vi.clearAllMocks();
          });

          it('should create user', async () => {
            const user = await createUser({ name: 'John' });
            expect(user.id).toBeDefined();
          });
        });
      `;

      const result = await parser.parseFile('user.test.ts', content);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]).toMatchObject({
        source: 'vitest',
        imported_names: ['*'],
        import_type: 'named',
      });

      expect(result.symbols.length).toBeGreaterThan(2);
      const userServiceSuite = result.symbols.find(s => s.name === 'User service');
      expect(userServiceSuite).toBeDefined();
      expect(userServiceSuite).toMatchObject({
        symbol_type: SymbolType.TEST_CASE,
      });
    });

    it('should parse Cypress test', async () => {
      const content = `
        describe('Home Page', () => {
          beforeEach(() => {
            cy.visit('/');
          });

          it('should display welcome message', () => {
            cy.get('[data-testid="welcome"]').should('contain', 'Welcome');
            cy.get('.header').should('be.visible');
          });

          it('should navigate to about page', () => {
            cy.get('a[href="/about"]').click();
            cy.url().should('include', '/about');
          });
        });
      `;

      const result = await parser.parseFile('home.e2e.js', content);

      expect(result.symbols.length).toBeGreaterThan(2);
      expect(result.dependencies.length).toBeGreaterThan(0);
      const cyCall = result.dependencies.find(d => d.to_symbol === 'cy.visit' || d.to_symbol === 'cy.get');
      expect(cyCall).toBeDefined();
      expect(cyCall).toMatchObject({
        dependency_type: DependencyType.CALLS,
      });
    });

    it('should parse Playwright test', async () => {
      const content = `
        import { test, expect } from '@playwright/test';

        test.describe('Authentication', () => {
          test('should login successfully', async ({ page }) => {
            await page.goto('/login');
            await page.fill('#username', 'testuser');
            await page.fill('#password', 'password');
            await page.click('#login-button');

            await expect(page.locator('.dashboard')).toBeVisible();
          });

          test('should show error for invalid credentials', async ({ page }) => {
            await page.goto('/login');
            await page.fill('#username', 'invalid');
            await page.fill('#password', 'wrong');
            await page.click('#login-button');

            await expect(page.locator('.error')).toContainText('Invalid credentials');
          });
        });
      `;

      const result = await parser.parseFile('auth.spec.ts', content);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]).toMatchObject({
        source: '@playwright/test',
        import_type: 'named',
      });

      expect(result.symbols.length).toBeGreaterThan(2); // Should have multiple test symbols
    });

    it('should detect test framework types', async () => {
      const jestContent = `
        import { jest } from '@jest/globals';
        test('jest test', () => {});
      `;

      const result = await parser.parseFile('jest.test.js', jestContent);
      const detectedFrameworks = parser.getDetectedFrameworks();

      expect(detectedFrameworks).toContain(TestFrameworkType.JEST);
    });

    it('should handle mocks and spies', async () => {
      const content = `
        import { vi } from 'vitest';

        const mockFetch = vi.fn();
        vi.mock('node-fetch', () => ({ default: mockFetch }));

        describe('API tests', () => {
          beforeEach(() => {
            mockFetch.mockReset();
          });

          it('should call fetch', () => {
            const spy = vi.spyOn(console, 'log');
            // test code
            expect(spy).toHaveBeenCalled();
          });
        });
      `;

      const result = await parser.parseFile('api.test.ts', content);

      expect(result.symbols.length).toBeGreaterThan(2);
      expect(result.dependencies.length).toBeGreaterThan(0);
      const mockCall = result.dependencies.find(d => d.to_symbol === 'vi.fn' || d.to_symbol === 'vi.mock');
      expect(mockCall).toBeDefined();
    });

    it('should handle test setup and teardown', async () => {
      const content = `
        describe('Database tests', () => {
          beforeAll(async () => {
            await setupDatabase();
          });

          afterAll(async () => {
            await teardownDatabase();
          });

          beforeEach(() => {
            clearTestData();
          });

          afterEach(() => {
            cleanupTestData();
          });

          test('should save data', () => {
            // test implementation
          });
        });
      `;

      const result = await parser.parseFile('database.test.js', content);

      expect(result.symbols.length).toBeGreaterThan(2);
      expect(result.dependencies.length).toBeGreaterThan(0);
      const setupCall = result.dependencies.find(d => d.to_symbol === 'beforeAll' || d.to_symbol === 'setupDatabase');
      expect(setupCall).toBeDefined();
    });

    it('should handle nested test suites', async () => {
      const content = `
        describe('User Management', () => {
          describe('User Creation', () => {
            it('should create user with valid data', () => {
              expect(true).toBe(true);
            });

            it('should reject invalid data', () => {
              expect(false).toBe(false);
            });
          });

          describe('User Deletion', () => {
            it('should delete existing user', () => {
              expect(1).toBe(1);
            });
          });
        });
      `;

      const result = await parser.parseFile('user-management.test.js', content);

      expect(result.symbols).toHaveLength(7); // file test suite + 3 describe + 3 it
      expect(result.symbols[1]).toMatchObject({
        name: 'User Management',
        symbol_type: SymbolType.TEST_CASE,
      });
    });

    it('should parse empty test file', async () => {
      const content = '';
      const result = await parser.parseFile('empty.test.js', content);

      expect(result.symbols).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
      expect(result.errors).toHaveLength(0); // Empty content should parse successfully
    });
  });

  describe('detectFrameworkEntities', () => {
    it('should detect test framework system', async () => {
      const content = `
        import { describe, it, expect } from 'vitest';
        describe('Test suite', () => {
          it('test case', () => {});
        });
      `;

      const result = await parser.detectFrameworkEntities(content, 'test.spec.ts', {});

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject({
        type: 'test_suite',
        name: 'test.spec',
        filePath: 'test.spec.ts',
      });
    });
  });
});