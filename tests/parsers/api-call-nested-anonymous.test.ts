import { ApiCallExtractor, ExtractedApiCall } from '../../src/parsers/utils/api-call-extractor';

describe('ApiCallExtractor - Nested Anonymous Functions Fix', () => {
  let extractor: ApiCallExtractor;

  beforeEach(() => {
    extractor = new ApiCallExtractor();
  });

  it('should find parent function name for API call in anonymous arrow function', () => {
    const code = `
      const validateUsernameUnique = async (username: string) => {
        return await debounceAsync(
          async () => {
            try {
              const response = await axios.get('/api/admin/users/check-username');
              return response.data.available;
            } catch (error) {
              return { isValid: true };
            }
          }
        );
      };
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/file.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('validateUsernameUnique');
    expect(apiCalls[0].url).toBe('/api/admin/users/check-username');
    expect(apiCalls[0].method).toBe('GET');
  });

  it('should find parent function name for API call in nested async callbacks', () => {
    const code = `
      const validateEmailUnique = async (email: string) => {
        return await debounceAsync(
          async () => {
            const response = await axios.get('/api/admin/users/check-email', {
              params: { email }
            });
            return response.data;
          }
        );
      };
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/file.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('validateEmailUnique');
    expect(apiCalls[0].url).toBe('/api/admin/users/check-email');
  });

  it('should handle multiple levels of nesting (3 deep)', () => {
    const code = `
      const fetchUserData = async () => {
        setTimeout(() => {
          Promise.resolve().then(async () => {
            const result = await axios.get('/api/user/profile');
            console.log(result);
          });
        }, 100);
      };
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/file.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('fetchUserData');
    expect(apiCalls[0].url).toBe('/api/user/profile');
  });

  it('should handle multiple levels of nesting (wrapper pattern)', () => {
    const code = `
      const processData = async () => {
        return withLoading(() => {
          return withAuth(async () => {
            const data = await axios.post('/api/deep/endpoint');
            return data;
          });
        });
      };
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/file.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('processData');
    expect(apiCalls[0].url).toBe('/api/deep/endpoint');
    expect(apiCalls[0].method).toBe('POST');
  });

  it('should still return "anonymous" if entire chain has no names', () => {
    const code = `
      (() => {
        (() => {
          (async () => {
            await axios.get('/api/truly/anonymous');
          })();
        })();
      })();
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/file.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('anonymous');
  });

  it('should find immediate function name if it exists (baseline check)', () => {
    const code = `
      async function namedFunction() {
        const response = await axios.get('/api/endpoint');
        return response.data;
      }
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/file.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('namedFunction');
  });

  it('should handle Vue composable pattern with anonymous callbacks', () => {
    const code = `
      export const useUserValidation = () => {
        const checkUsername = async (username: string) => {
          return debounce(async () => {
            const { data } = await axios.get('/api/validate/username', {
              params: { username }
            });
            return data.isValid;
          }, 300)();
        };

        return { checkUsername };
      };
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/composable.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('checkUsername');
    expect(apiCalls[0].url).toBe('/api/validate/username');
  });

  it('should handle React hooks pattern with anonymous callbacks', () => {
    const code = `
      const useFormValidation = () => {
        const validateField = useCallback(
          async (fieldName: string, value: string) => {
            return throttle(async () => {
              const response = await axios.post('/api/validate/field', {
                field: fieldName,
                value: value
              });
              return response.data;
            }, 500)();
          },
          []
        );

        return { validateField };
      };
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/hook.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('useFormValidation');
    expect(apiCalls[0].url).toBe('/api/validate/field');
    expect(apiCalls[0].method).toBe('POST');
  });

  it('should handle deeply nested wrapper functions (non-IIFE)', () => {
    const code = `
      const submitForm = async (data: any) => {
        return withRetry(
          () => withTimeout(
            async () => {
              const result = await axios.post('/api/submit', data);
              return result;
            },
            5000
          ),
          3
        );
      };
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/submit.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('submitForm');
    expect(apiCalls[0].url).toBe('/api/submit');
  });

  it('should handle method definition with anonymous callback', () => {
    const code = `
      class UserService {
        async validateUser(userId: number) {
          return new Promise((resolve) => {
            setTimeout(async () => {
              const response = await axios.get(\`/api/users/\${userId}/validate\`);
              resolve(response.data);
            }, 100);
          });
        }
      }
    `;

    const apiCalls = extractor.extractFromContent(code, '/test/service.ts', 'typescript');

    expect(apiCalls.length).toBe(1);
    expect(apiCalls[0].callerName).toBe('validateUser');
  });
});
