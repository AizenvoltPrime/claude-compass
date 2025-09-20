import { CrossStackParser, ApiCallInfo, LaravelRoute_CrossStack, CrossStackRelationship } from '../../src/parsers/cross-stack';
import { ParseFileResult } from '../../src/parsers/base-framework';
import { DependencyType, SymbolType } from '../../src/database/models';
import { FrameworkEntityType, FrameworkEntity } from '../../src/parsers/base';
import { jest } from '@jest/globals';

describe('CrossStackParser', () => {
  let parser: CrossStackParser;

  beforeEach(() => {
    parser = new CrossStackParser(0.7); // 70% confidence threshold
  });

  describe('detectApiCallRelationships', () => {
    it('should detect API calls between Vue and Laravel', async () => {
      // Mock Vue parse results with API calls
      const vueResults: ParseFileResult[] = [
        {
          filePath: '/frontend/components/UserList.vue',
          symbols: [
            {
              name: 'UserList',
              symbol_type: SymbolType.COMPONENT,
              start_line: 1,
              end_line: 50,
              is_exported: true,
              signature: 'export default defineComponent()',
            }
          ],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.VUE_COMPONENT,
              name: 'UserList',
              filePath: '/frontend/components/UserList.vue',
              properties: {
                apiCalls: [
                  {
                    url: '/api/users',
                    method: 'GET',
                    requestType: undefined,
                    responseType: 'User[]',
                    location: { line: 15, column: 10 }
                  }
                ]
              }
            }
          ]
        }
      ];

      // Mock Laravel parse results with routes
      const laravelResults: ParseFileResult[] = [
        {
          filePath: '/backend/routes/api.php',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.LARAVEL_ROUTE,
              name: 'users.index',
              filePath: '/backend/routes/api.php',
              properties: {
                path: '/api/users',
                method: 'GET',
                controller: 'UserController@index',
                middleware: ['auth:api']
              }
            }
          ]
        }
      ];

      const relationships = await parser.detectApiCallRelationships(vueResults, laravelResults);

      expect(relationships).toHaveLength(1);
      expect(relationships[0].vueApiCall.url).toBe('/api/users');
      expect(relationships[0].laravelRoute.path).toBe('/api/users');
      expect(relationships[0].matchConfidence).toBeGreaterThan(0.7);
      expect(relationships[0].evidenceTypes).toContain('url_pattern_match');
      expect(relationships[0].evidenceTypes).toContain('http_method_match');
    });

    it('should handle edge cases in cross-stack detection', async () => {
      // Test dynamic URLs
      const vueResultsWithDynamicUrl: ParseFileResult[] = [
        {
          filePath: '/frontend/components/UserProfile.vue',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.VUE_COMPONENT,
              name: 'UserProfile',
              filePath: '/frontend/components/UserProfile.vue',
              properties: {
                apiCalls: [
                  {
                    url: '`/api/users/${userId}`',
                    method: 'GET',
                    requestType: undefined,
                    responseType: 'User',
                    location: { line: 20, column: 15 }
                  }
                ]
              }
            }
          ]
        }
      ];

      const laravelResultsWithParams: ParseFileResult[] = [
        {
          filePath: '/backend/routes/api.php',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.LARAVEL_ROUTE,
              name: 'users.show',
              filePath: '/backend/routes/api.php',
              properties: {
                path: '/api/users/{id}',
                method: 'GET',
                controller: 'UserController@show'
              }
            }
          ]
        }
      ];

      const relationships = await parser.detectApiCallRelationships(vueResultsWithDynamicUrl, laravelResultsWithParams);

      expect(relationships).toHaveLength(1);
      expect(relationships[0].matchConfidence).toBeGreaterThan(0.6); // Should still have reasonable confidence
      expect(relationships[0].evidenceTypes).toContain('pattern_match');
    });

    it('should handle missing schemas gracefully', async () => {
      const vueResultsNoSchema: ParseFileResult[] = [
        {
          filePath: '/frontend/components/SimpleComponent.vue',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.VUE_COMPONENT,
              name: 'SimpleComponent',
              filePath: '/frontend/components/SimpleComponent.vue',
              properties: {
                apiCalls: [
                  {
                    url: '/api/simple',
                    method: 'POST',
                    // No requestType or responseType
                    location: { line: 10, column: 5 }
                  }
                ]
              }
            }
          ]
        }
      ];

      const laravelResultsNoSchema: ParseFileResult[] = [
        {
          filePath: '/backend/routes/api.php',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.LARAVEL_ROUTE,
              name: 'simple.store',
              filePath: '/backend/routes/api.php',
              properties: {
                path: '/api/simple',
                method: 'POST',
                controller: 'SimpleController@store'
                // No validation rules or response schema
              }
            }
          ]
        }
      ];

      const relationships = await parser.detectApiCallRelationships(vueResultsNoSchema, laravelResultsNoSchema);

      expect(relationships).toHaveLength(1);
      expect(relationships[0].schemaCompatibility).toBeUndefined(); // Should handle missing schema
      expect(relationships[0].matchConfidence).toBeGreaterThan(0.5); // Lower confidence without schema
    });

    it('should handle ambiguous matches with confidence scoring', async () => {
      const vueResultsAmbiguous: ParseFileResult[] = [
        {
          filePath: '/frontend/components/GenericList.vue',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.VUE_COMPONENT,
              name: 'GenericList',
              filePath: '/frontend/components/GenericList.vue',
              properties: {
                apiCalls: [
                  {
                    url: '/api/data',
                    method: 'GET',
                    location: { line: 5, column: 10 }
                  }
                ]
              }
            }
          ]
        }
      ];

      const laravelResultsMultipleMatches: ParseFileResult[] = [
        {
          filePath: '/backend/routes/api.php',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.LARAVEL_ROUTE,
              name: 'data.users',
              filePath: '/backend/routes/api.php',
              properties: {
                path: '/api/data/users',
                method: 'GET',
                controller: 'DataController@users'
              }
            },
            {
              type: FrameworkEntityType.LARAVEL_ROUTE,
              name: 'data.products',
              filePath: '/backend/routes/api.php',
              properties: {
                path: '/api/data/products',
                method: 'GET',
                controller: 'DataController@products'
              }
            }
          ]
        }
      ];

      const relationships = await parser.detectApiCallRelationships(vueResultsAmbiguous, laravelResultsMultipleMatches);

      // Should not match ambiguous routes or match with very low confidence
      expect(relationships.length).toBeLessThanOrEqual(1);
      if (relationships.length > 0) {
        expect(relationships[0].matchConfidence).toBeLessThan(0.7);
      }
    });
  });

  describe('matchUrlPatterns', () => {
    it('should match exact URL patterns correctly', () => {
      const vueApiCalls: ApiCallInfo[] = [
        {
          url: '/api/users',
          normalizedUrl: '/api/users',
          method: 'GET',
          confidence: 1.0,
          location: { line: 10, column: 5 },
          filePath: '/frontend/components/UserList.vue',
          componentName: 'UserList'
        }
      ];

      const laravelRoutes: LaravelRoute_CrossStack[] = [
        {
          path: '/api/users',
          method: 'GET',
          normalizedPath: '/api/users',
          confidence: 1.0,
          filePath: '/backend/routes/api.php'
        }
      ];

      const matches = parser.matchUrlPatterns(vueApiCalls, laravelRoutes);

      expect(matches).toHaveLength(1);
      expect(matches[0].confidence).toBe(1.0);
      expect(matches[0].similarity.score).toBe(1.0);
    });

    it('should match parameterized URL patterns', () => {
      const vueApiCalls: ApiCallInfo[] = [
        {
          url: '`/api/users/${id}`',
          normalizedUrl: '/api/users/{param}',
          method: 'GET',
          confidence: 0.9,
          location: { line: 15, column: 10 },
          filePath: '/frontend/components/UserDetail.vue',
          componentName: 'UserDetail'
        }
      ];

      const laravelRoutes: LaravelRoute_CrossStack[] = [
        {
          path: '/api/users/{id}',
          method: 'GET',
          normalizedPath: '/api/users/{param}',
          confidence: 1.0,
          filePath: '/backend/routes/api.php'
        }
      ];

      const matches = parser.matchUrlPatterns(vueApiCalls, laravelRoutes);

      expect(matches).toHaveLength(1);
      expect(matches[0].confidence).toBeGreaterThan(0.8);
      expect(matches[0].similarity.matchType).toBe('parameters');
    });

    it('should handle method mismatches', () => {
      const vueApiCalls: ApiCallInfo[] = [
        {
          url: '/api/users',
          normalizedUrl: '/api/users',
          method: 'POST',
          confidence: 1.0,
          location: { line: 20, column: 8 },
          filePath: '/frontend/components/CreateUser.vue',
          componentName: 'CreateUser'
        }
      ];

      const laravelRoutes: LaravelRoute_CrossStack[] = [
        {
          path: '/api/users',
          method: 'GET', // Different method
          normalizedPath: '/api/users',
          confidence: 1.0,
          filePath: '/backend/routes/api.php'
        }
      ];

      const matches = parser.matchUrlPatterns(vueApiCalls, laravelRoutes);

      // Should still match but with lower confidence due to method mismatch
      expect(matches).toHaveLength(1);
      expect(matches[0].confidence).toBeLessThan(0.7);
    });
  });

  describe('compareSchemaStructures', () => {
    it('should compare TypeScript interfaces with PHP validation rules', () => {
      const tsInterfaces = [
        {
          name: 'CreateUserRequest',
          type: 'type_interface' as const,
          properties: [
            { name: 'name', type: 'string', optional: false },
            { name: 'email', type: 'string', optional: false },
            { name: 'age', type: 'number', optional: true }
          ],
          usage: 'request' as const,
          confidence: 1.0,
          framework: 'vue' as const,
          filePath: '/frontend/types/user.ts'
        }
      ];

      const phpDtos = [
        {
          field: 'name',
          rules: ['required', 'string', 'max:255'],
          typeScriptEquivalent: 'string',
          required: true,
          nullable: false
        },
        {
          field: 'email',
          rules: ['required', 'email', 'unique:users'],
          typeScriptEquivalent: 'string',
          required: true,
          nullable: false
        },
        {
          field: 'age',
          rules: ['nullable', 'integer', 'min:0'],
          typeScriptEquivalent: 'number',
          required: false,
          nullable: true
        }
      ];

      const matches = parser.compareSchemaStructures(tsInterfaces, phpDtos);

      expect(matches).toHaveLength(1);
      expect(matches[0].compatibility.compatible).toBe(true);
      expect(matches[0].compatibility.score).toBeGreaterThan(0.8);
      expect(matches[0].compatibility.matches).toHaveLength(3);
      expect(matches[0].compatibility.mismatches).toHaveLength(0);
    });

    it('should detect schema mismatches', () => {
      const tsInterfaces = [
        {
          name: 'UserData',
          type: 'type_interface' as const,
          properties: [
            { name: 'id', type: 'string', optional: false }, // Type mismatch
            { name: 'isActive', type: 'boolean', optional: false }, // Missing in PHP
            { name: 'email', type: 'string', optional: false }
          ],
          usage: 'response' as const,
          confidence: 1.0,
          framework: 'vue' as const,
          filePath: '/frontend/types/user.ts'
        }
      ];

      const phpDtos = [
        {
          field: 'id',
          rules: ['required', 'integer'],
          typeScriptEquivalent: 'number',
          required: true,
          nullable: false
        },
        {
          field: 'email',
          rules: ['required', 'email'],
          typeScriptEquivalent: 'string',
          required: true,
          nullable: false
        },
        {
          field: 'createdAt',
          rules: ['required', 'date'],
          typeScriptEquivalent: 'Date',
          required: true,
          nullable: false
        }
      ];

      const matches = parser.compareSchemaStructures(tsInterfaces, phpDtos);

      expect(matches).toHaveLength(1);
      expect(matches[0].compatibility.compatible).toBe(false);
      expect(matches[0].compatibility.mismatches.length).toBeGreaterThan(0);
      expect(matches[0].compatibility.score).toBeLessThan(0.7);
    });
  });

  describe('calculateMatchConfidence', () => {
    it('should calculate high confidence for perfect matches', () => {
      const perfectMatch = {
        vueCall: {
          url: '/api/users',
          normalizedUrl: '/api/users',
          method: 'GET',
          confidence: 1.0,
          location: { line: 10, column: 5 },
          filePath: '/frontend/components/UserList.vue',
          componentName: 'UserList'
        },
        laravelRoute: {
          path: '/api/users',
          method: 'GET',
          normalizedPath: '/api/users',
          confidence: 1.0,
          filePath: '/backend/routes/api.php'
        },
        similarity: {
          score: 1.0,
          matchType: 'exact' as const,
          evidence: ['exact_path_match', 'exact_method_match'],
          parameterMatches: []
        },
        confidence: 0
      };

      const confidence = parser.calculateMatchConfidence(perfectMatch);

      expect(confidence).toBeGreaterThan(0.9);
    });

    it('should calculate lower confidence for partial matches', () => {
      const partialMatch = {
        vueCall: {
          url: '/api/users/list',
          normalizedUrl: '/api/users/list',
          method: 'GET',
          confidence: 0.8,
          location: { line: 15, column: 10 },
          filePath: '/frontend/components/UserList.vue',
          componentName: 'UserList'
        },
        laravelRoute: {
          path: '/api/users',
          method: 'GET',
          normalizedPath: '/api/users',
          confidence: 1.0,
          filePath: '/backend/routes/api.php'
        },
        similarity: {
          score: 0.7,
          matchType: 'partial' as const,
          evidence: ['partial_path_match', 'method_match'],
          parameterMatches: []
        },
        confidence: 0
      };

      const confidence = parser.calculateMatchConfidence(partialMatch);

      expect(confidence).toBeLessThan(0.8);
      expect(confidence).toBeGreaterThan(0.5);
    });

    it('should calculate very low confidence for poor matches', () => {
      const poorMatch = {
        vueCall: {
          url: '/api/data',
          normalizedUrl: '/api/data',
          method: 'POST',
          confidence: 0.6,
          location: { line: 20, column: 15 },
          filePath: '/frontend/components/DataForm.vue',
          componentName: 'DataForm'
        },
        laravelRoute: {
          path: '/api/users',
          method: 'GET', // Method mismatch
          normalizedPath: '/api/users',
          confidence: 1.0,
          filePath: '/backend/routes/api.php'
        },
        similarity: {
          score: 0.3,
          matchType: 'none' as const,
          evidence: ['method_mismatch', 'low_path_similarity'],
          parameterMatches: []
        },
        confidence: 0
      };

      const confidence = parser.calculateMatchConfidence(poorMatch);

      expect(confidence).toBeLessThan(0.5);
    });
  });

  describe('error handling', () => {
    it('should handle empty input gracefully', async () => {
      const relationships = await parser.detectApiCallRelationships([], []);
      expect(relationships).toHaveLength(0);
    });

    it('should handle malformed Vue results', async () => {
      const malformedVueResults: ParseFileResult[] = [
        {
          filePath: '/frontend/malformed.vue',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [] // No framework entities
        }
      ];

      const validLaravelResults: ParseFileResult[] = [
        {
          filePath: '/backend/routes/api.php',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: [
            {
              type: FrameworkEntityType.LARAVEL_ROUTE,
              name: 'test.route',
              filePath: '/backend/routes/api.php',
              properties: {
                path: '/api/test',
                method: 'GET'
              }
            }
          ]
        }
      ];

      await expect(async () => {
        await parser.detectApiCallRelationships(malformedVueResults, validLaravelResults);
      }).not.toThrow();
    });

    it('should handle invalid confidence threshold', () => {
      expect(() => {
        new CrossStackParser(-1); // Invalid threshold
      }).not.toThrow();

      expect(() => {
        new CrossStackParser(1.5); // Invalid threshold
      }).not.toThrow();
    });
  });
});