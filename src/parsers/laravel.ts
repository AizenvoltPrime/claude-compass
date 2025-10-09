import Parser from 'tree-sitter';
import { php } from 'tree-sitter-php';
import { BaseFrameworkParser, FrameworkPattern, FrameworkParseOptions } from './base-framework';
import { FrameworkEntity, FrameworkParseResult, ParseResult } from './base';
import { ChunkResult, MergedParseResult } from './chunked-parser';
import { PHPParser } from './php';
import { SyntaxNode } from 'tree-sitter';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';
import {
  normalizeUrlPattern,
  calculateUrlSimilarity,
  UrlPattern,
  RouteParameter,
} from './utils/url-patterns';

const logger = createComponentLogger('laravel-parser');

// Laravel-specific framework entity interfaces

export interface LaravelRoute extends FrameworkEntity {
  type: 'route';
  path: string;
  method: string;
  controller?: string;
  action?: string;
  middleware: string[];
  routeGroup?: string;
  routeName?: string;
  framework: 'laravel';
}

export interface LaravelController extends FrameworkEntity {
  type: 'controller';
  actions: string[];
  middleware: string[];
  resourceController: boolean;
  framework: 'laravel';
}

export interface EloquentModel extends FrameworkEntity {
  type: 'model';
  tableName?: string;
  fillable: string[];
  relationships: Array<{
    name: string;
    type: string;
    relatedModel: string;
    foreignKey?: string;
    localKey?: string;
  }>;
  framework: 'laravel';
}

export interface LaravelMiddleware extends FrameworkEntity {
  type: 'middleware';
  handleMethod?: string;
  parameters: string[];
  framework: 'laravel';
}

export interface LaravelJob extends FrameworkEntity {
  type: 'job';
  handleMethod?: string;
  queueConnection?: string;
  attempts?: number;
  timeout?: number;
  framework: 'laravel';
}

export interface LaravelServiceProvider extends FrameworkEntity {
  type: 'service_provider';
  registerMethod?: string;
  bootMethod?: string;
  bindings: string[];
  framework: 'laravel';
}

export interface LaravelCommand extends FrameworkEntity {
  type: 'command';
  signature?: string;
  description?: string;
  handleMethod?: string;
  framework: 'laravel';
}

// Missing Laravel entity types from improvement plan
export interface LaravelFormRequest extends FrameworkEntity {
  type: 'form_request';
  rules: Record<string, string>;
  messages: Record<string, string>;
  authorize: boolean;
  framework: 'laravel';
}

export interface LaravelEvent extends FrameworkEntity {
  type: 'event';
  shouldBroadcast: boolean;
  broadcastType: 'ShouldBroadcast' | 'ShouldBroadcastNow';
  channels: string[];
  broadcastWith: Record<string, any>;
  framework: 'laravel';
}

export interface LaravelMail extends FrameworkEntity {
  type: 'mail';
  shouldQueue: boolean;
  view: string;
  subject: string;
  markdown: boolean;
  framework: 'laravel';
}

export interface LaravelPolicy extends FrameworkEntity {
  type: 'policy';
  methods: string[];
  model: string;
  usesHandlesAuthorization: boolean;
  framework: 'laravel';
}

export interface LaravelListener extends FrameworkEntity {
  type: 'listener';
  event: string;
  handleMethod: string;
  shouldQueue: boolean;
  framework: 'laravel';
}

export interface LaravelService extends FrameworkEntity {
  type: 'service';
  methods: string[];
  dependencies: string[];
  namespace: string;
  framework: 'laravel';
}

export interface LaravelFactory extends FrameworkEntity {
  type: 'factory';
  model: string;
  states: string[];
  definition: Record<string, any>;
  framework: 'laravel';
}

export interface LaravelTrait extends FrameworkEntity {
  type: 'trait';
  methods: string[];
  properties: string[];
  uses: string[];
  framework: 'laravel';
}

export interface LaravelResource extends FrameworkEntity {
  type: 'resource';
  toArrayMethod: string;
  withMethod: string;
  additionalData: Record<string, any>;
  framework: 'laravel';
}

export interface LaravelObserver extends FrameworkEntity {
  type: 'observer';
  model: string;
  observedEvents: string[];
  methods: string[];
  framework: 'laravel';
}

/**
 * Laravel API schema information extracted from controllers
 */
export interface LaravelApiSchema extends FrameworkEntity {
  type: 'api_schema';
  controllerMethod: string;
  route: string;
  httpMethod: string;
  requestValidation?: ValidationRule[];
  responseSchema?: any;
  location: {
    line: number;
    column: number;
  };
  framework: 'laravel';
}

/**
 * Validation rule information from FormRequests
 */
export interface ValidationRule {
  field: string;
  rules: string[];
  typeScriptEquivalent: string;
  required: boolean;
  nullable: boolean;
}

/**
 * Laravel API response schema extracted from controllers
 */
export interface LaravelResponseSchema extends FrameworkEntity {
  type: 'response_schema';
  controllerAction: string;
  responseType: 'json' | 'resource' | 'collection' | 'custom';
  structure: any;
  framework: 'laravel';
}

/**
 * Laravel framework parser that extends BaseFrameworkParser
 * Analyzes PHP files for Laravel-specific patterns and entities
 */
export class LaravelParser extends BaseFrameworkParser {
  private phpParser: PHPParser;

  constructor(parser: Parser) {
    super(parser, 'laravel');
    this.phpParser = new PHPParser();
  }

