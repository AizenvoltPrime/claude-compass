import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Mock @xenova/transformers to avoid ES module issues in Jest
jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn().mockImplementation((task: string, model: string) => {
    const mockModel = jest.fn().mockImplementation((text: string, options?: any) => {
      return Promise.resolve({
        data: new Float32Array(384).fill(0.1)
      });
    });
    return Promise.resolve(mockModel);
  }),
  AutoTokenizer: {
    from_pretrained: jest.fn().mockImplementation((modelName: string, options?: any) => {
      return Promise.resolve({
        encode: jest.fn().mockReturnValue([1, 2, 3]),
        decode: jest.fn().mockReturnValue('test'),
      });
    })
  },
  env: {
    cacheDir: '',
    allowLocalModels: true,
    allowRemoteModels: true,
  }
}));

// Mock p-limit to avoid ES module issues in Jest
jest.mock('p-limit', () => {
  return jest.fn().mockImplementation((concurrency: number) => {
    return (fn: () => Promise<any>) => fn();
  });
});

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