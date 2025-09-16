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
  NextJSRoute,
} from './base';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

const logger = createComponentLogger('nextjs-parser');

/**
 * Next.js-specific parser for pages, API routes, and app router
 */
export class NextJSParser extends BaseFrameworkParser {
  constructor(parser: Parser) {
    super(parser, 'nextjs');
  }

  /**
   * Get Next.js-specific detection patterns
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'nextjs-page',
        pattern: /export\s+default\s+function|getStaticProps|getServerSideProps|getStaticPaths/,
        fileExtensions: ['.js', '.jsx', '.ts', '.tsx'],
        confidence: 0.8,
        description: 'Next.js page component',
      },
      {
        name: 'nextjs-api',
        pattern: /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)|export\s+default\s+(?:async\s+)?function\s*\w*/,
        fileExtensions: ['.js', '.ts'],
        confidence: 0.95,
        description: 'Next.js API route handler',
      },
      {
        name: 'nextjs-app-router',
        pattern: /export\s+(?:const\s+)?metadata|export\s+default\s+function\s+\w+\s*\(\s*\{\s*params/,
        fileExtensions: ['.js', '.jsx', '.ts', '.tsx'],
        confidence: 0.85,
        description: 'Next.js app router component',
      },
      {
        name: 'nextjs-middleware',
        pattern: /export\s+(?:async\s+)?function\s+middleware\s*\(/,
        fileExtensions: ['.js', '.ts'],
        confidence: 0.9,
        description: 'Next.js middleware',
      },
      {
        name: 'nextjs-layout',
        pattern: /export\s+default\s+function\s+\w*Layout|export\s+const\s+metadata/,
        fileExtensions: ['.js', '.jsx', '.ts', '.tsx'],
        confidence: 0.85,
        description: 'Next.js layout component',
      },
      {
        name: 'nextjs-config',
        pattern: /module\.exports\s*=|export\s+default/,
        fileExtensions: ['.js'],
        confidence: 0.7,
        description: 'Next.js configuration file',
      },
    ];
  }

  /**
   * Detect Next.js framework entities
   */
  async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      // Handle pages directory structure (pages/)
      if (this.isPagesRoute(filePath)) {
        const route = await this.parsePageRoute(content, filePath, options);
        if (route) entities.push(route);
      }

      // Handle app directory structure (app/)
      if (this.isAppRoute(filePath)) {
        const route = await this.parseAppRoute(content, filePath, options);
        if (route) entities.push(route);
      }

      // Handle API routes (pages/api/ or app/api/)
      if (this.isApiRoute(filePath)) {
        const routes = await this.parseApiRoutes(content, filePath, options);
        entities.push(...routes);
      }

      // Handle middleware
      if (this.isMiddleware(filePath, content)) {
        const middleware = await this.parseMiddleware(content, filePath, options);
        if (middleware) entities.push(middleware);
      }

      logger.debug(`Detected ${entities.length} Next.js entities in ${filePath}`);

    } catch (error) {
      logger.error(`Next.js entity detection failed for ${filePath}`, { error });
    }

    return { entities };
  }

  /**
   * Parse Next.js page route (pages directory)
   */
  private async parsePageRoute(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<NextJSRoute | null> {
    try {
      const routePath = this.filePathToRoutePath(filePath, 'pages');
      const dynamicSegments = this.extractDynamicSegments(filePath);
      const tree = this.parser.parse(content);

      // Find default export (page component)
      const defaultExport = this.findDefaultExport(tree);
      let componentName = defaultExport?.name || this.extractComponentName(filePath);

      // For pages router, use dynamic segment as component name if present
      if (dynamicSegments.length > 0) {
        const fileName = path.basename(filePath, path.extname(filePath));
        const match = fileName.match(/\[([^\]]+)\]/);
        if (match) {
          componentName = `[${match[1]}]`;
        }
      }

      // Check for data fetching methods
      const hasGetStaticProps = this.containsPattern(content, /export\s+(?:const\s+|async\s+function\s+)?getStaticProps/);
      const hasGetServerSideProps = this.containsPattern(content, /export\s+(?:const\s+|async\s+function\s+)?getServerSideProps/);
      const hasGetStaticPaths = this.containsPattern(content, /export\s+(?:const\s+|async\s+function\s+)?getStaticPaths/);

      // Check for Next.js Image usage
      const usesImage = this.detectImageUsage(content);
      const imageOptimization = usesImage;

      // Build data fetching array
      const dataFetching: string[] = [];
      if (hasGetStaticProps) dataFetching.push('getStaticProps');
      if (hasGetServerSideProps) dataFetching.push('getServerSideProps');
      if (hasGetStaticPaths) dataFetching.push('getStaticPaths');

      // Extract ISR and fallback info
      const isISR = hasGetStaticProps && this.containsPattern(content, /revalidate\s*:\s*\d+/);
      const fallbackMatch = content.match(/fallback\s*:\s*['"]?(\w+)['"]?/);
      const fallback = fallbackMatch ? fallbackMatch[1] : undefined;

      // Convert route path to Express format for the path field
      const expressPath = this.convertToExpressFormat(routePath);

      const route: NextJSRoute = {
        type: 'nextjs-page-route',
        name: componentName,
        filePath,
        path: expressPath,
        component: componentName,
        dynamicSegments,
        framework: 'nextjs',
        metadata: {
          router: 'pages',
          route: routePath,
          routeType: 'page',
          dataFetching,
          hasGetStaticProps,
          hasGetServerSideProps,
          hasGetStaticPaths,
          isStaticGeneration: hasGetStaticProps || hasGetStaticPaths,
          isServerSideRendered: hasGetServerSideProps,
          isr: isISR,
          fallback,
          dynamic: dynamicSegments.length > 0,
          dynamicSegments,
          usesImage,
          imageOptimization,
        },
      };

      return route;

    } catch (error) {
      logger.error(`Failed to parse Next.js page route: ${filePath}`, { error });
      return null;
    }
  }

  /**
   * Parse Next.js app route (app directory)
   */
  private async parseAppRoute(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<NextJSRoute | null> {
    try {
      const routePath = this.filePathToRoutePath(filePath, 'app');
      const dynamicSegments = this.extractDynamicSegments(filePath);
      const tree = this.parser.parse(content);

      // Determine file type in app directory
      const fileName = path.basename(filePath, path.extname(filePath));
      const isPage = fileName === 'page';
      const isLayout = fileName === 'layout';
      const isTemplate = fileName === 'template';
      const isLoading = fileName === 'loading';
      const isError = fileName === 'error';
      const isNotFound = fileName === 'not-found';

      if (!isPage && !isLayout && !isTemplate && !isLoading && !isError && !isNotFound) {
        // Not a route-generating file
        return null;
      }

      // Find default export and get the actual function name from the code
      const defaultExport = this.findDefaultExport(tree);
      let componentName = defaultExport?.name || this.extractComponentName(filePath);

      // For functions like 'export default function RootLayout', extract the actual name
      if (!componentName || componentName === 'default') {
        // Try to extract from export default function Name
        const functionNameMatch = content.match(/export\s+default\s+function\s+(\w+)/);
        if (functionNameMatch) {
          componentName = functionNameMatch[1];
        }
      }

      // Final fallback: extract from file path but make it more descriptive
      if (!componentName || componentName === 'default') {
        componentName = this.extractComponentName(filePath);
      }

      // Check for metadata export
      const hasMetadata = this.containsPattern(content, /export\s+const\s+metadata/);

      // Determine entity type based on file type
      let entityType: string;
      if (isPage) entityType = 'page';
      else if (isLayout) entityType = 'layout';
      else if (isTemplate) entityType = 'template';
      else if (isLoading) entityType = 'loading';
      else if (isError) entityType = 'error';
      else if (isNotFound) entityType = 'not-found';
      else entityType = 'nextjs-page-route';

      const route: NextJSRoute = {
        type: entityType as any,
        name: componentName,
        filePath,
        path: routePath,
        component: componentName,
        dynamicSegments,
        framework: 'nextjs',
        metadata: {
          router: 'app',
          route: routePath,
          fileType: fileName,
          isPage,
          isLayout,
          isTemplate,
          isLoading,
          isError,
          isNotFound,
          hasMetadata,
          dynamic: dynamicSegments.length > 0,
          dynamicSegments,
          serverComponent: !this.containsPattern(content, /^\s*['"]use client['"]/) && !this.containsPattern(content, /^\s*'use client'/),
          clientComponent: this.containsPattern(content, /^\s*['"]use client['"]/) || this.containsPattern(content, /^\s*'use client'/),
          generateMetadata: this.containsPattern(content, /export\s+(?:async\s+)?function\s+generateMetadata/),
          generateStaticParams: this.containsPattern(content, /export\s+(?:async\s+)?function\s+generateStaticParams/),
          hasReset: isError && this.containsPattern(content, /reset\s*(?::|,)/),
          isRoot: isLayout && routePath === '/',
          usesImage: this.detectImageUsage(content),
          imageOptimization: this.detectImageUsage(content),
        },
      };

      return route;

    } catch (error) {
      logger.error(`Failed to parse Next.js app route: ${filePath}`, { error });
      return null;
    }
  }

  /**
   * Parse Next.js API routes
   */
  private async parseApiRoutes(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<NextJSRoute[]> {
    const routes: NextJSRoute[] = [];

    try {
      const tree = this.parser.parse(content);
      const routePath = this.filePathToApiPath(filePath);
      const dynamicSegments = this.extractDynamicSegments(filePath);

      // Find exported HTTP method handlers
      const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

      for (const method of httpMethods) {
        if (this.hasExportedFunction(tree, method)) {
          const route: NextJSRoute = {
            type: 'api-route',
            name: `${method} ${routePath}`,
            filePath,
            path: routePath,
            method,
            handler: method,
            dynamicSegments,
            framework: 'nextjs',
            metadata: {
              route: routePath,
              routeType: 'api',
              method: method,
              httpMethod: method,
              router: filePath.includes('/app/') ? 'app' : 'pages',
              isAppRouter: filePath.includes('/app/'),
              dynamic: dynamicSegments.length > 0,
              hasValidation: this.containsPattern(content, /\.parse\(|zod|yup|joi|ajv/),
            },
          };

          routes.push(route);
        }
      }

      // Handle legacy API routes (default export function)
      if (routes.length === 0 && this.hasDefaultExportFunction(tree)) {
        // For legacy routes, analyze the content to detect which HTTP methods are handled
        const detectedMethods = this.detectHandledMethods(content);

        if (detectedMethods.length > 0) {
          // Create separate route entries for each detected method
          for (const method of detectedMethods) {
            const route: NextJSRoute = {
              type: 'api-route',
              name: `${method} ${routePath}`,
              filePath,
              path: routePath,
              method,
              handler: 'default',
              dynamicSegments,
              framework: 'nextjs',
              metadata: {
                route: routePath,
                routeType: 'api',
                method: method,
                router: filePath.includes('/app/') ? 'app' : 'pages',
                isLegacyHandler: true,
                isAppRouter: filePath.includes('/app/'),
                dynamic: dynamicSegments.length > 0,
              },
            };
            routes.push(route);
          }
        } else {
          // Fallback: create a single route for unknown methods
          const route: NextJSRoute = {
            type: 'api-route',
            name: `API ${routePath}`,
            filePath,
            path: routePath,
            handler: 'default',
            dynamicSegments,
            framework: 'nextjs',
            metadata: {
              route: routePath,
              routeType: 'api',
              method: 'ALL',
              router: filePath.includes('/app/') ? 'app' : 'pages',
              isLegacyHandler: true,
              isAppRouter: filePath.includes('/app/'),
              dynamic: dynamicSegments.length > 0,
            },
          };
          routes.push(route);
        }
      }

    } catch (error) {
      logger.error(`Failed to parse Next.js API routes: ${filePath}`, { error });
    }

    return routes;
  }

  /**
   * Parse Next.js middleware
   */
  private async parseMiddleware(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity | null> {
    try {
      const tree = this.parser.parse(content);

      // Find middleware function
      const middlewareFunction = this.findExportedFunction(tree, 'middleware');
      if (!middlewareFunction) return null;

      // Extract config if present
      const configExport = this.findExportedVariable(tree, 'config');
      let matcher: string[] = [];

      if (configExport) {
        matcher = this.extractMatcherFromConfig(configExport);
      }

      // Detect authentication patterns
      const hasAuth = this.containsPattern(content, /verify|jwt|token|auth|login|session|cookie/i)
        || this.containsPattern(content, /NextResponse\.redirect/)
        || this.containsPattern(content, /request\.cookies/)
        || this.containsPattern(content, /authorization/i);

      return {
        type: 'middleware',
        name: 'middleware',
        filePath,
        metadata: {
          matcher,
          isGlobal: matcher.length === 0,
          hasAuth,
        },
      };

    } catch (error) {
      logger.error(`Failed to parse Next.js middleware: ${filePath}`, { error });
      return null;
    }
  }

  // Helper methods

  /**
   * Check if file is in pages directory and is a route
   */
  private isPagesRoute(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return normalizedPath.includes('/pages/') &&
           !normalizedPath.includes('/pages/api/') &&
           !normalizedPath.includes('/_') &&
           this.hasValidPageExtension(filePath);
  }

  /**
   * Check if file is in app directory and is a route
   */
  private isAppRoute(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const fileName = path.basename(filePath, path.extname(filePath));

    return normalizedPath.includes('/app/') &&
           !normalizedPath.includes('/app/api/') &&
           ['page', 'layout', 'template', 'loading', 'error', 'not-found'].includes(fileName) &&
           this.hasValidPageExtension(filePath);
  }

  /**
   * Check if file is an API route
   */
  private isApiRoute(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return (normalizedPath.includes('/pages/api/') || normalizedPath.includes('/app/api/')) &&
           this.hasValidApiExtension(filePath);
  }

  /**
   * Check if file is middleware
   */
  private isMiddleware(filePath: string, content: string): boolean {
    const fileName = path.basename(filePath, path.extname(filePath));
    return fileName === 'middleware' && this.containsPattern(content, /export\s+(?:async\s+)?function\s+middleware\s*\(/);
  }

  /**
   * Convert file path to Next.js route path
   */
  private filePathToRoutePath(filePath: string, baseDir: 'pages' | 'app'): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const baseDirIndex = normalizedPath.lastIndexOf(`/${baseDir}/`);

    if (baseDirIndex === -1) return '/';

    let routePath = normalizedPath.substring(baseDirIndex + baseDir.length + 1);

    // Remove file extension
    routePath = routePath.replace(/\.(js|jsx|ts|tsx)$/, '');

    // Handle index files
    if (routePath === 'index' || routePath.endsWith('/index')) {
      routePath = routePath.replace(/\/index$|^index$/, '') || '/';
    }

    // Handle app router special files
    if (baseDir === 'app') {
      routePath = routePath.replace(/\/(page|layout|template|loading|error|not-found)$/, '');
    }

    // Keep Next.js format [param] for both pages and app router
    // This preserves the original Next.js dynamic segment notation

    // Ensure starts with /
    if (!routePath.startsWith('/')) {
      routePath = '/' + routePath;
    }

    return routePath;
  }

  /**
   * Convert API file path to API route path
   */
  private filePathToApiPath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, '/');
    let apiIndex = normalizedPath.lastIndexOf('/api/');

    if (apiIndex === -1) return '/api';

    let routePath = normalizedPath.substring(apiIndex);

    // Remove file extension
    routePath = routePath.replace(/\.(js|ts)$/, '');

    // Handle index files
    if (routePath.endsWith('/index')) {
      routePath = routePath.replace('/index', '');
    }

    // Handle app router route files (remove /route suffix)
    if (routePath.endsWith('/route')) {
      routePath = routePath.replace('/route', '');
    }

    // Keep Next.js format [param] as tests expect it
    // Note: Dynamic segments are already handled separately in the dynamicSegments array

    return routePath;
  }

  /**
   * Convert Next.js route format to Express format for path field
   */
  private convertToExpressFormat(nextjsPath: string): string {
    return nextjsPath
      .replace(/\[\.\.\.(.*?)\]/g, '*$1')  // [...slug] -> *slug
      .replace(/\[\[(.*?)\]\]/g, ':$1?')   // [[...slug]] -> :slug?
      .replace(/\[([^\]]+)\]/g, ':$1');    // [id] -> :id
  }

  /**
   * Extract dynamic segments from file path
   */
  private extractDynamicSegments(filePath: string): string[] {
    const segments: string[] = [];

    // Handle optional catch-all routes first: [[...param]]
    const optionalCatchAllMatches = filePath.matchAll(/\[\[\.\.\.([^\]]+)\]\]/g);
    for (const match of optionalCatchAllMatches) {
      segments.push(match[1]);
    }

    // Handle regular dynamic segments and catch-all routes: [param] and [...param]
    // Exclude the optional catch-all patterns we already processed
    const remainingPath = filePath.replace(/\[\[\.\.\.([^\]]+)\]\]/g, '');
    const regularMatches = remainingPath.matchAll(/\[([^\]]+)\]/g);

    for (const match of regularMatches) {
      let segment = match[1];
      if (segment.startsWith('...')) {
        // Catch-all route: remove the ... prefix
        segment = segment.substring(3);
      }
      segments.push(segment);
    }

    return segments;
  }

  /**
   * Find default export in AST
   */
  private findDefaultExport(tree: any): { name?: string; node: any } | null {
    if (!tree?.rootNode) return null;

    const traverse = (node: any): { name?: string; node: any } | null => {
      // Handle normal export statements
      if (node.type === 'export_statement') {
        // Check if this is a default export by looking for 'default' token
        const hasDefault = node.children?.some((child: any) => child.type === 'default');
        if (hasDefault) {
          const exported = node.children?.find((child: any) =>
            child.type === 'function_declaration' ||
            child.type === 'identifier' ||
            child.type === 'arrow_function'
          );

          if (exported) {
            let name: string | undefined;

            if (exported.type === 'function_declaration') {
              name = exported.children?.find((child: any) => child.type === 'identifier')?.text;
            } else if (exported.type === 'identifier') {
              name = exported.text;
            }

            return { name, node: exported };
          }
        }
      }

      // Handle ERROR nodes that might contain export statements (malformed code)
      if (node.type === 'ERROR') {
        // Look for export default pattern in ERROR nodes
        const nodeText = node.text || '';

        // Check if this ERROR node contains an export default function
        if (nodeText.includes('export default function')) {
          // Extract function name from text using regex
          const functionMatch = nodeText.match(/export\s+default\s+function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
          if (functionMatch && functionMatch[1]) {
            return { name: functionMatch[1], node };
          }
        }

        // Check if this ERROR node contains export default identifier
        if (nodeText.includes('export default ')) {
          // Try to find the identifier after 'export default'
          const identifierMatch = nodeText.match(/export\s+default\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
          if (identifierMatch && identifierMatch[1] &&
              identifierMatch[1] !== 'function' &&
              identifierMatch[1] !== 'class' &&
              identifierMatch[1] !== 'const' &&
              identifierMatch[1] !== 'let' &&
              identifierMatch[1] !== 'var') {
            return { name: identifierMatch[1], node };
          }
        }

        // Also traverse children of ERROR nodes
        if (node.children) {
          for (const child of node.children) {
            // Check direct children for export/default/function/identifier patterns
            if (child.type === 'export' || child.type === 'default' || child.type === 'function') {
              // Look for sibling identifier after 'function'
              const siblings = node.children;
              const functionIndex = siblings.findIndex((s: any) => s.type === 'function');
              const identifierAfterFunction = functionIndex >= 0 && functionIndex + 1 < siblings.length
                ? siblings[functionIndex + 1]
                : null;

              if (identifierAfterFunction?.type === 'identifier') {
                return { name: identifierAfterFunction.text, node: identifierAfterFunction };
              }
            }

            const result = traverse(child);
            if (result) return result;
          }
        }
      }

      // Traverse children for all other node types
      if (node.children) {
        for (const child of node.children) {
          const result = traverse(child);
          if (result) return result;
        }
      }

      return null;
    };

    return traverse(tree.rootNode);
  }

  /**
   * Check if AST has exported function with given name
   */
  private hasExportedFunction(tree: any, functionName: string): boolean {
    if (!tree?.rootNode) return false;

    const traverse = (node: any): boolean => {
      // Named export: export function GET() {}
      if (node.type === 'export_statement') {
        const declaration = node.children?.find((child: any) => child.type === 'function_declaration');
        if (declaration) {
          const name = declaration.children?.find((child: any) => child.type === 'identifier')?.text;
          if (name === functionName) return true;
        }

        // Export variable: export const GET = async () => {}
        const lexicalDecl = node.children?.find((child: any) => child.type === 'lexical_declaration');
        if (lexicalDecl) {
          const declarator = lexicalDecl.children?.find((child: any) => child.type === 'variable_declarator');
          if (declarator) {
            const name = declarator.children?.[0]?.text;
            if (name === functionName) return true;
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          if (traverse(child)) return true;
        }
      }

      return false;
    };

    return traverse(tree.rootNode);
  }

  /**
   * Check if AST has default export function
   */
  private hasDefaultExportFunction(tree: any): boolean {
    const defaultExport = this.findDefaultExport(tree);
    return defaultExport !== null;
  }

  /**
   * Find exported function by name
   */
  private findExportedFunction(tree: any, functionName: string): any | null {
    if (!tree?.rootNode) return null;

    const traverse = (node: any): any | null => {
      // Named export: export function middleware() {}
      if (node.type === 'export_statement') {
        const declaration = node.children?.find((child: any) => child.type === 'function_declaration');
        if (declaration) {
          const name = declaration.children?.find((child: any) => child.type === 'identifier')?.text;
          if (name === functionName) return declaration;
        }

        // Export variable: export const middleware = async () => {}
        const lexicalDecl = node.children?.find((child: any) => child.type === 'lexical_declaration');
        if (lexicalDecl) {
          const declarator = lexicalDecl.children?.find((child: any) => child.type === 'variable_declarator');
          if (declarator) {
            const name = declarator.children?.[0]?.text;
            if (name === functionName) return declarator;
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          const result = traverse(child);
          if (result) return result;
        }
      }

      return null;
    };

    return traverse(tree.rootNode);
  }

  /**
   * Find exported variable by name
   */
  private findExportedVariable(tree: any, variableName: string): any | null {
    if (!tree?.rootNode) return null;

    const traverse = (node: any): any | null => {
      if (node.type === 'export_statement') {
        const declaration = node.children?.find((child: any) => child.type === 'lexical_declaration');
        if (declaration) {
          const declarator = declaration.children?.find((child: any) => child.type === 'variable_declarator');
          if (declarator) {
            const name = declarator.children?.[0]?.text;
            if (name === variableName) {
              return declarator.children?.find((child: any) => child.type === 'object'); // Return the value node
            }
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const child of node.children) {
          const result = traverse(child);
          if (result) return result;
        }
      }

      return null;
    };

    return traverse(tree.rootNode);
  }

  /**
   * Extract matcher configuration from middleware config
   */
  private extractMatcherFromConfig(configNode: any): string[] {
    if (!configNode) return [];

    const extractArrayValues = (node: any): string[] => {
      const values: string[] = [];

      if (node.type === 'array') {
        for (const child of node.children || []) {
          if (child.type === 'string' || child.type === 'string_literal') {
            const value = child.text?.replace(/^['"]/,'').replace(/['"]$/, '') || '';
            values.push(value);
          }
        }
      } else if (node.type === 'string' || node.type === 'string_literal') {
        const value = node.text?.replace(/^['"]/,'').replace(/['"]$/, '') || '';
        values.push(value);
      }

      return values;
    };

    const findMatcher = (node: any): string[] => {
      if (node.type === 'object') {
        for (const child of node.children || []) {
          if (child.type === 'pair') {
            const key = child.children?.[0]?.text;
            // Find the array value (skip the colon)
            const value = child.children?.find(c => c.type === 'array');

            if (key === 'matcher' || key === '"matcher"' || key === "'matcher'") {
              return extractArrayValues(value);
            }
          }
        }
      }

      // Traverse deeper if needed
      if (node.children) {
        for (const child of node.children) {
          const result = findMatcher(child);
          if (result.length > 0) return result;
        }
      }

      return [];
    };

    return findMatcher(configNode);
  }

  /**
   * Check if file has valid page extension
   */
  private hasValidPageExtension(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.js', '.jsx', '.ts', '.tsx'].includes(ext);
  }

  /**
   * Check if file has valid API extension
   */
  private hasValidApiExtension(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.js', '.ts'].includes(ext);
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
    return ['.js', '.jsx', '.ts', '.tsx'];
  }

  /**
   * Extract symbols from AST
   */
  protected extractSymbols(rootNode: any, content: string): any[] {
    // For Next.js, symbols are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Extract dependencies from AST
   */
  protected extractDependencies(rootNode: any, content: string): any[] {
    // For Next.js, dependencies are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Extract imports from AST
   */
  protected extractImports(rootNode: any, content: string): any[] {
    // For Next.js, imports are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Extract exports from AST
   */
  protected extractExports(rootNode: any, content: string): any[] {
    // For Next.js, exports are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Detect HTTP methods handled in legacy API routes
   */
  private detectHandledMethods(content: string): string[] {
    const methods: string[] = [];
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    for (const method of httpMethods) {
      let foundMethod = false;

      // Look for switch case statements: case 'GET':
      const casePattern = new RegExp(`case\\s*['"]${method}['"]\\s*:`, 'i');
      if (this.containsPattern(content, casePattern)) {
        foundMethod = true;
      }
      // Look for if statements: if (req.method === 'GET')
      if (!foundMethod && this.containsPattern(content, new RegExp(`req\\.method\\s*===\\s*['"]${method}['"]`, 'i'))) {
        foundMethod = true;
      }
      // Look for if statements: if (method === 'GET')
      if (!foundMethod && this.containsPattern(content, new RegExp(`method\\s*===\\s*['"]${method}['"]`, 'i'))) {
        foundMethod = true;
      }

      if (foundMethod) {
        methods.push(method);
      }
    }

    return methods;
  }

  /**
   * Detect Next.js Image component usage
   */
  private detectImageUsage(content: string): boolean {
    // Check for import statements
    const hasImageImport = this.containsPattern(content, /import\s+Image\s+from\s+['"]next\/image['"]/)
      || this.containsPattern(content, /import\s*\{[^}]*Image[^}]*\}\s*from\s+['"]next\/image['"]/)
      || this.containsPattern(content, /import\s*\*\s*as\s+\w+\s*from\s+['"]next\/image['"]/)
      || this.containsPattern(content, /from\s+['"]next\/image['"]/);

    // Check for JSX usage of Image component
    const hasImageJSX = this.containsPattern(content, /<Image[\s>]/)
      || this.containsPattern(content, /<Image\/>/)
      || this.containsPattern(content, /React\.createElement\s*\(\s*Image/)
      || this.containsPattern(content, /jsx\s*\(\s*Image/);

    return hasImageImport || hasImageJSX;
  }

  /**
   * Override component name extraction for Next.js specific handling
   */
  protected extractComponentName(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));

    // Handle special Next.js app router files
    if (fileName === 'layout') {
      const parentDir = path.basename(path.dirname(filePath));
      if (parentDir === 'app') {
        return 'RootLayout';
      } else {
        return parentDir.charAt(0).toUpperCase() + parentDir.slice(1) + 'Layout';
      }
    }

    if (fileName === 'page') {
      const parentDir = path.basename(path.dirname(filePath));
      return parentDir.charAt(0).toUpperCase() + parentDir.slice(1) + 'Page';
    }

    if (fileName === 'loading') return 'Loading';
    if (fileName === 'error') return 'Error';
    if (fileName === 'not-found') return 'NotFound';
    if (fileName === 'template') return 'Template';

    // Convert kebab-case to PascalCase for component names
    return fileName
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }
}