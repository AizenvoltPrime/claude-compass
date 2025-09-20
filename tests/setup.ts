import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Mock @xenova/transformers to avoid ES module issues in Jest
jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn().mockImplementation((task: string, model: string) => {
    // Return a mock pipeline function that acts as a callable model
    const mockModel = jest.fn().mockImplementation((text: string, options?: any) => {
      // Return a mock embedding array of 384 dimensions
      return Promise.resolve({
        data: new Float32Array(384).fill(0.1) // Use small non-zero values for testing
      });
    });
    return Promise.resolve(mockModel);
  })
}));

// Increase test timeout for database operations
jest.setTimeout(30000);

// Mock console.log in tests to reduce noise
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});