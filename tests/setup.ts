import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Mock @xenova/transformers to avoid ES module issues in Jest
jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn().mockImplementation((_task: string, _model: string) => {
    const mockModel = jest.fn().mockImplementation((_text: string, _options?: any) => {
      return Promise.resolve({
        data: new Float32Array(384).fill(0.1)
      });
    });
    return Promise.resolve(mockModel);
  }),
  AutoTokenizer: {
    from_pretrained: jest.fn().mockImplementation((_modelName?: string, _options?: any) => {
      const mockTokenizer: any = jest.fn().mockImplementation((text: string | string[], _opts?: any) => {
        const texts = Array.isArray(text) ? text : [text];
        const seqLength = 128;
        const batchSize = texts.length;

        return Promise.resolve({
          input_ids: {
            data: new BigInt64Array(batchSize * seqLength).fill(BigInt(1)),
            dims: [batchSize, seqLength]
          },
          attention_mask: {
            data: new BigInt64Array(batchSize * seqLength).fill(BigInt(1)),
            dims: [batchSize, seqLength]
          }
        });
      });

      mockTokenizer.encode = jest.fn().mockReturnValue([1, 2, 3]);
      mockTokenizer.decode = jest.fn().mockReturnValue('test');

      return Promise.resolve(mockTokenizer);
    })
  },
  env: {
    cacheDir: '',
    allowLocalModels: true,
    allowRemoteModels: true,
  }
}));

// Mock onnxruntime-node for embedding service
jest.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: jest.fn().mockImplementation((_modelPath: string, _options?: any) => {
      return Promise.resolve({
        run: jest.fn().mockImplementation((_feeds: any) => {
          const hiddenSize = 1024;
          const seqLength = 128;
          const batchSize = 1;

          const mockTensor = {
            data: new Float32Array(batchSize * seqLength * hiddenSize).fill(0.1),
            dims: [batchSize, seqLength, hiddenSize],
            type: 'float32',
            size: batchSize * seqLength * hiddenSize,
            dispose: jest.fn()
          };

          return Promise.resolve({
            last_hidden_state: mockTensor
          });
        }),
        release: jest.fn()
      });
    })
  },
  Tensor: jest.fn().mockImplementation((type: string, data: any, dims: number[]) => ({
    data,
    dims,
    type,
    size: data.length,
    dispose: jest.fn()
  })),
  listSupportedBackends: jest.fn().mockReturnValue([
    { name: 'cpu' }
  ])
}));

// Mock p-limit to avoid ES module issues in Jest
jest.mock('p-limit', () => {
  return jest.fn().mockImplementation((_concurrency: number) => {
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