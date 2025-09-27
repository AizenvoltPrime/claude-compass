import Parser from 'tree-sitter';
import {
  BaseFrameworkParser,
  FrameworkParseOptions,
  FrameworkPattern,
  ParseFileResult,
} from './base-framework';
import {
  FrameworkEntity,
  FrameworkParseResult,
  ExpressRoute,
  FastifyRoute,
} from './base';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

const logger = createComponentLogger('nodejs-parser');

/**
 * Node.js-specific parser for Express and Fastify routes, middleware, and controllers
 */
export class NodeJSParser extends BaseFrameworkParser {
  constructor(parser: Parser) {
    super(parser, 'nodejs');
  }

  /**
   * Get Node.js framework-specific detection patterns
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'express-routes',
        pattern: /(?:app|router)\.(get|post|put|delete|patch|use|all)\s*\(/,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Express.js route definitions',
      },
      {
        name: 'fastify-routes',
        pattern: /fastify\.(get|post|put|delete|patch|options|head)\s*\(/,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Fastify route definitions',
      },
      {
        name: 'express-middleware',
        pattern: /(?:app|router)\.use\s*\(|function\s*\(\s*req\s*,\s*res\s*,\s*next\s*\)/,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Express.js middleware',
      },
      {
        name: 'express-import',
        pattern: /require\s*\(\s*['"]express['"]|import.*from\s*['"]express['"]/,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Express.js import',
      },
      {
        name: 'fastify-import',
        pattern: /require\s*\(\s*['"]fastify['"]|import.*from\s*['"]fastify['"]/,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Fastify import',
      },
      {
        name: 'nodejs-controller',
        pattern: /exports\.\w+\s*=|module\.exports\s*=.*function|class\s+\w*Controller/,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Node.js controller pattern',
      },
      {
        name: 'middleware',
        pattern: /function\s*\(\s*req\s*,\s*res\s*,\s*next\s*\)|middleware|app\.use|router\.use/,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Express.js middleware patterns',
      },
      {
        name: 'controller',
        pattern: /class\s+\w*Controller|exports\.\w+\s*=.*function|controller/i,
        fileExtensions: ['.js', '.ts', '.mjs', '.cjs'],
        description: 'Node.js controller patterns',
      },
    ];
  }

  /**
   * Detect Node.js framework entities
   */
  async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      // Detect server configuration first
      const serverEntities = await this.parseServerConfiguration(content, filePath, options);
      entities.push(...serverEntities);

      // Detect Express routes and middleware
      if (this.hasExpressPatterns(content)) {
        const expressRoutes = await this.parseExpressRoutes(content, filePath, options);
        entities.push(...expressRoutes);

        const expressMiddleware = await this.parseExpressMiddleware(content, filePath, options);
        entities.push(...expressMiddleware);
      }

      // Always check for middleware functions regardless of Express patterns
      // (middleware files might not have app.* or router.* calls)
      const standaloneMiddleware = await this.parseExpressMiddleware(content, filePath, options);
      // Only add if we haven't already processed this file for Express
      if (!this.hasExpressPatterns(content)) {
        entities.push(...standaloneMiddleware);
      }

      // Detect Fastify routes
      if (this.hasFastifyPatterns(content)) {
        const fastifyRoutes = await this.parseFastifyRoutes(content, filePath, options);
        entities.push(...fastifyRoutes);
      }