  /**
   * Override parseFileDirectly to use PHPParser for base parsing
   */
  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: FrameworkParseOptions
  ): Promise<ParseResult> {
    // Delegate to PHPParser for base PHP parsing
    return this.phpParser.parseFile(filePath, content, options);
  }

  /**
   * Get Laravel-specific framework patterns for detection
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'laravel-controller',
        pattern: /class\s+\w+Controller\s+extends\s+(Controller|BaseController)/,
        fileExtensions: ['.php'],
        description: 'Laravel controller classes extending base Controller',
      },
      {
        name: 'laravel-model',
        pattern: /class\s+\w+\s+extends\s+(Model|Authenticatable|Pivot)/,
        fileExtensions: ['.php'],
        description: 'Eloquent model classes extending Model, Authenticatable, or Pivot',
      },
      {
        name: 'laravel-route',
        pattern: /Route::(get|post|put|delete|patch|any|match|resource|group)/,
        fileExtensions: ['.php'],
        description: 'Laravel route definitions using Route facade',
      },
      {
        name: 'laravel-middleware',
        pattern: /class\s+\w+\s+(implements\s+.*Middleware|extends\s+.*Middleware)/,
        fileExtensions: ['.php'],
        description: 'Laravel middleware classes',
      },
      {
        name: 'laravel-service-provider',
        pattern: /class\s+\w+ServiceProvider\s+extends\s+ServiceProvider/,
        fileExtensions: ['.php'],
        description: 'Laravel service provider classes',
      },
      {
        name: 'laravel-job',
        pattern: /class\s+\w+\s+implements\s+.*ShouldQueue/,
        fileExtensions: ['.php'],
        description: 'Laravel queueable job classes',
      },
      {
        name: 'laravel-command',
        pattern: /class\s+\w+\s+extends\s+Command/,
        fileExtensions: ['.php'],
        description: 'Laravel Artisan command classes',
      },
      {
        name: 'laravel-migration',
        pattern: /class\s+\w+\s+extends\s+Migration/,
        fileExtensions: ['.php'],
        description: 'Laravel database migration classes',
      },
      {
        name: 'laravel-seeder',
        pattern: /class\s+\w+\s+extends\s+Seeder/,
        fileExtensions: ['.php'],
        description: 'Laravel database seeder classes',
      },
      // Missing Laravel entity patterns from improvement plan
      {
        name: 'laravel-form-request',
        pattern: /class\s+\w+\s+extends\s+FormRequest/,
        fileExtensions: ['.php'],
        description: 'Laravel Form Request classes for validation',
      },
      {
        name: 'laravel-event',
        pattern: /class\s+\w+\s+implements\s+.*ShouldBroadcast/,
        fileExtensions: ['.php'],
        description: 'Laravel Event classes with broadcasting',
      },
      {
        name: 'laravel-mail',
        pattern: /class\s+\w+\s+extends\s+Mailable/,
        fileExtensions: ['.php'],
        description: 'Laravel Mail classes',
      },
      {
        name: 'laravel-policy',
        pattern: /class\s+\w+.*Policy/,
        fileExtensions: ['.php'],
        description: 'Laravel Policy classes for authorization',
      },
      {
        name: 'laravel-listener',
        pattern: /class\s+\w+.*\s+public\s+function\s+handle/,
        fileExtensions: ['.php'],
        description: 'Laravel Event Listener classes',
      },
      {
        name: 'laravel-factory',
        pattern: /class\s+\w+Factory\s+extends\s+Factory/,
        fileExtensions: ['.php'],
        description: 'Laravel Factory classes for model generation',
      },
      {
        name: 'laravel-trait',
        pattern: /trait\s+\w+/,
        fileExtensions: ['.php'],
        description: 'PHP Traits used in Laravel applications',
      },
      {
        name: 'laravel-resource',
        pattern: /class\s+\w+\s+extends\s+.*Resource/,
        fileExtensions: ['.php'],
        description: 'Laravel API Resource classes',
      },
      {
        name: 'laravel-observer',
        pattern: /class\s+\w+Observer/,
        fileExtensions: ['.php'],
        description: 'Laravel Model Observer classes',
      },
      {
        name: 'laravel-service',
        pattern: /class\s+\w+Service/,
        fileExtensions: ['.php'],
        description: 'Laravel Service classes for business logic',
      },
    ];
  }

  /**
   * Extract API schemas from Laravel controllers
   */
  private async extractApiSchemas(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelApiSchema[]> {
    const apiSchemas: LaravelApiSchema[] = [];

    try {
      // Look for controller classes
      const classNodes = this.findNodesByType(rootNode, 'class_declaration');

      for (const classNode of classNodes) {
        const className = this.getClassName(classNode, content);
        if (className && className.includes('Controller')) {
          const methods = this.findNodesByType(classNode, 'method_declaration');

          for (const methodNode of methods) {
            const methodName = this.getMethodName(methodNode, content);
            if (methodName && this.isApiMethod(methodNode, content)) {
              const schema = await this.parseApiMethodSchema(
                methodNode,
                methodName,
                className,
                content,
                filePath
              );
              if (schema) {
                apiSchemas.push(schema);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to extract API schemas from ${filePath}`, { error });
    }

    return apiSchemas;
  }

  /**
   * Parse individual API method to extract schema information
   */
  private async parseApiMethodSchema(
    methodNode: SyntaxNode,
    methodName: string,
    className: string,
    content: string,
    filePath: string
  ): Promise<LaravelApiSchema | null> {
    try {
      // Extract HTTP method and route information
      const httpMethod = this.inferHttpMethod(methodName);
      const route = this.inferRoute(className, methodName);

      // Extract request validation
      const requestValidation = this.extractRequestValidation(methodNode, content);

      // Extract response schema
      const responseSchema = this.extractResponseSchema(methodNode, content);

      return {
        type: 'api_schema',
        name: `${className}@${methodName}`,
        filePath,
        controllerMethod: `${className}@${methodName}`,
        route,
        httpMethod,
        requestValidation: requestValidation.length > 0 ? requestValidation : undefined,
        responseSchema,
        location: {
          line: methodNode.startPosition.row + 1,
          column: methodNode.startPosition.column,
        },
        framework: 'laravel',
        metadata: {
          className,
          methodName,
          isApiMethod: true,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse API method schema for ${methodName}`, { error });
      return null;
    }
  }

  /**
   * Parse FormRequest validation rules
   */
  private parseFormRequestValidation(content: string, filePath: string): ValidationRule[] {
    const validationRules: ValidationRule[] = [];

    try {
      // Look for rules() method in FormRequest classes
      const rulesPattern = /public\s+function\s+rules\s*\(\s*\)\s*\{([^}]+)\}/g;
      let match;

      while ((match = rulesPattern.exec(content)) !== null) {
        const rulesBody = match[1];

        // Extract individual validation rules
        const rulePattern = /['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]/g;
        let ruleMatch;

        while ((ruleMatch = rulePattern.exec(rulesBody)) !== null) {
          const field = ruleMatch[1];
          const rules = ruleMatch[2].split('|');

          const validationRule: ValidationRule = {
            field,
            rules,
            typeScriptEquivalent: this.mapLaravelRulesToTypeScript(rules),
            required: rules.includes('required'),
            nullable: rules.includes('nullable'),
          };

          validationRules.push(validationRule);
        }
      }
    } catch (error) {
      logger.warn(`Failed to parse FormRequest validation from ${filePath}`, { error });
    }

    return validationRules;
  }

  /**
   * Helper methods for API schema extraction
   */
  private isApiMethod(methodNode: SyntaxNode, content: string): boolean {
    const methodText = content.substring(methodNode.startIndex, methodNode.endIndex);

    // Check for common API indicators
    const apiIndicators = [
      'return response()->json(',
      'return Response::json(',
      'return new JsonResponse(',
      'JsonResponse',
      'ApiResource',
      'Resource::',
      '->json(',
    ];

    return apiIndicators.some(indicator => methodText.includes(indicator));
  }

  private inferHttpMethod(methodName: string): string {
    const methodName_lower = methodName.toLowerCase();

    if (methodName_lower.includes('store') || methodName_lower.includes('create')) {
      return 'POST';
    }
    if (methodName_lower.includes('update') || methodName_lower.includes('edit')) {
      return 'PUT';
    }
    if (methodName_lower.includes('destroy') || methodName_lower.includes('delete')) {
      return 'DELETE';
    }
    if (
      methodName_lower.includes('index') ||
      methodName_lower.includes('show') ||
      methodName_lower.includes('get')
    ) {
      return 'GET';
    }

    return 'GET'; // Default
  }

  private inferRoute(className: string, methodName: string): string {
    // Remove "Controller" suffix
    const resourceName = className.replace(/Controller$/, '').toLowerCase();

    // Map common method names to routes
    switch (methodName.toLowerCase()) {
      case 'index':
        return `/api/${resourceName}`;
      case 'show':
        return `/api/${resourceName}/{id}`;
      case 'store':
        return `/api/${resourceName}`;
      case 'update':
        return `/api/${resourceName}/{id}`;
      case 'destroy':
        return `/api/${resourceName}/{id}`;
      default:
        return `/api/${resourceName}/${methodName.toLowerCase()}`;
    }
  }

  private extractRequestValidation(methodNode: SyntaxNode, content: string): ValidationRule[] {
    const validationRules: ValidationRule[] = [];
    const methodText = content.substring(methodNode.startIndex, methodNode.endIndex);

    try {
      // Look for FormRequest parameters
      const formRequestPattern = /(\w+Request)\s+\$\w+/g;
      let match;

      while ((match = formRequestPattern.exec(methodText)) !== null) {
        const requestClass = match[1];
        // Note: In a full implementation, we would look up the FormRequest class
        // For now, we'll return a placeholder
        validationRules.push({
          field: 'placeholder',
          rules: ['required'],
          typeScriptEquivalent: 'string',
          required: true,
          nullable: false,
        });
      }

      // Also look for inline validation
      const inlineValidationPattern = /validate\s*\(\s*\[([^\]]+)\]/g;
      let validationMatch;

      while ((validationMatch = inlineValidationPattern.exec(methodText)) !== null) {
        const rulesText = validationMatch[1];
        // Parse inline validation rules
        const rulePattern = /['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]/g;
        let ruleMatch;

        while ((ruleMatch = rulePattern.exec(rulesText)) !== null) {
          const field = ruleMatch[1];
          const rules = ruleMatch[2].split('|');

          validationRules.push({
            field,
            rules,
            typeScriptEquivalent: this.mapLaravelRulesToTypeScript(rules),
            required: rules.includes('required'),
            nullable: rules.includes('nullable'),
          });
        }
      }
    } catch (error) {
      logger.warn(`Failed to extract request validation`, { error });
    }

    return validationRules;
  }

  private extractResponseSchema(methodNode: SyntaxNode, content: string): any {
    const methodText = content.substring(methodNode.startIndex, methodNode.endIndex);

    try {
      // Look for different response patterns
      if (methodText.includes('Resource::collection(')) {
        return { type: 'collection', resource: 'ApiResource' };
      }
      if (methodText.includes('Resource::make(') || methodText.includes('new \\w+Resource(')) {
        return { type: 'resource', resource: 'ApiResource' };
      }
      if (methodText.includes('response()->json(')) {
        // Try to extract the structure from the json() call
        const jsonPattern = /response\(\)->json\(\s*(\{[^}]+\}|\[.*?\]|[^)]+)\)/;
        const match = jsonPattern.exec(methodText);
        if (match) {
          return { type: 'json', structure: 'custom' };
        }
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to extract response schema`, { error });
      return null;
    }
  }

  private mapLaravelRulesToTypeScript(rules: string[]): string {
    // Handle compound rules
    if (rules.includes('nullable')) {
      const baseType = this.getBaseTypeFromRules(rules.filter(r => r !== 'nullable'));
      return `${baseType} | null`;
    }

    return this.getBaseTypeFromRules(rules);
  }

  private getBaseTypeFromRules(rules: string[]): string {
    for (const rule of rules) {
      if (rule === 'string' || rule.startsWith('max:') || rule.startsWith('min:')) {
        return 'string';
      }
      if (rule === 'integer' || rule === 'numeric') {
        return 'number';
      }
      if (rule === 'boolean') {
        return 'boolean';
      }
      if (rule === 'array') {
        return 'array';
      }
      if (rule === 'email') {
        return 'string'; // email is still a string type
      }
      if (rule === 'date' || rule === 'datetime') {
        return 'string'; // dates are usually strings in JSON
      }
    }

    return 'any'; // Default fallback
  }

  private findNodesByType(node: SyntaxNode, type: string): SyntaxNode[] {
    const nodes: SyntaxNode[] = [];

    const traverse = (currentNode: SyntaxNode) => {
      if (currentNode.type === type) {
        nodes.push(currentNode);
      }

      for (let i = 0; i < currentNode.childCount; i++) {
        const child = currentNode.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(node);
    return nodes;
  }

  /**
   * Detect Laravel framework entities in the given file
   */
  async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      // Create a dedicated PHP parser for tree-sitter parsing
      const phpTreeParser = new Parser();
      phpTreeParser.setLanguage(php);

      // Parse the PHP content
      const tree = phpTreeParser.parse(content);
      if (!tree || !tree.rootNode) {
        logger.warn(`Failed to parse PHP content for Laravel analysis: ${filePath}`);
        return { entities: [] };
      }

      // Route files get special treatment
      const isRoute = this.isRouteFile(filePath);
      if (isRoute) {
        const routes = await this.extractLaravelRoutes(content, filePath, tree.rootNode);
        entities.push(...routes);
      }

      // Extract entities based on file content and AST
      entities.push(...(await this.extractLaravelControllers(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractEloquentModels(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelMiddleware(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelJobs(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractServiceProviders(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractArtisanCommands(content, filePath, tree.rootNode)));

      // Extract missing Laravel entity types from improvement plan
      entities.push(...(await this.extractFormRequests(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelEvents(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelMail(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelPolicies(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelListeners(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelServices(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelFactories(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelTraits(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelResources(content, filePath, tree.rootNode)));
      entities.push(...(await this.extractLaravelObservers(content, filePath, tree.rootNode)));

      // Extract API schemas from controller methods
      entities.push(...(await this.extractApiSchemas(content, filePath, tree.rootNode)));

      // Extract validation rules from FormRequest classes
      if (filePath.includes('Request') && content.includes('FormRequest')) {
        const validationRules = this.parseFormRequestValidation(content, filePath);
        if (validationRules.length > 0) {
          // Create a framework entity for the validation rules
          const formRequestEntity: FrameworkEntity = {
            type: 'form_request_validation',
            name: path.basename(filePath, '.php'),
            filePath,
            metadata: {
              validationRules,
              rulesCount: validationRules.length,
              framework: 'laravel',
            },
          };
          entities.push(formRequestEntity);
        }
      }

      return { entities };
    } catch (error) {
      logger.error(`Laravel entity detection failed for ${filePath}`, { error: error.message });
      return { entities: [] };
    }
  }

  /**
   * Check if the file is applicable for Laravel framework parsing
   */
  protected isFrameworkApplicable(filePath: string, content: string): boolean {
    // Laravel specific file patterns
    const laravelPatterns = [
      '/app/Http/Controllers/',
      '/app/Models/',
      '/app/Http/Middleware/',
      '/app/Jobs/',
      '/app/Providers/',
      '/routes/',
      '/database/migrations/',
      '/database/seeders/',
      '/app/Console/Commands/',
    ];

    const isLaravelPath = laravelPatterns.some(pattern => filePath.includes(pattern));

    // Check if content is valid before checking Laravel patterns
    const hasLaravelCode =
      content &&
      (content.includes('laravel') ||
        content.includes('illuminate') ||
        content.includes('Illuminate\\') ||
        content.includes('App\\') ||
        content.includes('Route::') ||
        content.includes('extends Model') ||
        content.includes('extends Authenticatable') ||
        content.includes('extends Controller'));

    return filePath.endsWith('.php') && (isLaravelPath || hasLaravelCode);
  }

  // Route extraction methods

  /**
   * Extract Laravel routes from route files
   */
  private async extractLaravelRoutes(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelRoute[]> {
    const routes: LaravelRoute[] = [];
    const processedNodes = new Set<SyntaxNode>();
    let groupCount = 0;
    let routeCount = 0;

    try {
      this.traverseNode(rootNode, node => {
        if (this.isRouteGroup(node)) {
          groupCount++;
          this.processRouteGroup(node, [], routes, processedNodes, filePath, content);
        } else if (this.isRouteDefinition(node) && !processedNodes.has(node)) {
          routeCount++;
          const routeDef = this.parseRouteDefinition(node, filePath, content);
          if (Array.isArray(routeDef)) {
            routes.push(...routeDef);
          } else if (routeDef) {
            routes.push(routeDef);
          }
        }
      });
    } catch (error) {
      logger.error(`Route extraction failed for ${filePath}`, { error: error.message });
    }

    return routes;
  }

  private processRouteGroup(
    groupNode: SyntaxNode,
    parentMiddleware: string[],
    routes: LaravelRoute[],
    processedNodes: Set<SyntaxNode>,
    filePath: string,
    content: string
  ): void {
    processedNodes.add(groupNode);
    const groupMiddleware = this.getRouteGroupMiddleware(groupNode, content);
    const accumulatedMiddleware = [...parentMiddleware, ...groupMiddleware];

    this.traverseNode(groupNode, innerNode => {
      if (innerNode === groupNode) {
        return;
      }

      if (this.isRouteGroup(innerNode) && !processedNodes.has(innerNode)) {
        this.processRouteGroup(innerNode, accumulatedMiddleware, routes, processedNodes, filePath, content);
      } else if (this.isRouteDefinition(innerNode) && !processedNodes.has(innerNode)) {
        processedNodes.add(innerNode);
        const routeDef = this.parseRouteDefinition(innerNode, filePath, content);
        if (Array.isArray(routeDef)) {
          routeDef.forEach(route => {
            route.middleware = [...accumulatedMiddleware, ...route.middleware];
            routes.push(route);
          });
        } else if (routeDef) {
          routeDef.middleware = [...accumulatedMiddleware, ...routeDef.middleware];
          routes.push(routeDef);
        }
      }
    });
  }

  /**
   * Check if a node represents a route definition
   */
  private isRouteDefinition(node: SyntaxNode): boolean {
    // Check for Route::method() calls (scoped_call_expression in tree-sitter-php)
    if (node.type === 'scoped_call_expression') {
      // First child should be the class name (Route)
      // Second child should be the scope operator (::)
      // Third child should be the method name
      if (node.children && node.children.length >= 3) {
        const className = node.children[0];
        const methodName = node.children[2];

        if (className?.text === 'Route' && methodName) {
          const method = methodName.text;
          return [
            'get',
            'post',
            'put',
            'delete',
            'patch',
            'any',
            'match',
            'resource',
            'apiResource',
            'group',
          ].includes(method);
        }
      }
    }
    return false;
  }

  /**
   * Parse a route definition node into a LaravelRoute entity
   */
  private parseRouteDefinition(
    node: SyntaxNode,
    filePath: string,
    content: string
  ): LaravelRoute | LaravelRoute[] | null {
    try {
      const method = this.getRouteMethod(node);
      const path = this.getRoutePath(node, content);
      const handler = this.getRouteHandler(node, content);
      const middleware = this.getRouteMiddleware(node, content);
      const routeName = this.getRouteName(node, content);

      if (!method || !path) {
        logger.warn('Route definition missing method or path', {
          filePath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          nodeType: node.type,
          nodeText: node.text.substring(0, 100),
          method: method || 'MISSING',
          path: path || 'MISSING',
        });
        return null;
      }

      const route: LaravelRoute = {
        type: 'route',
        name: routeName || `${method.toUpperCase()} ${path}`,
        filePath,
        framework: 'laravel',
        path,
        method: method.toUpperCase(),
        controller: handler?.controller,
        action: handler?.action,
        middleware: middleware || [],
        routeGroup: this.getCurrentRouteGroup(node),
        routeName,
        metadata: {
          parameters: this.extractRouteParameters(path),
          constraints: this.getRouteConstraints(node, content),
          domain: this.getRouteDomain(node, content),
          isResource: method === 'resource' || method === 'apiResource',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      };

      if (route.metadata.isResource) {
        return this.expandResourceRoute(route, method);
      }

      return route;
    } catch (error) {
      logger.warn(`Failed to parse route definition`, { error: error.message });
      return null;
    }
  }

  private expandResourceRoute(
    resourceRoute: LaravelRoute,
    resourceType: string
  ): LaravelRoute[] {
    const routes: LaravelRoute[] = [];
    const basePath = resourceRoute.path;
    const controller = resourceRoute.controller;
    const isApiResource = resourceType === 'apiResource';

    const resourceMethods = isApiResource
      ? ['index', 'store', 'show', 'update', 'destroy']
      : ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];

    const methodMap: Record<string, { method: string; path: string }> = {
      index: { method: 'GET', path: basePath },
      create: { method: 'GET', path: `${basePath}/create` },
      store: { method: 'POST', path: basePath },
      show: { method: 'GET', path: `${basePath}/{id}` },
      edit: { method: 'GET', path: `${basePath}/{id}/edit` },
      update: { method: 'PUT', path: `${basePath}/{id}` },
      destroy: { method: 'DELETE', path: `${basePath}/{id}` },
    };

    for (const action of resourceMethods) {
      const config = methodMap[action];
      routes.push({
        type: 'route',
        name: resourceRoute.routeName ? `${resourceRoute.routeName}.${action}` : null,
        filePath: resourceRoute.filePath,
        framework: 'laravel',
        path: config.path,
        method: config.method,
        controller: controller,
        action: action,
        middleware: resourceRoute.middleware,
        routeGroup: resourceRoute.routeGroup,
        routeName: resourceRoute.routeName ? `${resourceRoute.routeName}.${action}` : null,
        metadata: {
          ...resourceRoute.metadata,
          isResource: false,
          resourceAction: action,
          expandedFrom: resourceType,
          parameters: this.extractRouteParameters(config.path),
        },
      });
    }

    return routes;
  }

  // Controller extraction methods

  /**
   * Extract Laravel controllers from PHP files
   */
  private async extractLaravelControllers(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelController[]> {
    const controllers: LaravelController[] = [];

    if (!this.isControllerFile(filePath, content)) {
      return controllers;
    }

    try {
      this.traverseNode(rootNode, node => {
        if (node.type === 'class_declaration' && this.extendsController(content, node)) {
          const controller = this.parseController(node, filePath, content);
          if (controller) {
            controllers.push(controller);
          }
        } else if (node.type === 'ERROR' && this.hasControllerPatternInError(content, node)) {
          // Handle malformed PHP code that still contains controller patterns
          const controller = this.parseControllerFromError(node, filePath, content);
          if (controller) {
            controllers.push(controller);
          }
        }
      });
    } catch (error) {
      logger.error(`Controller extraction failed for ${filePath}`, { error: error.message });
    }

    return controllers;
  }

  /**
   * Check if file is a Laravel controller
   */
  private isControllerFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('/app/Http/Controllers/') ||
      path.basename(filePath).endsWith('Controller.php') ||
      content.includes('extends Controller') ||
      content.includes('extends BaseController')
    );
  }

  /**
   * Check if a class extends Controller
   */
  private extendsController(content: string, node: SyntaxNode): boolean {
    const className = this.getClassName(node, content);
    if (!className) return false;

    const classPattern = new RegExp(
      `class\\s+${className}\\s+extends\\s+(Controller|BaseController)`
    );
    return classPattern.test(content);
  }

  /**
   * Parse a controller class node
   */
  private parseController(
    node: SyntaxNode,
    filePath: string,
    content: string
  ): LaravelController | null {
    try {
      const className = this.getClassName(node, content);
      if (!className) return null;

      const actions = this.getControllerActions(node, content);
      const middleware = this.getControllerMiddleware(node, content);
      const isResource = this.isResourceController(actions);

      return {
        type: 'controller',
        name: className,
        filePath,
        framework: 'laravel',
        actions,
        middleware,
        resourceController: isResource,
        metadata: {
          namespace: this.getClassNamespace(content),
          traits: this.getControllerTraits(node, content),
          dependencies: this.getConstructorDependencies(node, content),
          isApiController: this.isApiController(filePath, content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse controller`, { error: error.message });
      return null;
    }
  }

  // Model extraction methods

  /**
   * Extract Eloquent models from PHP files
   */
  private async extractEloquentModels(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<EloquentModel[]> {
    const models: EloquentModel[] = [];

    if (!this.isModelFile(filePath, content)) {
      return models;
    }

    try {
      this.traverseNode(rootNode, node => {
        if (node.type === 'class_declaration' && this.extendsModel(content, node)) {
          const model = this.parseModel(node, filePath, content);
          if (model) {
            models.push(model);
          }
        }
      });
    } catch (error) {
      logger.error(`Model extraction failed for ${filePath}`, { error: error.message });
    }

    return models;
  }

  /**
   * Check if file is an Eloquent model
   */
  private isModelFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('/app/Models/') ||
      (filePath.includes('/app/') &&
        (content.includes('extends Model') ||
          content.includes('extends Authenticatable') ||
          content.includes('extends Pivot') ||
          content.includes('extends User') ||
          content.includes('use Authenticatable') ||
          content.includes('use HasFactory')))
    );
  }

  /**
   * Check if a class extends Model
   */
  private extendsModel(content: string, node: SyntaxNode): boolean {
    const className = this.getClassName(node, content);
    if (!className) return false;

    // Laravel model base classes
    const modelBaseClasses = [
      'Model',
      'Authenticatable',
      'Pivot',
      'User', // Legacy Laravel user model pattern
    ];

    for (const baseClass of modelBaseClasses) {
      const modelPattern = new RegExp(`class\\s+${className}\\s+extends\\s+${baseClass}`);
      if (modelPattern.test(content)) {
        return true;
      }
    }

    // Check for traits that indicate a model
    if (
      content.includes(`class ${className}`) &&
      (content.includes('use Authenticatable') ||
        content.includes('use HasFactory') ||
        content.includes('use Notifiable') ||
        content.includes('protected $fillable') ||
        content.includes('protected $guarded'))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Parse a model class node
   */
  private parseModel(node: SyntaxNode, filePath: string, content: string): EloquentModel | null {
    try {
      const className = this.getClassName(node, content);
      if (!className) return null;

      const tableName = this.getModelTableName(node, content);
      const fillable = this.getModelFillable(node, content);
      const relationships = this.getModelRelationships(node, content);

      return {
        type: 'model',
        name: className,
        filePath,
        framework: 'laravel',
        tableName,
        fillable,
        relationships,
        metadata: {
          timestamps: this.hasTimestamps(node, content),
          softDeletes: this.hasSoftDeletes(node, content),
          guarded: this.getModelGuarded(node, content),
          casts: this.getModelCasts(node, content),
          hidden: this.getModelHidden(node, content),
          scopes: this.getModelScopes(node, content),
          mutators: this.getModelMutators(node, content),
          accessors: this.getModelAccessors(node, content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse model`, { error: error.message });
      return null;
    }
  }

  // Middleware extraction methods

  /**
   * Extract Laravel middleware from PHP files
   */
  private async extractLaravelMiddleware(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelMiddleware[]> {
    const middleware: LaravelMiddleware[] = [];

    if (!this.isMiddlewareFile(filePath, content)) {
      return middleware;
    }

    try {
      this.traverseNode(rootNode, node => {
        if (node.type === 'class_declaration' && this.implementsMiddleware(content, node)) {
          const middlewareEntity = this.parseMiddleware(node, filePath, content);
          if (middlewareEntity) {
            middleware.push(middlewareEntity);
          }
        }
      });
    } catch (error) {
      logger.error(`Middleware extraction failed for ${filePath}`, { error: error.message });
    }

    return middleware;
  }

  /**
   * Check if file is a middleware
   */
  private isMiddlewareFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('/app/Http/Middleware/') ||
      path.basename(filePath).endsWith('Middleware.php') ||
      content.includes('implements Middleware') ||
      content.includes('extends Middleware')
    );
  }

  /**
   * Check if a class implements middleware
   */
  private implementsMiddleware(content: string, node: SyntaxNode): boolean {
    const className = this.getClassName(node, content);
    if (!className) return false;

    const pattern = new RegExp(`class\\s+${className}.*implements.*Middleware`);
    return pattern.test(content) || content.includes('function handle(');
  }

  /**
   * Parse a middleware class node
   */
  private parseMiddleware(
    node: SyntaxNode,
    filePath: string,
    content: string
  ): LaravelMiddleware | null {
    try {
      const className = this.getClassName(node, content);
      if (!className) return null;

      const handleMethod = this.getMiddlewareHandleMethod(node, content);
      const parameters = this.getMiddlewareParameters(node, content);

      return {
        type: 'middleware',
        name: className,
        filePath,
        framework: 'laravel',
        handleMethod,
        parameters,
        metadata: {
          global: this.isGlobalMiddleware(filePath),
          route: this.isRouteMiddleware(content, className),
          group: this.getMiddlewareGroup(content, className),
          terminable: this.isTerminableMiddleware(node, content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse middleware`, { error: error.message });
      return null;
    }
  }

  // Job extraction methods

  /**
   * Extract Laravel jobs from PHP files
   */
  private async extractLaravelJobs(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelJob[]> {
    const jobs: LaravelJob[] = [];

    if (!this.isJobFile(filePath, content)) {
      return jobs;
    }

    try {
      this.traverseNode(rootNode, node => {
        if (node.type === 'class_declaration' && this.implementsShouldQueue(content, node)) {
          const job = this.parseJob(node, filePath, content);
          if (job) {
            jobs.push(job);
          }
        }
      });
    } catch (error) {
      logger.error(`Job extraction failed for ${filePath}`, { error: error.message });
    }

    return jobs;
  }

  /**
   * Check if file is a job
   */
  private isJobFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('/app/Jobs/') ||
      path.basename(filePath).endsWith('Job.php') ||
      content.includes('implements ShouldQueue')
    );
  }

  /**
   * Check if a class implements ShouldQueue
   */
  private implementsShouldQueue(content: string, node: SyntaxNode): boolean {
    const className = this.getClassName(node, content);
    if (!className) return false;

    const pattern = new RegExp(`class\\s+${className}.*implements.*ShouldQueue`);
    return pattern.test(content);
  }

  /**
   * Parse a job class node
   */
  private parseJob(node: SyntaxNode, filePath: string, content: string): LaravelJob | null {
    try {
      const className = this.getClassName(node, content);
      if (!className) return null;

      const handleMethod = this.getJobHandleMethod(node, content);
      const queueConnection = this.getJobQueueConnection(node, content);
      const attempts = this.getJobAttempts(node, content);
      const timeout = this.getJobTimeout(node, content);

      return {
        type: 'job',
        name: className,
        filePath,
        framework: 'laravel',
        handleMethod,
        queueConnection,
        attempts,
        timeout,
        metadata: {
          dispatchable: this.isDispatchableJob(content, className),
          serializable: this.isSerializableJob(content, className),
          queueable: this.isQueueableJob(content, className),
          batchable: this.isBatchableJob(content, className),
          queue: this.getJobQueue(node, content),
          delay: this.getJobDelay(node, content),
          hasFailedMethod: this.hasFailedMethod(node, content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse job`, { error: error.message });
      return null;
    }
  }

  // Service Provider extraction methods

  /**
   * Extract service providers from PHP files
   */
  private async extractServiceProviders(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelServiceProvider[]> {
    const providers: LaravelServiceProvider[] = [];

    if (!this.isServiceProviderFile(filePath, content)) {
      return providers;
    }

    try {
      this.traverseNode(rootNode, node => {
        if (node.type === 'class_declaration' && this.extendsServiceProvider(content, node)) {
          const provider = this.parseServiceProvider(node, filePath, content);
          if (provider) {
            providers.push(provider);
          }
        }
      });
    } catch (error) {
      logger.error(`Service provider extraction failed for ${filePath}`, { error: error.message });
    }

    return providers;
  }

  /**
   * Check if file is a service provider
   */
  private isServiceProviderFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('/app/Providers/') ||
      path.basename(filePath).endsWith('ServiceProvider.php') ||
      content.includes('extends ServiceProvider')
    );
  }

  /**
   * Check if a class extends ServiceProvider
   */
  private extendsServiceProvider(content: string, node: SyntaxNode): boolean {
    const className = this.getClassName(node, content);
    if (!className) return false;

    const pattern = new RegExp(`class\\s+${className}\\s+extends\\s+ServiceProvider`);
    return pattern.test(content);
  }

  /**
   * Parse a service provider class node
   */
  private parseServiceProvider(
    node: SyntaxNode,
    filePath: string,
    content: string
  ): LaravelServiceProvider | null {
    try {
      const className = this.getClassName(node, content);
      if (!className) return null;

      const registerMethod = this.getProviderRegisterMethod(node, content);
      const bootMethod = this.getProviderBootMethod(node, content);
      const bindings = this.getProviderBindings(node, content);

      return {
        type: 'service_provider',
        name: className,
        filePath,
        framework: 'laravel',
        registerMethod,
        bootMethod,
        bindings,
        metadata: {
          deferred: this.isDeferredProvider(content, className),
          provides: this.getProviderProvides(content, className),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse service provider`, { error: error.message });
      return null;
    }
  }

  // Artisan Command extraction methods

  /**
   * Extract Artisan commands from PHP files
   */
  private async extractArtisanCommands(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelCommand[]> {
    const commands: LaravelCommand[] = [];

    if (!this.isCommandFile(filePath, content)) {
      return commands;
    }

    try {
      this.traverseNode(rootNode, node => {
        if (node.type === 'class_declaration' && this.extendsCommand(content, node)) {
          const command = this.parseCommand(node, filePath, content);
          if (command) {
            commands.push(command);
          }
        }
      });
    } catch (error) {
      logger.error(`Command extraction failed for ${filePath}`, { error: error.message });
    }

    return commands;
  }

  /**
   * Check if file is an Artisan command
   */
  private isCommandFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('/app/Console/Commands/') ||
      path.basename(filePath).endsWith('Command.php') ||
      content.includes('extends Command')
    );
  }

  /**
   * Check if a class extends Command
   */
  private extendsCommand(content: string, node: SyntaxNode): boolean {
    const className = this.getClassName(node, content);
    if (!className) return false;

    const pattern = new RegExp(`class\\s+${className}\\s+extends\\s+Command`);
    return pattern.test(content);
  }

  /**
   * Parse a command class node
   */
  private parseCommand(node: SyntaxNode, filePath: string, content: string): LaravelCommand | null {
    try {
      const className = this.getClassName(node, content);
      if (!className) return null;

      const signature = this.getCommandSignature(node, content);
      const description = this.getCommandDescription(node, content);
      const handleMethod = this.getCommandHandleMethod(node, content);

      return {
        type: 'command',
        name: className,
        filePath,
        framework: 'laravel',
        signature,
        description,
        handleMethod,
        metadata: {
          arguments: this.getCommandArguments(signature),
          options: this.getCommandOptions(signature),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse command`, { error: error.message });
      return null;
    }
  }

  // Helper methods for AST parsing and content analysis

  /**
   * Check if file is a route file
   */
  private isRouteFile(filePath: string): boolean {
    return (
      filePath.includes('/routes/') &&
      (filePath.endsWith('web.php') ||
        filePath.endsWith('api.php') ||
        filePath.endsWith('console.php') ||
        filePath.endsWith('channels.php'))
    );
  }

  /**
   * Traverse AST nodes recursively
   */
  private traverseNode(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
      this.traverseNode(child, callback);
    }
  }

  /**
   * Find the arguments node in a scoped call expression
   */
  private findArgumentsNode(node: SyntaxNode): SyntaxNode | null {
    for (const child of node.children) {
      if (child.type === 'arguments') {
        return child;
      }
    }
    return null;
  }

  /**
   * Extract elements from an array creation expression
   */
  private getArrayElements(arrayNode: SyntaxNode, content: string): string[] {
    const elements: string[] = [];

    for (const child of arrayNode.children) {
      if (child.type === 'array_element_initializer') {
        // Get the value from the array element
        const elementText = child.text;

        // Handle different types of array elements
        if (elementText.includes('::class')) {
          // Extract class name from UserController::class
          const className = elementText.replace('::class', '');
          elements.push(className);
        } else if (elementText.startsWith("'") && elementText.endsWith("'")) {
          // Extract string content
          elements.push(elementText.slice(1, -1));
        } else if (elementText.startsWith('"') && elementText.endsWith('"')) {
          // Extract string content
          elements.push(elementText.slice(1, -1));
        } else {
          elements.push(elementText);
        }
      }
    }

    return elements;
  }

  /**
   * Get class name from class declaration node
   */
  private getClassName(node: SyntaxNode, content: string): string | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    return content.slice(nameNode.startIndex, nameNode.endIndex);
  }

  /**
   * Get route method from route definition
   */
  private getRouteMethod(node: SyntaxNode): string | null {
    // For scoped_call_expression, the method name is the third child
    if (node.type === 'scoped_call_expression' && node.children && node.children.length >= 3) {
      return node.children[2].text;
    }
    return null;
  }

  /**
   * Get route path from route definition
   */
  private getRoutePath(node: SyntaxNode, content: string): string | null {
    // For scoped_call_expression, find the arguments node
    const args = this.findArgumentsNode(node);
    if (args && args.children && args.children.length > 1) {
      // First argument is usually the path (inside parentheses)
      const pathArg = args.children[1]; // Skip the opening parenthesis
      if (pathArg.type === 'argument') {
        const stringNode = pathArg.children[0];
        if (stringNode.type === 'string') {
          // Get the string content without quotes
          const stringContent = stringNode.children[1]; // Middle child is string_content
          return stringContent?.text || null;
        }
      }
    }
    return null;
  }

  /**
   * Get route handler from route definition
   */
  private getRouteHandler(
    node: SyntaxNode,
    content: string
  ): { controller?: string; action?: string } | null {
    const args = this.findArgumentsNode(node);
    if (args && args.children && args.children.length > 2) {
      // Second argument is usually the handler (skip opening parenthesis and first argument)
      const handlerArg = args.children[3]; // Skip (, first arg, comma
      if (handlerArg && handlerArg.type === 'argument') {
        const handlerNode = handlerArg.children[0];

        if (handlerNode.type === 'string') {
          const stringContent = handlerNode.children[1]; // Get string_content
          const handlerStr = stringContent?.text;
          if (handlerStr && handlerStr.includes('@')) {
            const [controller, action] = handlerStr.split('@');
            return { controller, action };
          }
        }

        if (handlerNode.type === 'array_creation_expression') {
          const elements = this.getArrayElements(handlerNode, content);
          if (elements.length >= 2) {
            return {
              controller: elements[0],
              action: elements[1],
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * Get middleware from route definition
   */
  private getRouteMiddleware(node: SyntaxNode, content: string): string[] | null {
    const middleware: string[] = [];

    // Simple approach: find the entire route statement and parse with regex
    // Look for the whole statement that includes this route
    let statementNode = node;
    while (statementNode.parent && statementNode.parent.type !== 'program') {
      statementNode = statementNode.parent;
    }

    const statementContent = content.slice(statementNode.startIndex, statementNode.endIndex);

    // Look for ->middleware() calls in the route chain
    const middlewareMatches = statementContent.match(/->middleware\(\s*\[(.*?)\]\s*\)/g);
    if (middlewareMatches) {
      for (const match of middlewareMatches) {
        const arrayMatch = match.match(/\[(.*?)\]/);
        if (arrayMatch) {
          const middlewareList = arrayMatch[1];
          const items = middlewareList
            .split(',')
            .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
            .filter(item => item.length > 0);
          middleware.push(...items);
        }
      }
    }

    // Also look for single middleware
    const singleMiddlewareMatches = statementContent.match(
      /->middleware\(\s*['"]([^'"]+)['"]\s*\)/g
    );
    if (singleMiddlewareMatches) {
      for (const match of singleMiddlewareMatches) {
        const middlewareMatch = match.match(/['"]([^'"]+)['"]/);
        if (middlewareMatch) {
          middleware.push(middlewareMatch[1]);
        }
      }
    }

    return middleware.length > 0 ? middleware : [];
  }

  /**
   * Get route name from route definition
   */
  private getRouteName(node: SyntaxNode, content: string): string | null {
    // Simple approach: find the entire route statement and parse with regex
    let statementNode = node;
    while (statementNode.parent && statementNode.parent.type !== 'program') {
      statementNode = statementNode.parent;
    }

    const statementContent = content.slice(statementNode.startIndex, statementNode.endIndex);

    // Look for ->name() calls in the route chain
    const nameMatch = statementContent.match(/->name\(\s*['"]([^'"]+)['"]\s*\)/);
    if (nameMatch) {
      return nameMatch[1];
    }

    return null;
  }

  /**
   * Get current route group
   */
  private getCurrentRouteGroup(node: SyntaxNode): string | null {
    // This is a simplified implementation
    // In a full implementation, we would track route group nesting
    return null;
  }

  /**
   * Extract route parameters from path
   */
  private extractRouteParameters(path: string): string[] {
    const paramMatches = path.match(/\{([^}]+)\}/g);
    return paramMatches ? paramMatches.map(match => match.slice(1, -1)) : [];
  }

  /**
   * Get route constraints
   */
  private getRouteConstraints(node: SyntaxNode, content: string): any {
    // This is a simplified implementation
    return {};
  }

  /**
   * Get route domain
   */
  private getRouteDomain(node: SyntaxNode, content: string): string | null {
    // This is a simplified implementation
    return null;
  }

  /**
   * Get controller actions from class node
   */
  private getControllerActions(node: SyntaxNode, content: string): string[] {
    const actions: string[] = [];
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration' && this.isPublicMethod(child, content)) {
        const methodName = this.getMethodName(child, content);
        if (methodName && !methodName.startsWith('__')) {
          actions.push(methodName);
        }
      }
    });
    return actions;
  }

  /**
   * Check if method is public
   */
  private isPublicMethod(node: SyntaxNode, content: string): boolean {
    // Check for explicit visibility modifiers
    for (const child of node.children) {
      if (child.type === 'visibility_modifier') {
        const modifier = content.slice(child.startIndex, child.endIndex);
        return modifier === 'public';
      }
    }

    // If no explicit modifier, PHP defaults to public for methods
    return true;
  }

  /**
   * Get method modifiers
   */
  private getMethodModifiers(node: SyntaxNode, content: string): string[] {
    const modifiers: string[] = [];
    for (const child of node.children) {
      if (
        child.type === 'visibility_modifier' ||
        child.type === 'static_modifier' ||
        child.type === 'abstract_modifier' ||
        child.type === 'final_modifier'
      ) {
        const modifier = content.slice(child.startIndex, child.endIndex);
        modifiers.push(modifier);
      }
    }
    return modifiers;
  }

  /**
   * Get method name from method declaration
   */
  private getMethodName(node: SyntaxNode, content: string): string | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    return content.slice(nameNode.startIndex, nameNode.endIndex);
  }

  /**
   * Get controller middleware
   */
  private getControllerMiddleware(node: SyntaxNode, content: string): string[] {
    const middleware: string[] = [];

    // Look for constructor method in the class
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === '__construct') {
          // Parse the constructor body for $this->middleware() calls
          const constructorBody = content.slice(child.startIndex, child.endIndex);

          // Find $this->middleware() calls
          const middlewareMatches = constructorBody.match(
            /\$this->middleware\(\s*['"]([^'"]+)['"]\s*\)/g
          );
          if (middlewareMatches) {
            for (const match of middlewareMatches) {
              const middlewareMatch = match.match(/['"]([^'"]+)['"]/);
              if (middlewareMatch) {
                middleware.push(middlewareMatch[1]);
              }
            }
          }
        }
      }
    });

    return middleware;
  }

  /**
   * Check if controller is a resource controller
   */
  private isResourceController(actions: string[]): boolean {
    const resourceMethods = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];
    return resourceMethods.every(method => actions.includes(method));
  }

  /**
   * Check if controller is an API controller
   */
  private isApiController(filePath: string, content: string): boolean {
    // Check if file path contains /Api/ directory
    if (filePath.includes('/Api/')) {
      return true;
    }

    // Check if namespace contains Api
    const namespace = this.getClassNamespace(content);
    if (namespace && namespace.includes('\\Api\\')) {
      return true;
    }

    return false;
  }

  /**
   * Get class namespace
   */
  private getClassNamespace(content: string): string | null {
    const namespaceMatch = content.match(/namespace\s+([^;]+);/);
    return namespaceMatch ? namespaceMatch[1] : null;
  }

  /**
   * Get controller traits
   */
  private getControllerTraits(node: SyntaxNode, content: string): string[] {
    // This is a simplified implementation
    return [];
  }

  /**
   * Get constructor dependencies
   */
  private getConstructorDependencies(node: SyntaxNode, content: string): string[] {
    // This is a simplified implementation
    return [];
  }

  /**
   * Get model table name
   */
  private getModelTableName(node: SyntaxNode, content: string): string | null {
    const tableMatch = content.match(/protected\s+\$table\s*=\s*['"]([^'"]+)['"]/);
    return tableMatch ? tableMatch[1] : null;
  }

  /**
   * Get model fillable attributes
   */
  private getModelFillable(node: SyntaxNode, content: string): string[] {
    const fillableMatch = content.match(/protected\s+\$fillable\s*=\s*\[(.*?)\]/s);
    if (!fillableMatch) return [];

    const fillableContent = fillableMatch[1];
    const attributes = fillableContent.match(/['"]([^'"]+)['"]/g);
    return attributes ? attributes.map(attr => attr.slice(1, -1)) : [];
  }

  /**
   * Get model relationships
   */
  private getModelRelationships(
    node: SyntaxNode,
    content: string
  ): Array<{
    name: string;
    type: string;
    relatedModel: string;
    foreignKey?: string;
    localKey?: string;
  }> {
    const relationships: Array<{
      name: string;
      type: string;
      relatedModel: string;
      foreignKey?: string;
      localKey?: string;
    }> = [];

    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName) {
          const relationship = this.parseRelationshipMethod(child, methodName, content);
          if (relationship) {
            relationships.push(relationship);
          }
        }
      }
    });

    return relationships;
  }

  /**
   * Parse relationship method
   */
  private parseRelationshipMethod(
    node: SyntaxNode,
    methodName: string,
    content: string
  ): {
    name: string;
    type: string;
    relatedModel: string;
    foreignKey?: string;
    localKey?: string;
  } | null {
    const methodBody = content.slice(node.startIndex, node.endIndex);

    // Pattern matching for Laravel relationships
    const relationshipPatterns = [
      { type: 'hasOne', pattern: /\$this->hasOne\(([^,)]+)/ },
      { type: 'hasMany', pattern: /\$this->hasMany\(([^,)]+)/ },
      { type: 'belongsTo', pattern: /\$this->belongsTo\(([^,)]+)/ },
      { type: 'belongsToMany', pattern: /\$this->belongsToMany\(([^,)]+)/ },
      { type: 'hasOneThrough', pattern: /\$this->hasOneThrough\(([^,)]+)/ },
      { type: 'hasManyThrough', pattern: /\$this->hasManyThrough\(([^,)]+)/ },
    ];

    for (const { type, pattern } of relationshipPatterns) {
      const match = methodBody.match(pattern);
      if (match) {
        const relatedModel = match[1].replace(/['\"]/g, '').replace(/::class/, '');

        return {
          name: methodName,
          type,
          relatedModel,
          foreignKey: this.extractForeignKey(methodBody),
          localKey: this.extractLocalKey(methodBody),
        };
      }
    }

    return null;
  }

  /**
   * Extract foreign key from relationship method
   */
  private extractForeignKey(methodBody: string): string | null {
    const foreignKeyMatch = methodBody.match(/,\s*['"]([^'"]+)['"][,)]/);
    return foreignKeyMatch ? foreignKeyMatch[1] : null;
  }

  /**
   * Extract local key from relationship method
   */
  private extractLocalKey(methodBody: string): string | null {
    const localKeyMatch = methodBody.match(/,\s*['"][^'"]+['"],\s*['"]([^'"]+)['"][,)]/);
    return localKeyMatch ? localKeyMatch[1] : null;
  }

  /**
   * Check if model has timestamps
   */
  private hasTimestamps(node: SyntaxNode, content: string): boolean {
    return !content.includes('public $timestamps = false');
  }

  /**
   * Check if model has soft deletes
   */
  private hasSoftDeletes(node: SyntaxNode, content: string): boolean {
    return content.includes('use SoftDeletes') || content.includes('SoftDeleting');
  }

  /**
   * Get model guarded attributes
   */
  private getModelGuarded(node: SyntaxNode, content: string): string[] {
    const guardedMatch = content.match(/protected\s+\$guarded\s*=\s*\[(.*?)\]/s);
    if (!guardedMatch) return [];

    const guardedContent = guardedMatch[1];
    const attributes = guardedContent.match(/['"]([^'"]+)['"]/g);
    return attributes ? attributes.map(attr => attr.slice(1, -1)) : [];
  }

  /**
   * Get model casts
   */
  private getModelCasts(node: SyntaxNode, content: string): Record<string, string> {
    const castsMatch = content.match(/protected\s+\$casts\s*=\s*\[(.*?)\]/s);
    if (!castsMatch) return {};

    const castsContent = castsMatch[1];
    const casts: Record<string, string> = {};

    // Parse key => value pairs
    const pairMatches = castsContent.match(/['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]/g);
    if (pairMatches) {
      for (const pair of pairMatches) {
        const match = pair.match(/['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]/);
        if (match) {
          casts[match[1]] = match[2];
        }
      }
    }

    return casts;
  }

  /**
   * Get model hidden attributes
   */
  private getModelHidden(node: SyntaxNode, content: string): string[] {
    const hiddenMatch = content.match(/protected\s+\$hidden\s*=\s*\[(.*?)\]/s);
    if (!hiddenMatch) return [];

    const hiddenContent = hiddenMatch[1];
    const attributes = hiddenContent.match(/['"]([^'"]+)['"]/g);
    return attributes ? attributes.map(attr => attr.slice(1, -1)) : [];
  }

  /**
   * Get model scopes
   */
  private getModelScopes(node: SyntaxNode, content: string): string[] {
    const scopes: string[] = [];

    // Find all scope methods in the class
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName && methodName.startsWith('scope') && methodName.length > 5) {
          // Extract scope name: scopeActive -> active
          const scopeName = methodName.substring(5).toLowerCase();
          scopes.push(scopeName);
        }
      }
    });

    return scopes;
  }

  /**
   * Get model mutators (setters)
   */
  private getModelMutators(node: SyntaxNode, content: string): string[] {
    const mutators: string[] = [];

    // Find all mutator methods in the class
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName && methodName.startsWith('set') && methodName.endsWith('Attribute')) {
          // Extract attribute name: setPasswordAttribute -> password
          const attributeName = methodName.substring(3, methodName.length - 9);
          const snakeCaseName = this.camelToSnakeCase(attributeName);
          mutators.push(snakeCaseName);
        }
      }
    });

    return mutators;
  }

  /**
   * Get model accessors (getters)
   */
  private getModelAccessors(node: SyntaxNode, content: string): string[] {
    const accessors: string[] = [];

    // Find all accessor methods in the class
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName && methodName.startsWith('get') && methodName.endsWith('Attribute')) {
          // Extract attribute name: getFirstNameAttribute -> first_name
          const attributeName = methodName.substring(3, methodName.length - 9);
          const snakeCaseName = this.camelToSnakeCase(attributeName);
          accessors.push(snakeCaseName);
        }
      }
    });

    return accessors;
  }

  /**
   * Convert camelCase to snake_case
   */
  private camelToSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  /**
   * Get middleware handle method
   */
  private getMiddlewareHandleMethod(node: SyntaxNode, content: string): string | null {
    let handleMethod = null;
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'handle') {
          handleMethod = content.slice(child.startIndex, child.endIndex);
        }
      }
    });
    return handleMethod;
  }

  /**
   * Get middleware parameters
   */
  private getMiddlewareParameters(node: SyntaxNode, content: string): string[] {
    const parameters: string[] = [];

    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'handle') {
          // Find the parameter list for the handle method
          this.traverseNode(child, paramNode => {
            if (paramNode.type === 'formal_parameters') {
              const paramContent = content.slice(paramNode.startIndex, paramNode.endIndex);

              // Parse parameters: handle($request, Closure $next, $role, $permission)
              // We want everything after $request and Closure $next
              const paramMatches = paramContent.match(/\$(\w+)/g);
              if (paramMatches && paramMatches.length > 2) {
                // Skip $request and $next (first two parameters)
                for (let i = 2; i < paramMatches.length; i++) {
                  const param = paramMatches[i].substring(1); // Remove $
                  parameters.push(param);
                }
              }
            }
          });
        }
      }
    });

    return parameters;
  }

  /**
   * Check if middleware is terminable
   */
  private isTerminableMiddleware(node: SyntaxNode, content: string): boolean {
    let hasTerminateMethod = false;

    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'terminate') {
          hasTerminateMethod = true;
        }
      }
    });

    return hasTerminateMethod;
  }

  /**
   * Check if middleware is global
   */
  private isGlobalMiddleware(filePath: string): boolean {
    // This is a simplified check based on file location
    return (
      filePath.includes('/app/Http/Middleware/') &&
      (filePath.includes('TrustProxies') || filePath.includes('EncryptCookies'))
    );
  }

  /**
   * Check if middleware is route middleware
   */
  private isRouteMiddleware(content: string, className: string): boolean {
    // This is a simplified implementation
    return true;
  }

  /**
   * Get middleware group
   */
  private getMiddlewareGroup(content: string, className: string): string | null {
    // This is a simplified implementation
    return null;
  }

  /**
   * Get job handle method
   */
  private getJobHandleMethod(node: SyntaxNode, content: string): string | null {
    let handleMethod = null;
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'handle') {
          handleMethod = content.slice(child.startIndex, child.endIndex);
        }
      }
    });
    return handleMethod;
  }

  /**
   * Get job queue connection
   */
  private getJobQueueConnection(node: SyntaxNode, content: string): string | null {
    const connectionMatch = content.match(/public\s+\$connection\s*=\s*['"]([^'"]+)['"]/);
    return connectionMatch ? connectionMatch[1] : null;
  }

  /**
   * Get job attempts
   */
  private getJobAttempts(node: SyntaxNode, content: string): number | null {
    const attemptsMatch = content.match(/public\s+\$tries\s*=\s*(\d+)/);
    return attemptsMatch ? parseInt(attemptsMatch[1], 10) : null;
  }

  /**
   * Get job timeout
   */
  private getJobTimeout(node: SyntaxNode, content: string): number | null {
    const timeoutMatch = content.match(/public\s+\$timeout\s*=\s*(\d+)/);
    return timeoutMatch ? parseInt(timeoutMatch[1], 10) : null;
  }

  /**
   * Check if job is dispatchable
   */
  private isDispatchableJob(content: string, className: string): boolean {
    return content.includes('use Dispatchable');
  }

  /**
   * Check if job is serializable
   */
  private isSerializableJob(content: string, className: string): boolean {
    return content.includes('use SerializesModels');
  }

  /**
   * Check if job is queueable
   */
  private isQueueableJob(content: string, className: string): boolean {
    return content.includes('use Queueable');
  }

  /**
   * Check if job is batchable
   */
  private isBatchableJob(content: string, className: string): boolean {
    // Check for Batchable trait usage in various forms
    return (
      content.includes('use Batchable') ||
      content.includes('Batchable;') ||
      /use\s+.*Batchable/.test(content)
    );
  }

  /**
   * Get job queue name
   */
  private getJobQueue(node: SyntaxNode, content: string): string | null {
    const queueMatch = content.match(/public\s+\$queue\s*=\s*['"]([^'"]+)['"]/);
    return queueMatch ? queueMatch[1] : null;
  }

  /**
   * Get job delay
   */
  private getJobDelay(node: SyntaxNode, content: string): number | null {
    const delayMatch = content.match(/public\s+\$delay\s*=\s*(\d+)/);
    return delayMatch ? parseInt(delayMatch[1], 10) : null;
  }

  /**
   * Check if job has failed method
   */
  private hasFailedMethod(node: SyntaxNode, content: string): boolean {
    let hasFailedMethod = false;

    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'failed') {
          hasFailedMethod = true;
        }
      }
    });

    return hasFailedMethod;
  }

  /**
   * Get provider register method
   */
  private getProviderRegisterMethod(node: SyntaxNode, content: string): string | null {
    let registerMethod = null;
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'register') {
          registerMethod = content.slice(child.startIndex, child.endIndex);
        }
      }
    });
    return registerMethod;
  }

  /**
   * Get provider boot method
   */
  private getProviderBootMethod(node: SyntaxNode, content: string): string | null {
    let bootMethod = null;
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'boot') {
          bootMethod = content.slice(child.startIndex, child.endIndex);
        }
      }
    });
    return bootMethod;
  }

  /**
   * Get provider bindings
   */
  private getProviderBindings(node: SyntaxNode, content: string): string[] {
    // This is a simplified implementation
    return [];
  }

  /**
   * Check if provider is deferred
   */
  private isDeferredProvider(content: string, className: string): boolean {
    return content.includes('protected $defer = true');
  }

  /**
   * Get provider provides
   */
  private getProviderProvides(content: string, className: string): string[] {
    const provides: string[] = [];

    // Find the provides() method and extract the returned array
    const providesMethodMatch = content.match(/public\s+function\s+provides\(\)\s*\{([^}]+)\}/s);
    if (providesMethodMatch) {
      const methodBody = providesMethodMatch[1];

      // Look for return statement with array
      const returnMatch = methodBody.match(/return\s*\[([^\]]+)\]/s);
      if (returnMatch) {
        const arrayContent = returnMatch[1];

        // Extract string values from the array
        const serviceMatches = arrayContent.match(/['"]([^'"]+)['"]/g);
        if (serviceMatches) {
          for (const match of serviceMatches) {
            const service = match.slice(1, -1); // Remove quotes
            provides.push(service);
          }
        }
      }
    }

    return provides;
  }

  /**
   * Get command signature
   */
  private getCommandSignature(node: SyntaxNode, content: string): string | null {
    const signatureMatch = content.match(/protected\s+\$signature\s*=\s*['"]([^'"]+)['"]/);
    return signatureMatch ? signatureMatch[1] : null;
  }

  /**
   * Get command description
   */
  private getCommandDescription(node: SyntaxNode, content: string): string | null {
    const descriptionMatch = content.match(/protected\s+\$description\s*=\s*['"]([^'"]+)['"]/);
    return descriptionMatch ? descriptionMatch[1] : null;
  }

  /**
   * Get command handle method
   */
  private getCommandHandleMethod(node: SyntaxNode, content: string): string | null {
    let handleMethod = null;
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration') {
        const methodName = this.getMethodName(child, content);
        if (methodName === 'handle') {
          handleMethod = content.slice(child.startIndex, child.endIndex);
        }
      }
    });
    return handleMethod;
  }

  /**
   * Get command arguments
   */
  private getCommandArguments(signature: string | null): string[] {
    if (!signature) return [];

    const argMatches = signature.match(/\{([^}]+)\}/g);
    if (!argMatches) return [];

    const args: string[] = [];
    for (const match of argMatches) {
      const content = match.slice(1, -1); // Remove { }

      // Skip options (that start with --)
      if (content.trim().startsWith('--')) continue;

      // Extract argument name (everything before : or space)
      const nameMatch = content.match(/^([^:\s]+)/);
      if (nameMatch) {
        args.push(nameMatch[1]);
      }
    }

    return args;
  }

  /**
   * Get command options
   */
  private getCommandOptions(signature: string | null): string[] {
    if (!signature) return [];

    const options: string[] = [];
    const argMatches = signature.match(/\{([^}]+)\}/g);
    if (!argMatches) return [];

    for (const match of argMatches) {
      const content = match.slice(1, -1); // Remove { }

      // Only process options (that start with --)
      if (!content.trim().startsWith('--')) continue;

      // Extract option name: --format=csv -> format, --force -> force
      const optionMatch = content.match(/--([^=:\s]+)/);
      if (optionMatch) {
        options.push(optionMatch[1]);
      }
    }

    return options;
  }

  // Required implementations from ChunkedParser and BaseParser

  /**
   * Get supported file extensions for Laravel parser
   */
  getSupportedExtensions(): string[] {
    return ['.php'];
  }

  /**
   * Get chunk boundaries for large PHP files
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries = [];
    const lines = content.split('\n');
    let currentSize = 0;
    let currentLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineSize = lines[i].length + 1; // +1 for newline

      if (currentSize + lineSize > maxChunkSize && currentLine < i) {
        // Look for good break points (end of class/function)
        let breakPoint = i;
        for (let j = i; j >= currentLine; j--) {
          const line = lines[j].trim();
          if (line === '}' || line.startsWith('<?php') || line.startsWith('namespace')) {
            breakPoint = j + 1;
            break;
          }
        }
        boundaries.push(breakPoint);
        currentLine = breakPoint;
        currentSize = 0;
      } else {
        currentSize += lineSize;
      }
    }

    return boundaries;
  }

  /**
   * Merge results from multiple chunks
   */
  protected mergeChunkResults(
    chunks: ParseResult[],
    chunkMetadata: ChunkResult[]
  ): MergedParseResult {
    const merged: MergedParseResult = {
      symbols: [],
      dependencies: [],
      imports: [],
      exports: [],
      errors: [],
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunkMetadata.length,
        duplicatesRemoved: 0,
        crossChunkReferencesFound: 0,
      },
    };

    for (const chunk of chunks) {
      merged.symbols.push(...chunk.symbols);
      merged.dependencies.push(...chunk.dependencies);
      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    // Remove duplicates and count them
    const originalSymbolCount = merged.symbols.length;
    merged.symbols = this.removeDuplicateSymbols(merged.symbols);
    if (merged.metadata) {
      merged.metadata.duplicatesRemoved = originalSymbolCount - merged.symbols.length;
    }

    return merged;
  }

  /**
   * Extract PHP symbols from AST (delegate to base parser for standard symbols)
   */
  protected extractSymbols(rootNode: SyntaxNode, content: string): any[] {
    return this.extractBasicSymbols(rootNode, content);
  }

  /**
   * Extract PHP dependencies from AST
   */
  protected extractDependencies(rootNode: SyntaxNode, content: string): any[] {
    return this.extractBasicDependencies(rootNode, content);
  }

  /**
   * Extract PHP imports from AST (use statements, include/require)
   */
  protected extractImports(rootNode: SyntaxNode, content: string): any[] {
    return this.extractBasicImports(rootNode, content);
  }

  /**
   * Extract PHP exports from AST
   */
  protected extractExports(rootNode: SyntaxNode, content: string): any[] {
    return this.extractBasicExports(rootNode, content);
  }

  /**
   * Check if a node represents a route group
   */
  private isRouteGroup(node: SyntaxNode): boolean {
    // Check for Route::middleware()->group() or Route::group() calls
    if (node.type === 'member_call_expression') {
      // Check if this is a call to 'group' method
      for (const child of node.children) {
        if (child.type === 'name' && child.text === 'group') {
          // Check if this is chained from Route::middleware or directly Route::group
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get middleware from route group definition
   */
  private getRouteGroupMiddleware(node: SyntaxNode, content: string): string[] {
    let statementNode = node;
    while (statementNode.parent && statementNode.parent.type !== 'program') {
      statementNode = statementNode.parent;
    }

    const statementContent = content.slice(statementNode.startIndex, statementNode.endIndex);

    // Try array notation: Route::middleware(['web', 'auth'])->group()
    const arrayMatches = statementContent.match(/Route::middleware\(\s*\[(.*?)\]\s*\)->group/);
    if (arrayMatches) {
      const middlewareList = arrayMatches[1];
      const items = middlewareList
        .split(',')
        .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(item => item.length > 0);
      return items;
    }

    // Try string notation: Route::middleware('web')->group()
    const stringMatches = statementContent.match(/Route::middleware\(\s*['"]([^'"]+)['"]\s*\)->group/);
    if (stringMatches) {
      return [stringMatches[1]];
    }

    return [];
  }

  // Helper methods for parsing

  /**
   * Get chained method name from member call expression
   */
  private getChainedMethodName(node: SyntaxNode): string | null {
    for (const child of node.children) {
      if (child.type === 'name') {
        return child.text;
      }
    }
    return null;
  }

  /**
   * Get method arguments from method call
   */
  private getMethodArguments(node: SyntaxNode, content: string): string[] {
    const args: string[] = [];
    for (const child of node.children) {
      if (child.type === 'arguments') {
        for (const arg of child.children) {
          if (
            arg.type === 'array_creation_expression' ||
            arg.type === 'string' ||
            arg.type === 'encapsed_string'
          ) {
            args.push(content.slice(arg.startIndex, arg.endIndex));
          }
        }
      }
    }
    return args;
  }

  /**
   * Parse array elements from array string
   */
  private parseArrayElements(arrayStr: string): string[] {
    // Remove brackets and split by comma
    const inner = arrayStr.slice(1, -1).trim();
    if (!inner) return [];

    const elements = inner.split(',').map(elem => {
      return elem.trim().replace(/^['"]|['"]$/g, '');
    });

    return elements.filter(elem => elem.length > 0);
  }

  /**
   * Check if ERROR node contains controller patterns
   */
  private hasControllerPatternInError(content: string, node: SyntaxNode): boolean {
    const nodeText = content.slice(node.startIndex, node.endIndex);
    return /class\s+\w+Controller\s+extends\s+(Controller|BaseController)/.test(nodeText);
  }

  /**
   * Parse controller from ERROR node using text patterns
   */
  private parseControllerFromError(
    node: SyntaxNode,
    filePath: string,
    content: string
  ): LaravelController | null {
    try {
      const nodeText = content.slice(node.startIndex, node.endIndex);

      // Extract class name using regex
      const classMatch = nodeText.match(
        /class\s+(\w+Controller)\s+extends\s+(Controller|BaseController)/
      );
      if (!classMatch) return null;

      const className = classMatch[1];

      // Extract method names from the malformed code
      const actions: string[] = [];
      const methodMatches = nodeText.matchAll(/public\s+function\s+(\w+)\s*\(/g);
      for (const match of methodMatches) {
        if (match[1] && !match[1].startsWith('__')) {
          actions.push(match[1]);
        }
      }

      return {
        type: 'controller',
        name: className,
        filePath,
        framework: 'laravel',
        actions,
        middleware: [], // Can't reliably extract from malformed code
        resourceController: false, // Can't determine from malformed code
        metadata: {
          namespace: this.getClassNamespace(content),
          traits: [],
          dependencies: [],
          isApiController: this.isApiController(filePath, content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          malformed: true, // Flag to indicate this was extracted from malformed code
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse controller from ERROR node`, { error: error.message });
      return null;
    }
  }

  // Missing Laravel entity extraction methods from improvement plan

  /**
   * Extract Laravel Form Request classes
   */
  private async extractFormRequests(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelFormRequest[]> {
    const formRequests: LaravelFormRequest[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('extends FormRequest')) {
          const formRequest = this.parseFormRequest(node, content, filePath);
          if (formRequest) {
            formRequests.push(formRequest);
          }
        }
      }
    });

    return formRequests;
  }

  private parseFormRequest(
    node: SyntaxNode,
    content: string,
    filePath: string
  ): LaravelFormRequest | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'form_request',
        name,
        filePath,
        framework: 'laravel',
        rules: this.extractRules(classText),
        messages: this.extractMessages(classText),
        authorize: classText.includes('function authorize'),
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse form request`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Event classes
   */
  private async extractLaravelEvents(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelEvent[]> {
    const events: LaravelEvent[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('ShouldBroadcast')) {
          const event = this.parseEvent(node, content, filePath);
          if (event) {
            events.push(event);
          }
        }
      }
    });

    return events;
  }

  private parseEvent(node: SyntaxNode, content: string, filePath: string): LaravelEvent | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'event',
        name,
        filePath,
        framework: 'laravel',
        shouldBroadcast: classText.includes('ShouldBroadcast'),
        broadcastType: classText.includes('ShouldBroadcastNow')
          ? 'ShouldBroadcastNow'
          : 'ShouldBroadcast',
        channels: this.extractChannels(classText),
        broadcastWith: {},
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse event`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Mail classes
   */
  private async extractLaravelMail(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelMail[]> {
    const mailClasses: LaravelMail[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('extends Mailable')) {
          const mail = this.parseMail(node, content, filePath);
          if (mail) {
            mailClasses.push(mail);
          }
        }
      }
    });

    return mailClasses;
  }

  private parseMail(node: SyntaxNode, content: string, filePath: string): LaravelMail | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'mail',
        name,
        filePath,
        framework: 'laravel',
        shouldQueue: classText.includes('ShouldQueue'),
        view: this.extractView(classText),
        subject: this.extractSubject(classText),
        markdown: classText.includes('markdown('),
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse mail`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Policy classes
   */
  private async extractLaravelPolicies(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelPolicy[]> {
    const policies: LaravelPolicy[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('Policy') || filePath.includes('/Policies/')) {
          const policy = this.parsePolicy(node, content, filePath);
          if (policy) {
            policies.push(policy);
          }
        }
      }
    });

    return policies;
  }

  private parsePolicy(node: SyntaxNode, content: string, filePath: string): LaravelPolicy | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'policy',
        name,
        filePath,
        framework: 'laravel',
        methods: this.getPublicMethods(node, content),
        model: this.extractPolicyModel(classText),
        usesHandlesAuthorization: classText.includes('HandlesAuthorization'),
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse policy`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Listener classes
   */
  private async extractLaravelListeners(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelListener[]> {
    const listeners: LaravelListener[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('function handle') || filePath.includes('/Listeners/')) {
          const listener = this.parseListener(node, content, filePath);
          if (listener) {
            listeners.push(listener);
          }
        }
      }
    });

    return listeners;
  }

  private parseListener(
    node: SyntaxNode,
    content: string,
    filePath: string
  ): LaravelListener | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'listener',
        name,
        filePath,
        framework: 'laravel',
        event: this.extractListenerEvent(classText),
        handleMethod: 'handle',
        shouldQueue: classText.includes('ShouldQueue'),
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse listener`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Service classes
   */
  private async extractLaravelServices(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelService[]> {
    const services: LaravelService[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('Service') || filePath.includes('/Services/')) {
          const service = this.parseService(node, content, filePath);
          if (service) {
            services.push(service);
          }
        }
      }
    });

    return services;
  }

  private parseService(node: SyntaxNode, content: string, filePath: string): LaravelService | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      return {
        type: 'service',
        name,
        filePath,
        framework: 'laravel',
        methods: this.getPublicMethods(node, content),
        dependencies: this.extractServiceDependencies(content),
        namespace: this.getClassNamespace(content),
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse service`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Factory classes
   */
  private async extractLaravelFactories(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelFactory[]> {
    const factories: LaravelFactory[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('extends Factory')) {
          const factory = this.parseFactory(node, content, filePath);
          if (factory) {
            factories.push(factory);
          }
        }
      }
    });

    return factories;
  }

  private parseFactory(node: SyntaxNode, content: string, filePath: string): LaravelFactory | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'factory',
        name,
        filePath,
        framework: 'laravel',
        model: this.extractFactoryModel(classText),
        states: this.extractFactoryStates(classText),
        definition: {},
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse factory`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Trait classes
   */
  private async extractLaravelTraits(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelTrait[]> {
    const traits: LaravelTrait[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'trait_declaration') {
        const trait = this.parseTrait(node, content, filePath);
        if (trait) {
          traits.push(trait);
        }
      }
    });

    return traits;
  }

  private parseTrait(node: SyntaxNode, content: string, filePath: string): LaravelTrait | null {
    try {
      const name = this.getTraitName(node, content);
      if (!name) return null;

      return {
        type: 'trait',
        name,
        filePath,
        framework: 'laravel',
        methods: this.getPublicMethods(node, content),
        properties: this.getProperties(node, content),
        uses: this.extractTraitUses(node, content),
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse trait`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Resource classes
   */
  private async extractLaravelResources(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelResource[]> {
    const resources: LaravelResource[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('extends') && classText.includes('Resource')) {
          const resource = this.parseResource(node, content, filePath);
          if (resource) {
            resources.push(resource);
          }
        }
      }
    });

    return resources;
  }

  private parseResource(
    node: SyntaxNode,
    content: string,
    filePath: string
  ): LaravelResource | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'resource',
        name,
        filePath,
        framework: 'laravel',
        toArrayMethod: classText.includes('function toArray') ? 'toArray' : '',
        withMethod: this.extractWithMethod(classText),
        additionalData: {},
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse resource`, { error: error.message });
      return null;
    }
  }

  /**
   * Extract Laravel Observer classes
   */
  private async extractLaravelObservers(
    content: string,
    filePath: string,
    rootNode: SyntaxNode
  ): Promise<LaravelObserver[]> {
    const observers: LaravelObserver[] = [];

    this.traverseNode(rootNode, node => {
      if (node.type === 'class_declaration') {
        const classText = content.substring(node.startIndex, node.endIndex);
        if (classText.includes('Observer') || filePath.includes('/Observers/')) {
          const observer = this.parseObserver(node, content, filePath);
          if (observer) {
            observers.push(observer);
          }
        }
      }
    });

    return observers;
  }

  private parseObserver(
    node: SyntaxNode,
    content: string,
    filePath: string
  ): LaravelObserver | null {
    try {
      const name = this.getClassName(node, content);
      if (!name) return null;

      const classText = content.substring(node.startIndex, node.endIndex);

      return {
        type: 'observer',
        name,
        filePath,
        framework: 'laravel',
        model: this.extractObserverModel(classText),
        observedEvents: this.extractObservedEvents(classText),
        methods: this.getPublicMethods(node, content),
        metadata: {
          namespace: this.getClassNamespace(content),
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
        },
      };
    } catch (error) {
      logger.warn(`Failed to parse observer`, { error: error.message });
      return null;
    }
  }

  // Helper methods for new entity extraction

  private getPublicMethods(node: SyntaxNode, content: string): string[] {
    const methods: string[] = [];
    this.traverseNode(node, child => {
      if (child.type === 'method_declaration' && this.isPublicMethod(child, content)) {
        const methodName = this.getMethodName(child, content);
        if (methodName && !methodName.startsWith('__')) {
          methods.push(methodName);
        }
      }
    });
    return methods;
  }

  private extractRules(classText: string): Record<string, string> {
    // Basic implementation - could be enhanced with AST parsing
    const rules: Record<string, string> = {};
    const rulesMatch = classText.match(/function\s+rules\s*\(\)[\s\S]*?return\s*\[([\s\S]*?)\];/);
    if (rulesMatch) {
      // Parse basic rule patterns - this is a simplified implementation
      const rulesContent = rulesMatch[1];
      const ruleMatches = rulesContent.match(/'([^']*?)'\s*=>\s*'([^']*?)'/g);
      if (ruleMatches) {
        ruleMatches.forEach(match => {
          const [, field, rule] = match.match(/'([^']*?)'\s*=>\s*'([^']*?)'/) || [];
          if (field && rule) {
            rules[field] = rule;
          }
        });
      }
    }
    return rules;
  }

  private extractMessages(classText: string): Record<string, string> {
    const messages: Record<string, string> = {};
    const messagesMatch = classText.match(
      /function\s+messages\s*\(\)[\s\S]*?return\s*\[([\s\S]*?)\];/
    );
    if (messagesMatch) {
      // Basic message extraction - similar to rules
      const messagesContent = messagesMatch[1];
      const messageMatches = messagesContent.match(/'([^']*?)'\s*=>\s*'([^']*?)'/g);
      if (messageMatches) {
        messageMatches.forEach(match => {
          const [, field, message] = match.match(/'([^']*?)'\s*=>\s*'([^']*?)'/) || [];
          if (field && message) {
            messages[field] = message;
          }
        });
      }
    }
    return messages;
  }

  private extractChannels(classText: string): string[] {
    const channels: string[] = [];
    const channelsMatch = classText.match(
      /function\s+broadcastOn\s*\(\)[\s\S]*?return\s*\[([\s\S]*?)\];/
    );
    if (channelsMatch) {
      // Extract channel names - simplified implementation
      const channelsContent = channelsMatch[1];
      const channelMatches = channelsContent.match(/'([^']*?)'/g);
      if (channelMatches) {
        channels.push(...channelMatches.map(match => match.replace(/'/g, '')));
      }
    }
    return channels;
  }

  private extractView(classText: string): string {
    const viewMatch = classText.match(/view\s*\(\s*['"]([^'"]*)['"]/);
    return viewMatch ? viewMatch[1] : '';
  }

  private extractSubject(classText: string): string {
    const subjectMatch = classText.match(/subject\s*\(\s*['"]([^'"]*)['"]/);
    return subjectMatch ? subjectMatch[1] : '';
  }

  private extractPolicyModel(classText: string): string {
    // Extract associated model from policy
    const modelMatch = classText.match(/\$([A-Z][a-zA-Z]*)/);
    return modelMatch ? modelMatch[1] : '';
  }

  private extractListenerEvent(classText: string): string {
    // Extract the event this listener handles
    const eventMatch = classText.match(/function\s+handle\s*\(\s*([A-Z][a-zA-Z]*)/);
    return eventMatch ? eventMatch[1] : '';
  }

  private extractServiceDependencies(content: string): string[] {
    const dependencies: string[] = [];
    const useMatches = content.match(/use\s+([A-Z][a-zA-Z\\]*);/g);
    if (useMatches) {
      dependencies.push(
        ...useMatches
          .map(match => {
            const [, dependency] = match.match(/use\s+([A-Z][a-zA-Z\\]*);/) || [];
            return dependency || '';
          })
          .filter(Boolean)
      );
    }
    return dependencies;
  }

  private extractFactoryModel(classText: string): string {
    const modelMatch = classText.match(/\$model\s*=\s*([A-Z][a-zA-Z]*)/);
    return modelMatch ? modelMatch[1] : '';
  }

  private extractFactoryStates(classText: string): string[] {
    const states: string[] = [];
    const stateMatches = classText.match(/function\s+([a-zA-Z]+)\s*\(/g);
    if (stateMatches) {
      states.push(
        ...stateMatches
          .map(match => {
            const [, state] = match.match(/function\s+([a-zA-Z]+)\s*\(/) || [];
            return state || '';
          })
          .filter(state => state !== 'definition' && state !== '__construct')
      );
    }
    return states;
  }

  private getTraitName(node: SyntaxNode, content: string): string | null {
    for (const child of node.children) {
      if (child.type === 'name') {
        return content.substring(child.startIndex, child.endIndex);
      }
    }
    return null;
  }

  private getProperties(node: SyntaxNode, content: string): string[] {
    const properties: string[] = [];
    this.traverseNode(node, child => {
      if (child.type === 'property_declaration') {
        const propertyText = content.substring(child.startIndex, child.endIndex);
        const propertyMatch = propertyText.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (propertyMatch) {
          properties.push(propertyMatch[1]);
        }
      }
    });
    return properties;
  }

  private extractTraitUses(node: SyntaxNode, content: string): string[] {
    const uses: string[] = [];
    this.traverseNode(node, child => {
      if (child.type === 'use_declaration') {
        const useText = content.substring(child.startIndex, child.endIndex);
        const useMatch = useText.match(/use\s+([A-Z][a-zA-Z]*)/);
        if (useMatch) {
          uses.push(useMatch[1]);
        }
      }
    });
    return uses;
  }

  private extractWithMethod(classText: string): string {
    const withMatch = classText.match(/function\s+(with[A-Z][a-zA-Z]*)/);
    return withMatch ? withMatch[1] : '';
  }

  private extractObserverModel(classText: string): string {
    // Extract associated model from observer filename or content
    const modelMatch = classText.match(/([A-Z][a-zA-Z]*)Observer/);
    return modelMatch ? modelMatch[1] : '';
  }

  private extractObservedEvents(classText: string): string[] {
    const events = [
      'creating',
      'created',
      'updating',
      'updated',
      'saving',
      'saved',
      'deleting',
      'deleted',
      'restoring',
      'restored',
    ];
    return events.filter(event => classText.includes(`function ${event}`));
  }
}