      // Detect controllers
      if (this.isControllerFile(filePath, content)) {
        const controllers = await this.parseControllers(content, filePath, options);
        entities.push(...controllers);
      }


    } catch (error) {
      logger.error(`Node.js entity detection failed for ${filePath}`, { error });
    }

    return { entities };
  }

  /**
   * Parse server configuration
   */
  private async parseServerConfiguration(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity[]> {
    const servers: FrameworkEntity[] = [];

    try {
      // Look for Express server setup
      const expressServerPattern = /app\.listen\s*\(\s*(\d+|process\.env\.\w+|\w+)\s*[,)]/g;
      let match;
      while ((match = expressServerPattern.exec(content)) !== null) {
        const portMatch = match[1];
        let port = 3000; // default

        if (/^\d+$/.test(portMatch)) {
          port = parseInt(portMatch, 10);
        } else if (portMatch === 'process.env.PORT') {
          port = 3000; // Default when using env var
        }

        servers.push({
          type: 'server',
          name: 'Express Server',
          filePath,
          metadata: {
            framework: 'express',
            port,
            lineNumber: this.getLineNumber(match.index || 0, content),
          },
        });
      }

      // Look for Fastify server setup
      const fastifyServerPattern = /fastify\.listen\s*\(\s*\{[^}]*port:\s*(\d+|process\.env\.\w+|\w+)[^}]*\}/g;
      while ((match = fastifyServerPattern.exec(content)) !== null) {
        const portMatch = match[1];
        let port = 3000;

        if (/^\d+$/.test(portMatch)) {
          port = parseInt(portMatch, 10);
        }

        servers.push({
          type: 'server',
          name: 'Fastify Server',
          filePath,
          metadata: {
            framework: 'fastify',
            port,
            lineNumber: this.getLineNumber(match.index || 0, content),
          },
        });
      }

    } catch (error) {
      logger.error(`Failed to parse server configuration: ${filePath}`, { error });
    }

    return servers;
  }

  /**
   * Parse Express.js routes
   */
  private async parseExpressRoutes(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity[]> {
    const routes: FrameworkEntity[] = [];

    try {
      const tree = this.parser.parse(content);
      const routeCalls = this.findExpressRouteCalls(tree);

      for (const call of routeCalls) {
        try {
          const route = this.parseExpressRouteCall(call, filePath, content);
          if (route) {
            routes.push(route);
          }
        } catch (error) {
          logger.error(`Failed to parse Express route call`, { error, filePath });
        }
      }

    } catch (error) {
      logger.error(`Failed to parse Express routes: ${filePath}`, { error });
    }

    return routes;
  }

  /**
   * Find Express route calls in the AST
   */
  private findExpressRouteCalls(tree: any): any[] {
    const routeCalls: any[] = [];

    if (!tree?.rootNode) return routeCalls;

    const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'use', 'all'];

    const traverse = (node: any) => {
      if (node.type === 'call_expression') {
        const memberExpression = node.children?.[0];

        if (memberExpression?.type === 'member_expression') {
          const object = memberExpression.children?.[0];
          const property = memberExpression.children?.[2];

          const objectName = object?.text;
          const methodName = property?.text;

          // Check for app.get(), router.post(), etc.
          if ((objectName === 'app' || objectName === 'router') &&
              methodName && httpMethods.includes(methodName)) {

            // Extract actual arguments (filter out parentheses and commas)
            const argumentsNode = node.children?.[1];
            const actualArgs = [];
            if (argumentsNode?.children) {
              for (const child of argumentsNode.children) {
                // Skip punctuation tokens
                if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
                  actualArgs.push(child);
                }
              }
            }

            routeCalls.push({
              node,
              object: objectName,
              method: methodName,
              arguments: actualArgs
            });
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return routeCalls;
  }

  /**
   * Parse individual Express route call
   */
  private parseExpressRouteCall(call: any, filePath: string, content: string): FrameworkEntity | null {
    const method = call.method.toUpperCase();
    const args = call.arguments;

    if (args.length === 0) return null;

    // Extract route path (first argument)
    const pathArg = args[0];
    const routePath = this.extractStringLiteral(pathArg);

    if (!routePath) return null;

    // Extract middleware and handler
    let middleware: string[] = [];
    let handler: string | null = null;
    let controller: string | null = null;

    // Skip app.use() calls that are mounting middleware/routers rather than defining routes
    if (method === 'USE' && args.length === 2) {
      // app.use('/path', require('./routes')) or app.use('/path', router) - these are mounting, not routes
      const secondArg = args[1];
      if (secondArg?.type === 'call_expression') {
        // Check if it's require() call - definitely mounting
        const callFunc = secondArg.children?.[0];
        if (callFunc?.text === 'require') {
          return null; // Skip require() mounting
        }
      }
      if (secondArg?.type === 'identifier' && secondArg.text?.includes('router')) {
        return null; // Skip router mounting
      }
    }

    if (args.length === 1) {
      // Only path provided (unusual but possible for .use())
      return null;
    } else if (args.length === 2) {
      // app.get('/path', handler)
      handler = this.extractFunctionName(args[1]);
      controller = this.extractControllerReference(args[1]);
    } else {
      // app.get('/path', middleware1, middleware2, handler)
      for (let i = 1; i < args.length - 1; i++) {
        try {
          const middlewareName = this.extractMiddlewareReference(args[i]) || this.extractFunctionName(args[i]) || this.extractMiddlewareName(args[i]);
          if (middlewareName) {
            // Handle comma-separated middleware names (from arrays)
            if (middlewareName.includes(',')) {
              const names = middlewareName.split(',').map(name => name.trim()).filter(name => name);
              middleware.push(...names);
            } else {
              middleware.push(middlewareName);
            }
          }
        } catch (error) {
          logger.warn('Failed to extract middleware name', { error });
          // Continue processing other middleware
        }
      }
      handler = this.extractFunctionName(args[args.length - 1]);
      controller = this.extractControllerReference(args[args.length - 1]);
    }

    // Validate route syntax - skip routes with syntax errors
    // Be more permissive for TypeScript files since type annotations cause parse errors
    const isTypeScript = filePath.endsWith('.ts');
    if (!isTypeScript && (call.node.hasError || !this.isValidHandler(args[args.length - 1]))) {
      return null; // Skip malformed routes in JavaScript files
    }

    // For TypeScript, only check for truly malformed handlers (not type annotation errors)
    if (isTypeScript && !this.isValidTypeScriptHandler(args[args.length - 1])) {
      return null; // Skip truly malformed handlers
    }

    // Analyze route characteristics
    const isDynamic = routePath.includes(':') || routePath.includes('*');
    const dynamicParams = this.extractRouteParams(routePath);
    const isAsync = this.isAsyncHandler(args[args.length - 1]);
    const hasErrorHandling = this.hasErrorHandling(args[args.length - 1], content);
    const hasSwaggerDoc = this.hasSwaggerDocumentation(call.node, content);
    const swaggerInfo = this.extractSwaggerInfo(call.node, content);
    let hasValidation = false;
    try {
      hasValidation = this.detectValidationPattern(content.slice(call.node.startIndex, call.node.endIndex));
    } catch (error) {
      logger.warn('Failed to detect validation pattern', { error });
    }

    const route: FrameworkEntity = {
      type: 'route',
      name: `${method} ${routePath}`,
      filePath,
      metadata: {
        method,
        path: routePath,
        middleware,
        controller,
        handler,
        dynamic: isDynamic,
        params: dynamicParams,
        isAsync,
        hasErrorHandling,
        framework: 'express',
        object: call.object,
        lineNumber: this.getNodeLineNumber(call.node),
        hasSwaggerDoc,
        swaggerTags: swaggerInfo?.tags || [],
        hasValidation,
        typescript: isTypeScript,
      },
    };

    return route;
  }

  /**
   * Parse Express middleware
   */
  private async parseExpressMiddleware(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity[]> {
    const middleware: FrameworkEntity[] = [];

    try {
      const tree = this.parser.parse(content);

      // Find middleware function definitions
      const middlewareFunctions = this.findMiddlewareFunctions(tree, content);

      for (const func of middlewareFunctions) {
        middleware.push({
          type: 'middleware',
          name: func.name,
          filePath,
          metadata: {
            isAsync: func.isAsync,
            parameters: func.parameters,
            lineNumber: func.lineNumber,
            framework: 'express',
            hasAuth: this.detectAuthPattern(func.content || ''),
            isFactory: func.isFactory,
            hasAuthorization: this.detectAuthorizationPattern(func.content || ''),
            isErrorHandler: func.paramCount === 4,
            paramCount: func.paramCount,
          },
        });
      }

      // Find middleware usage (app.use() calls)
      const middlewareUsage = this.findMiddlewareUsage(tree, content);

      for (const usage of middlewareUsage) {
        middleware.push({
          type: 'middleware',
          name: usage.name,
          filePath,
          metadata: {
            isAsync: false,
            parameters: [],
            lineNumber: usage.lineNumber,
            framework: 'express',
            hasAuth: this.detectAuthPattern(usage.name),
            isFactory: false,
            hasAuthorization: this.detectAuthorizationPattern(usage.name),
            isErrorHandler: false,
            paramCount: 0,
            isUsage: true,
          },
        });
      }

    } catch (error) {
      logger.error(`Failed to parse Express middleware: ${filePath}`, { error });
    }

    return middleware;
  }

  /**
   * Find middleware usage (app.use() calls)
   */
  private findMiddlewareUsage(tree: any, content: string): Array<{
    name: string;
    lineNumber: number;
  }> {
    const usages: any[] = [];

    if (!tree?.rootNode) return usages;

    const traverse = (node: any) => {
      if (node.type === 'call_expression') {
        const memberExpression = node.children?.[0];

        if (memberExpression?.type === 'member_expression') {
          const object = memberExpression.children?.[0];
          const property = memberExpression.children?.[2];

          const objectName = object?.text;
          const methodName = property?.text;

          // Check for app.use() or router.use() calls
          if ((objectName === 'app' || objectName === 'router') && methodName === 'use') {
            // Extract the middleware name from arguments
            const argumentsNode = node.children?.[1];
            const actualArgs = [];
            if (argumentsNode?.children) {
              for (const child of argumentsNode.children) {
                if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
                  actualArgs.push(child);
                }
              }
            }

            // Get the first argument (the middleware)
            if (actualArgs.length > 0) {
              const firstArg = actualArgs[0];
              let middlewareName = this.extractMiddlewareName(firstArg);

              if (middlewareName) {
                usages.push({
                  name: middlewareName,
                  lineNumber: this.getNodeLineNumber(node),
                });
              }
            }
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return usages;
  }

  /**
   * Find middleware functions (req, res, next) => {}
   */
  private findMiddlewareFunctions(tree: any, content: string): Array<{
    name: string;
    isAsync: boolean;
    parameters: string[];
    lineNumber: number;
    paramCount: number;
    isFactory: boolean;
    content?: string;
  }> {
    const functions: any[] = [];

    if (!tree?.rootNode) return functions;

    const traverse = (node: any) => {
      // Function declarations
      if (node.type === 'function_declaration') {
        const nameNode = node.children?.find((child: any) => child.type === 'identifier');
        const params = this.getFunctionParameters(node);

        if (this.isMiddlewareSignature(params) || this.isErrorMiddlewareSignature(params)) {
          const funcContent = content.slice(node.startIndex, node.endIndex);
          functions.push({
            name: nameNode?.text || 'anonymous',
            isAsync: this.isAsyncFunction(node),
            parameters: params.map((p: any) => p.text || 'unknown'),
            lineNumber: this.getNodeLineNumber(node),
            paramCount: params.length,
            isFactory: false,
            content: funcContent,
          });
        }
      }

      // Arrow functions and function expressions in variable declarations
      if (node.type === 'variable_declarator') {
        const nameNode = node.children?.[0];
        const valueNode = node.children?.[2];

        if ((valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression')) {
          const params = this.getFunctionParameters(valueNode);

          if (this.isMiddlewareSignature(params) || this.isErrorMiddlewareSignature(params)) {
            const funcContent = content.slice(valueNode.startIndex, valueNode.endIndex);
            functions.push({
              name: nameNode?.text || 'anonymous',
              isAsync: this.isAsyncFunction(valueNode),
              parameters: params.map((p: any) => p.text || 'unknown'),
              lineNumber: this.getNodeLineNumber(node),
              paramCount: params.length,
              isFactory: false,
              content: funcContent,
            });
          }
        }

        // Check if it's a factory function that returns middleware
        if (valueNode?.type === 'call_expression') {
          // This could be a factory function like requireRole(role)
          const funcContent = content.slice(node.startIndex, node.endIndex);
          if (this.detectMiddlewareFactory(funcContent)) {
            functions.push({
              name: nameNode?.text || 'anonymous',
              isAsync: false,
              parameters: [],
              lineNumber: this.getNodeLineNumber(node),
              paramCount: 0,
              isFactory: true,
              content: funcContent,
            });
          }
        }

        // Check for arrow function factories that return middleware functions
        if (valueNode?.type === 'arrow_function') {
          const funcContent = content.slice(valueNode.startIndex, valueNode.endIndex);
          if (this.detectMiddlewareFactory(funcContent)) {
            functions.push({
              name: nameNode?.text || 'anonymous',
              isAsync: false,
              parameters: [],
              lineNumber: this.getNodeLineNumber(node),
              paramCount: 0,
              isFactory: true,
              content: funcContent,
            });
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return functions;
  }

  /**
   * Parse Fastify routes
   */
  private async parseFastifyRoutes(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity[]> {
    const routes: FrameworkEntity[] = [];

    try {
      const tree = this.parser.parse(content);
      const routeCalls = this.findFastifyRouteCalls(tree);

      for (const call of routeCalls) {
        const route = this.parseFastifyRouteCall(call, filePath, content);
        if (route) {
          routes.push(route);
        }
      }

    } catch (error) {
      logger.error(`Failed to parse Fastify routes: ${filePath}`, { error });
    }

    return routes;
  }

  /**
   * Find Fastify route calls in the AST
   */
  private findFastifyRouteCalls(tree: any): any[] {
    const routeCalls: any[] = [];

    if (!tree?.rootNode) return routeCalls;

    const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

    const traverse = (node: any) => {
      if (node.type === 'call_expression') {
        const memberExpression = node.children?.[0];

        if (memberExpression?.type === 'member_expression') {
          const object = memberExpression.children?.[0];
          const property = memberExpression.children?.[2];

          const objectName = object?.text;
          const methodName = property?.text;

          // Check for fastify.get(), fastify.post(), etc.
          if (objectName === 'fastify' && methodName && httpMethods.includes(methodName)) {

            // Extract actual arguments (filter out parentheses and commas)
            const argumentsNode = node.children?.[1];
            const actualArgs = [];
            if (argumentsNode?.children) {
              for (const child of argumentsNode.children) {
                // Skip punctuation tokens
                if (child.type !== '(' && child.type !== ')' && child.type !== ',') {
                  actualArgs.push(child);
                }
              }
            }

            routeCalls.push({
              node,
              object: objectName,
              method: methodName,
              arguments: actualArgs
            });
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return routeCalls;
  }

  /**
   * Parse individual Fastify route call
   */
  private parseFastifyRouteCall(call: any, filePath: string, content: string): FrameworkEntity | null {
    const method = call.method.toUpperCase();
    const args = call.arguments;

    if (args.length === 0) return null;

    let routePath: string | null = null;
    let handler: string | null = null;
    let schema: any = null;
    let preHandlers: string[] = [];
    let hasAuth = false;

    // Fastify routes can have different signatures:
    // fastify.get('/path', handler)
    // fastify.get('/path', options, handler)
    // fastify.get({ url: '/path', method: 'GET' }, handler)

    if (args.length >= 2) {
      const firstArg = args[0];

      // Check if first argument is a string (path) or object (options)
      if (firstArg.type === 'string' || firstArg.type === 'template_string') {
        routePath = this.extractStringLiteral(firstArg);
        if (args.length === 3) {
          // fastify.get('/path', options, handler)
          const options = this.extractFastifyRouteOptions(args[1], content);
          schema = options.schema;
          preHandlers = options.preHandlers || [];
          hasAuth = options.hasAuth;
        }
        handler = this.extractFunctionName(args[args.length - 1]);
      } else if (firstArg.type === 'object') {
        // Extract URL from options object
        routePath = this.extractUrlFromFastifyOptions(firstArg);
        const options = this.extractFastifyRouteOptions(firstArg, content);
        schema = options.schema;
        preHandlers = options.preHandlers || [];
        hasAuth = options.hasAuth;
        handler = this.extractFunctionName(args[1]);
      }
    }

    if (!routePath) return null;

    // Analyze route characteristics
    const isDynamic = routePath.includes(':') || routePath.includes('*');
    const dynamicParams = this.extractRouteParams(routePath);
    const isAsync = this.isAsyncHandler(args[args.length - 1]);
    const hasSchema = schema !== null;

    const route: FrameworkEntity = {
      type: 'route',
      name: `${method} ${routePath}`,
      filePath,
      metadata: {
        method,
        path: routePath,
        handler,
        dynamic: isDynamic,
        params: dynamicParams,
        isAsync,
        framework: 'fastify',
        hasSchema,
        schema,
        hasAuth,
        preHandlers,
        lineNumber: this.getNodeLineNumber(call.node),
      },
    };

    return route;
  }

  /**
   * Parse controller files
   */
  private async parseControllers(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity[]> {
    const controllers: FrameworkEntity[] = [];

    try {
      const tree = this.parser.parse(content);

      // Find controller class or exported functions
      const controllerMethods = this.findControllerMethods(tree, content);

      // If we found controller methods, create a controller entity
      if (controllerMethods.length > 0) {
        const controllerName = this.extractControllerName(filePath, content);

        controllers.push({
          type: 'controller',
          name: controllerName,
          filePath,
          metadata: {
            methods: controllerMethods.map(m => m.name),
            framework: 'nodejs',
          },
        });

        // Add individual route handlers
        for (const method of controllerMethods) {
          controllers.push({
            type: 'route-handler',
            name: method.name,
            filePath,
            metadata: {
              isAsync: method.isAsync,
              parameters: method.parameters,
              isExported: method.isExported,
              controllerName,
              hasPagination: this.detectPaginationPattern(method.content || ''),
              hasErrorHandling: this.detectErrorHandlingPattern(method.content || ''),
              hasValidation: this.detectValidationPattern(method.content || ''),
              typescript: filePath.endsWith('.ts'),
              lineNumber: method.lineNumber,
            },
          });
        }
      }

    } catch (error) {
      logger.error(`Failed to parse controllers: ${filePath}`, { error });
    }

    return controllers;
  }

  /**
   * Find controller methods in the AST
   */
  private findControllerMethods(tree: any, content: string): Array<{
    name: string;
    isAsync: boolean;
    parameters: string[];
    isExported: boolean;
    controllerName?: string;
    lineNumber: number;
    content?: string;
  }> {
    const methods: any[] = [];

    if (!tree?.rootNode) return methods;

    const traverse = (node: any) => {
      // Class methods
      if (node.type === 'method_definition') {
        const nameNode = node.children?.find((child: any) => child.type === 'property_identifier');
        const params = this.getFunctionParameters(node);

        if (nameNode && this.isControllerMethodSignature(params)) {
          const methodContent = content.slice(node.startIndex, node.endIndex);
          methods.push({
            name: nameNode.text,
            isAsync: this.isAsyncFunction(node),
            parameters: params.map((p: any) => p.text || 'unknown'),
            isExported: true, // Class methods are typically exported via the class
            lineNumber: this.getNodeLineNumber(node),
            content: methodContent,
          });
        }
      }

      // Function declarations that look like controller methods
      if (node.type === 'function_declaration') {
        const nameNode = node.children?.find((child: any) => child.type === 'identifier');
        const params = this.getFunctionParameters(node);

        if (nameNode && this.isControllerMethodSignature(params)) {
          const methodContent = content.slice(node.startIndex, node.endIndex);
          methods.push({
            name: nameNode.text,
            isAsync: this.isAsyncFunction(node),
            parameters: params.map((p: any) => p.text || 'unknown'),
            isExported: this.isExported(node),
            lineNumber: this.getNodeLineNumber(node),
            content: methodContent,
          });
        }
      }

      // Exported functions in module.exports or exports
      if (node.type === 'assignment_expression') {
        const left = node.children?.[0];
        const right = node.children?.[2];

        if (left?.type === 'member_expression' &&
            (right?.type === 'function_expression' || right?.type === 'arrow_function')) {
          const params = this.getFunctionParameters(right);

          if (this.isControllerMethodSignature(params)) {
            const property = left.children?.[2];
            const methodName = property?.text || 'unknown';
            const methodContent = content.slice(right.startIndex, right.endIndex);

            methods.push({
              name: methodName,
              isAsync: this.isAsyncFunction(right),
              parameters: params.map((p: any) => p.text || 'unknown'),
              isExported: true,
              lineNumber: this.getNodeLineNumber(node),
              content: methodContent,
            });
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return methods;
  }

  // Helper methods

  private hasExpressPatterns(content: string): boolean {
    const hasRoutes = this.containsPattern(content, /(?:app|router)\.(get|post|put|delete|patch|use|all)/);
    const hasExpress = this.containsPattern(content, /require\s*\(\s*['"]express['"]|import.*from\s*['"]express['"]/);
    const hasRouter = this.containsPattern(content, /express\.Router\(\)|Router\(\)/);

    return hasRoutes || hasExpress || hasRouter;
  }

  private hasFastifyPatterns(content: string): boolean {
    return this.containsPattern(content, /fastify\.(get|post|put|delete|patch)|require\s*\(\s*['"]fastify['"]/);
  }

  private isControllerFile(filePath: string, content: string): boolean {
    return filePath.toLowerCase().includes('controller') ||
           this.containsPattern(content, /class\s+\w*Controller|exports\.\w+.*function/);
  }

  private extractFunctionName(node: any): string | null {
    if (!node) return null;

    if (node.type === 'identifier') {
      return node.text;
    }

    if (node.type === 'arrow_function' || node.type === 'function_expression') {
      return 'anonymous';
    }

    if (node.type === 'member_expression') {
      const property = node.children?.[2];
      return property?.text || null;
    }

    return null;
  }

  private extractControllerReference(node: any): string | null {
    if (!node) return null;

    if (node.type === 'member_expression') {
      const object = node.children?.[0];
      const property = node.children?.[2];
      const objectName = object?.text;
      const methodName = property?.text;

      if (objectName && methodName) {
        return `${objectName}.${methodName}`;
      }
    }

    return null;
  }

  private extractMiddlewareReference(node: any): string | null {
    if (!node) return null;

    if (node.type === 'member_expression') {
      const object = node.children?.[0];
      const property = node.children?.[2];
      const objectName = object?.text;
      const methodName = property?.text;

      if (objectName && methodName) {
        return `${objectName}.${methodName}`;
      }
    }

    if (node.type === 'identifier') {
      return node.text;
    }

    return null;
  }

  private extractMiddlewareName(node: any): string | null {
    if (!node) return null;

    // Handle array expressions [middleware1, middleware2]
    if (node.type === 'array_expression' || node.type === 'array') {
      const middlewares: string[] = [];
      for (const child of node.children || []) {
        // Skip punctuation tokens
        if (child.type !== '[' && child.type !== ']' && child.type !== ',') {
          const name = this.extractSingleMiddlewareName(child);
          if (name) middlewares.push(name);
        }
      }
      return middlewares.join(', ');
    }

    return this.extractSingleMiddlewareName(node);
  }

  private extractSingleMiddlewareName(node: any): string | null {
    if (!node) return null;

    // Handle call expressions like express.json(), cors(), helmet(), body('name').isLength()
    if (node.type === 'call_expression') {
      const callee = node.children?.[0];
      if (callee?.type === 'member_expression') {
        // For chained calls like body('name').isLength(), get the root function
        const rootCall = this.extractRootFunction(callee);
        if (rootCall) return rootCall;

        // express.json() -> express.json
        const object = callee.children?.[0];
        const property = callee.children?.[2];
        return `${object?.text}.${property?.text}`;
      } else if (callee?.type === 'identifier') {
        // cors() -> cors, body() -> body
        return callee.text;
      }
    }

    return this.extractFunctionName(node);
  }

  private extractRootFunction(memberExpr: any): string | null {
    // For expressions like body('name').isLength().trim(), extract 'body'
    if (memberExpr.type === 'member_expression') {
      const object = memberExpr.children?.[0];
      if (object?.type === 'call_expression') {
        const callee = object.children?.[0];
        if (callee?.type === 'identifier') {
          return callee.text; // Return the root function name like 'body'
        } else if (callee?.type === 'member_expression') {
          // Recursive case for deeply nested calls
          return this.extractRootFunction(callee);
        }
      } else if (object?.type === 'identifier') {
        return object.text;
      } else if (object?.type === 'member_expression') {
        // Recursive case
        return this.extractRootFunction(object);
      }
    }
    return null;
  }

  private extractRouteParams(routePath: string): string[] {
    const params: string[] = [];
    const paramMatches = routePath.match(/:([^/]+)/g);

    if (paramMatches) {
      for (const match of paramMatches) {
        params.push(match.substring(1)); // Remove the :
      }
    }

    return params;
  }

  private isValidHandler(handlerNode: any): boolean {
    if (!handlerNode) return false;

    // Check if it's a function expression or arrow function with proper syntax
    if (handlerNode.type === 'arrow_function' || handlerNode.type === 'function_expression') {
      // Check if the node has syntax errors
      return !handlerNode.hasError;
    }

    // Other types (identifiers, member expressions) are generally valid
    return true;
  }

  private isValidTypeScriptHandler(handlerNode: any): boolean {
    if (!handlerNode) return false;

    // For TypeScript, be more permissive since type annotations cause parse errors
    // Only reject if it's clearly not a function-like node
    const validTypes = [
      'arrow_function',
      'function_expression',
      'identifier',
      'member_expression',
      'call_expression',
      'binary_expression', // TypeScript type annotations parse as binary expressions
      'ERROR' // TypeScript syntax often causes ERROR nodes that are still valid handlers
    ];

    return validTypes.includes(handlerNode.type);
  }

  private isAsyncHandler(handlerNode: any): boolean {
    if (!handlerNode) return false;

    return handlerNode.children?.some((child: any) => child.text === 'async') || false;
  }

  private hasErrorHandling(handlerNode: any, content: string): boolean {
    if (!handlerNode) return false;

    const handlerContent = content.slice(handlerNode.startIndex, handlerNode.endIndex);
    return /try\s*\{|catch\s*\(|\.catch\s*\(|next\s*\(/i.test(handlerContent);
  }

  private hasSwaggerDocumentation(routeNode: any, content: string): boolean {
    // Look for Swagger/OpenAPI comments above the route
    const startLine = routeNode.startPosition?.row || 0;
    const lines = content.split('\n');

    // Check up to 30 lines above the route (Swagger docs can be long)
    for (let i = Math.max(0, startLine - 30); i < startLine; i++) {
      const line = lines[i];
      if (line && (line.includes('@swagger') || line.includes('* @swagger'))) {
        return true;
      }
    }

    return false;
  }

  private extractSwaggerInfo(routeNode: any, content: string): { tags?: string[] } | null {
    const startLine = routeNode.startPosition?.row || 0;
    const lines = content.split('\n');
    const tags: string[] = [];

    // Look for swagger tags in comments above the route
    for (let i = Math.max(0, startLine - 30); i < startLine; i++) {
      const line = lines[i];
      if (line?.includes('tags:')) {
        // Handle both formats: tags: [Users] and * tags: [Users]
        const tagMatch = line.match(/\*?\s*tags:\s*\[([^\]]+)\]/);
        if (tagMatch) {
          const tagList = tagMatch[1].split(',').map(t => t.trim().replace(/['"`]/g, ''));
          tags.push(...tagList);
        }
      }
    }

    return tags.length > 0 ? { tags } : null;
  }

  private extractFastifyRouteOptions(optionsNode: any, content: string): {
    schema?: any;
    preHandlers?: string[];
    hasAuth: boolean;
  } {
    const result: any = { hasAuth: false };

    if (!optionsNode) return result;

    const optionsContent = content.slice(optionsNode.startIndex, optionsNode.endIndex);

    // Check for schema property
    if (optionsContent.includes('schema:')) {
      result.schema = true; // Simplified - could parse actual schema
    }

    // Check for preHandler property
    const preHandlerMatch = optionsContent.match(/preHandler:\s*([^,}]+)/);
    if (preHandlerMatch) {
      let preHandlerText = preHandlerMatch[1].trim();

      // Extract function name from call expressions like 'fastify.auth([fastify.verifyJWT])'
      if (preHandlerText.includes('(')) {
        const functionNameMatch = preHandlerText.match(/^([^(]+)/);
        if (functionNameMatch) {
          preHandlerText = functionNameMatch[1].trim();
        }
      }

      result.preHandlers = [preHandlerText];
      result.hasAuth = preHandlerText.includes('auth') || preHandlerText.includes('JWT');
    }

    return result;
  }

  private getFunctionParameters(functionNode: any): any[] {
    const params = functionNode.children?.find((child: any) => child.type === 'formal_parameters');
    return params?.children?.filter((child: any) => child.type === 'identifier') || [];
  }

  private isMiddlewareSignature(params: any[]): boolean {
    // Check if function has (req, res, next) signature
    if (params.length !== 3) return false;

    const paramNames = params.map((p: any) => p.text?.toLowerCase());
    return paramNames[0]?.startsWith('req') &&
           paramNames[1]?.startsWith('res') &&
           paramNames[2]?.startsWith('next');
  }

  private isErrorMiddlewareSignature(params: any[]): boolean {
    // Check if function has (err, req, res, next) signature
    if (params.length !== 4) return false;

    const paramNames = params.map((p: any) => p.text?.toLowerCase());
    return paramNames[0]?.startsWith('err') &&
           paramNames[1]?.startsWith('req') &&
           paramNames[2]?.startsWith('res') &&
           paramNames[3]?.startsWith('next');
  }

  private isControllerMethodSignature(params: any[]): boolean {
    // Controller methods typically have (req, res) or (req, res, next) signature
    if (params.length < 2) return false;

    const paramNames = params.map((p: any) => p.text?.toLowerCase());
    return paramNames[0]?.startsWith('req') && paramNames[1]?.startsWith('res');
  }

  private isAsyncFunction(node: any): boolean {
    return node.children?.some((child: any) => child.text === 'async') || false;
  }

  private getNodeLineNumber(node: any): number {
    return node.startPosition?.row + 1 || 0;
  }

  protected getLineNumber(position: number, content: string): number {
    return content.slice(0, position).split('\n').length;
  }

  private extractUrlFromFastifyOptions(optionsNode: any): string | null {
    // Extract 'url' property from Fastify options object
    if (!optionsNode || optionsNode.type !== 'object') return null;

    for (const child of optionsNode.children || []) {
      if (child.type === 'pair') {
        const key = child.children?.[0];
        const value = child.children?.[2];

        if (key?.text === 'url' || key?.text === '"url"' || key?.text === "'url'") {
          return this.extractStringLiteral(value);
        }
      }
    }

    return null;
  }

  private extractControllerName(filePath: string, content: string): string {
    // Try to extract class name first
    const classMatch = content.match(/class\s+(\w*Controller)/);
    if (classMatch) {
      return classMatch[1];
    }

    // Fall back to filename
    const fileName = path.basename(filePath, path.extname(filePath));
    return fileName.charAt(0).toUpperCase() + fileName.slice(1);
  }

  private detectAuthPattern(content: string): boolean {
    return /auth|token|jwt|login|session/i.test(content);
  }

  private detectAuthorizationPattern(content: string): boolean {
    return /role|permission|authorize|admin|access/i.test(content);
  }

  private detectMiddlewareFactory(content: string): boolean {
    return /return\s*\(.*req.*res.*next.*\)|role.*=>/i.test(content);
  }

  private detectPaginationPattern(content: string): boolean {
    return /page|limit|offset|skip|take|findAndCountAll/i.test(content);
  }

  private detectErrorHandlingPattern(content: string): boolean {
    return /try\s*\{|catch\s*\(|\.catch\s*\(|throw|error/i.test(content);
  }

  private detectValidationPattern(content: string): boolean {
    return /validationResult|validate|check|body\(|param\(/i.test(content);
  }

  /**
   * Get chunk boundaries for large files
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const lines = content.split('\n');
    const boundaries: number[] = [0];
    let currentSize = 0;

    for (let i = 0; i < lines.length; i++) {
      currentSize += lines[i].length + 1; // +1 for newline

      if (currentSize > maxChunkSize) {
        boundaries.push(i);
        currentSize = 0;
      }
    }

    if (boundaries[boundaries.length - 1] !== lines.length - 1) {
      boundaries.push(lines.length - 1);
    }

    return boundaries;
  }

  /**
   * Merge results from multiple chunks
   */
  protected mergeChunkResults(chunks: any[]): any {
    const merged = {
      symbols: [] as any[],
      dependencies: [] as any[],
      imports: [] as any[],
      exports: [] as any[],
      errors: [] as any[]
    };

    for (const chunk of chunks) {
      merged.symbols.push(...chunk.symbols);
      merged.dependencies.push(...chunk.dependencies);
      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    return merged;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['.js', '.ts', '.mjs', '.cjs'];
  }

  /**
   * Extract symbols from AST
   */
  protected extractSymbols(rootNode: any, content: string): any[] {
    // For Node.js, symbols are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Extract dependencies from AST
   */
  protected extractDependencies(rootNode: any, content: string): any[] {
    // For Node.js, dependencies are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Extract imports from AST
   */
  protected extractImports(rootNode: any, content: string): any[] {
    // For Node.js, imports are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Extract exports from AST
   */
  protected extractExports(rootNode: any, content: string): any[] {
    // For Node.js, exports are handled in detectFrameworkEntities
    return [];
  }
}