import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import {
  BaseFrameworkParser,
  FrameworkParseOptions,
  FrameworkPattern,
  ParseFileResult,
} from './base-framework';
import {
  FrameworkEntity,
  FrameworkParseResult,
  ReactComponent,
  ReactHook,
  ReactHOC,
  PropDefinition,
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
} from './base';
import { TypeScriptParser } from './typescript';
import { JavaScriptParser } from './javascript';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

const logger = createComponentLogger('react-parser');

/**
 * React-specific parser for components, hooks, and patterns
 */
export class ReactParser extends BaseFrameworkParser {
  private typescriptParser: TypeScriptParser;
  private javascriptParser: JavaScriptParser;

  constructor(parser: Parser) {
    super(parser, 'react');

    // Create dedicated language parsers for symbol extraction
    this.typescriptParser = new TypeScriptParser();
    this.javascriptParser = new JavaScriptParser();
  }

  /**
   * Override parseFile to provide a fallback when base parsing fails and always detect syntax errors
   */
  async parseFile(filePath: string, content: string, options: FrameworkParseOptions = {}): Promise<ParseFileResult> {
    try {
      // Try the parent parseFile method first
      const result = await super.parseFile(filePath, content, options);

      // Always check for syntax errors regardless of base parsing success
      const syntaxErrors = this.collectSyntaxErrorsFromContent(filePath, content);

      // Merge syntax errors with existing errors
      const allErrors = [...(result.errors || []), ...syntaxErrors];

      // Check if base parsing actually failed (has parse errors and no symbols)
      const hasParseErrors = result.errors?.some(error => error.message === 'Failed to parse syntax tree');
      const hasNoSymbols = result.symbols?.length === 0;

      if (hasParseErrors && hasNoSymbols) {
        logger.warn(`Base parseFile returned parse errors for ${filePath}, using React-specific fallback`);
        return this.parseFileWithFallback(filePath, content, options);
      }

      // Base parsing succeeded, return the result with syntax errors included
      return {
        ...result,
        errors: allErrors
      };
    } catch (error) {
      logger.warn(`Base parseFile failed for ${filePath}, using React-specific fallback`, { error: (error as Error).message });

      // Fallback: Handle parsing entirely within React parser
      return this.parseFileWithFallback(filePath, content, options);
    }
  }

  /**
   * Fallback parsing when base framework parsing fails
   */
  private async parseFileWithFallback(filePath: string, content: string, options: FrameworkParseOptions): Promise<ParseFileResult> {
    try {
      // Configure parser and do our own parsing
      this.configureParserLanguage(filePath);
      const tree = this.parser.parse(content);

      if (!tree || !tree.rootNode) {
        return {
          filePath,
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [{ message: 'Failed to parse syntax tree', line: 1, column: 1, severity: 'error' }],
          frameworkEntities: [],
          metadata: { framework: 'react', isFrameworkSpecific: false }
        };
      }

      // Extract basic symbols using our own parsing
      const symbols = this.extractBasicSymbols(tree.rootNode, content);
      const dependencies = this.extractBasicDependencies(tree.rootNode, content);
      const imports = this.extractBasicImports(tree.rootNode, content);
      const exports = this.extractBasicExports(tree.rootNode, content);
      const errors = this.collectSyntaxErrors(tree.rootNode);

      // Detect framework entities if applicable
      let frameworkEntities: FrameworkEntity[] = [];
      if (!options.skipFrameworkAnalysis && this.isFrameworkApplicable(filePath, content)) {
        const frameworkResult = await this.detectFrameworkEntities(content, filePath, options);
        frameworkEntities = frameworkResult.entities || [];
      }

      return {
        filePath,
        symbols,
        dependencies,
        imports,
        exports,
        errors,
        frameworkEntities,
        metadata: {
          framework: 'react',
          isFrameworkSpecific: frameworkEntities.length > 0
        }
      };
    } catch (error) {
      logger.error(`React fallback parsing also failed for ${filePath}`, { error: (error as Error).message });

      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{ message: `Parsing failed: ${(error as Error).message}`, line: 1, column: 1, severity: 'error' }],
        frameworkEntities: [],
        metadata: { framework: 'react', isFrameworkSpecific: false }
      };
    }
  }

  /**
   * Configure the parser language based on file extension
   */
  private configureParserLanguage(filePath: string): void {
    const ext = path.extname(filePath);

    try {
      if (ext === '.tsx' || ext === '.ts') {
        // Use TypeScript TSX for TypeScript files
        this.parser.setLanguage(TypeScript.tsx);
        logger.debug(`Using TypeScript TSX parser for ${filePath}`);
      } else if (ext === '.jsx') {
        // Use TypeScript JSX for JSX files (better JSX support than JavaScript parser)
        this.parser.setLanguage(TypeScript.tsx);
        logger.debug(`Using TypeScript TSX parser for JSX file ${filePath}`);
      } else {
        // Use JavaScript parser for .js files
        this.parser.setLanguage(JavaScript);
        logger.debug(`Using JavaScript parser for ${filePath}`);
      }
    } catch (error) {
      logger.warn(`Failed to set parser language for ${filePath}, falling back to JavaScript`, { error });
      this.parser.setLanguage(JavaScript);
    }
  }

  /**
   * Get React-specific detection patterns
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'react-component',
        pattern: /export\s+(?:default\s+)?function\s+[A-Z]\w*|const\s+[A-Z]\w*\s*=\s*\(|class\s+[A-Z]\w*\s+extends\s+(?:React\.)?Component/,
        fileExtensions: ['.jsx', '.tsx', '.js', '.ts'],
        description: 'React component (functional or class)',
      },
      {
        name: 'react-hook',
        pattern: /export\s+(?:default\s+)?function\s+use[A-Z]\w*|const\s+use[A-Z]\w*\s*=|use(?:State|Effect|Context|Reducer|Callback|Memo|Ref|LayoutEffect|ImperativeHandle|DebugValue)/,
        fileExtensions: ['.jsx', '.tsx', '.js', '.ts'],
        description: 'React hooks (built-in or custom)',
      },
      {
        name: 'react-hoc',
        pattern: /function\s+with[A-Z]\w*|const\s+with[A-Z]\w*\s*=|export\s+(?:default\s+)?function\s+with[A-Z]\w*/,
        fileExtensions: ['.jsx', '.tsx', '.js', '.ts'],
        description: 'React Higher-Order Component',
      },
      {
        name: 'jsx-elements',
        pattern: /<[A-Z]\w*|<\/[A-Z]\w*>|<\w+\s+[^>]*\/?>|{[\s\S]*}/,
        fileExtensions: ['.jsx', '.tsx'],
        description: 'JSX elements',
      },
      {
        name: 'react-context',
        pattern: /createContext|useContext|Provider|Consumer/,
        fileExtensions: ['.jsx', '.tsx', '.js', '.ts'],
        description: 'React Context usage',
      },
    ];
  }

  /**
   * Detect React framework entities
   */
  async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      // Parse React components
      if (this.isReactComponent(content)) {
        const component = await this.parseReactComponent(content, filePath, options);
        if (component) {
          entities.push(component);
        }
      }

      // Parse custom hooks
      if (this.hasCustomHooks(content)) {
        const hooks = await this.parseCustomHooks(content, filePath, options);
        entities.push(...hooks);
      }

      // Parse HOCs (Higher-Order Components)
      if (this.hasHOCs(content)) {
        const hocs = await this.parseHOCs(content, filePath, options);
        entities.push(...hocs);
      }

      // Parse Context providers
      if (this.hasContextProvider(content)) {
        const contexts = await this.parseContextProviders(content, filePath, options);
        entities.push(...contexts);
      }

      logger.debug(`Detected ${entities.length} React entities in ${filePath}`);

    } catch (error) {
      logger.error(`React entity detection failed for ${filePath}`, { error });
    }

    return { entities };
  }

  /**
   * Parse React component from content
   */
  private async parseReactComponent(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<ReactComponent | null> {
    try {
      // Configure parser language based on file extension
      this.configureParserLanguage(filePath);
      const tree = this.parser.parse(content);

      // Check if parsing succeeded
      if (!tree || !tree.rootNode) {
        logger.error(`Failed to parse React component content: ${filePath}`);
        return null;
      }

      const components = this.findReactComponents(tree);

      if (components.length === 0) return null;

      // Use the main component (usually the first or default export)
      const mainComponent = this.findMainComponent(components, tree);

      if (!mainComponent) return null;

      const componentName = mainComponent.name || this.extractComponentName(filePath);

      // Extract component metadata with error handling
      let props: PropDefinition[] = [];
      let hooks: string[] = [];
      let jsxDependencies: string[] = [];

      try {
        props = await this.extractReactProps(tree, mainComponent);
      } catch (error) {
        logger.warn(`Failed to extract React props for ${componentName}`, { error: (error as Error).message });
        props = [];
      }

      try {
        hooks = this.extractHooksUsage(tree);
      } catch (error) {
        logger.warn(`Failed to extract hooks usage for ${componentName}`, { error: (error as Error).message });
        hooks = [];
      }

      try {
        jsxDependencies = this.extractJSXDependencies(tree);
      } catch (error) {
        logger.warn(`Failed to extract JSX dependencies for ${componentName}`, { error: (error as Error).message });
        jsxDependencies = [];
      }

      // Extract additional metadata for different component types
      const additionalMetadata: any = {};

      if (mainComponent.type === 'class') {
        // Extract class-specific metadata with error handling
        try {
          additionalMetadata.lifecycle = this.extractLifecycleMethods(tree, mainComponent);
        } catch (error) {
          logger.warn(`Failed to extract lifecycle methods for ${componentName}`, { error: (error as Error).message });
          additionalMetadata.lifecycle = [];
        }

        try {
          additionalMetadata.state = this.extractStateProperties(tree, mainComponent);
        } catch (error) {
          logger.warn(`Failed to extract state properties for ${componentName}`, { error: (error as Error).message });
          additionalMetadata.state = [];
        }

        try {
          additionalMetadata.methods = this.extractClassMethods(tree, mainComponent);
        } catch (error) {
          logger.warn(`Failed to extract class methods for ${componentName}`, { error: (error as Error).message });
          additionalMetadata.methods = [];
        }
      }

      // Extract JSX dependencies and add to metadata
      additionalMetadata.jsxDependencies = jsxDependencies;
      additionalMetadata.customHooks = this.extractCustomHooksUsage(hooks);

      // Detect TypeScript usage
      additionalMetadata.typescript = this.isTypeScriptFile(filePath) || this.hasTypeScriptFeatures(tree);

      // Detect advanced React features
      additionalMetadata.hasSuspense = this.hasSuspense(tree);
      additionalMetadata.hasLazy = this.hasLazy(tree);

      const component: ReactComponent = {
        type: 'component',
        name: componentName,
        filePath,
        componentType: mainComponent.type,
        props,
        hooks,
        jsxDependencies,
        metadata: {
          type: mainComponent.type, // Add the component type to metadata for tests
          hooks, // Add hooks array to metadata for tests
          props: props.map(p => p.name), // Add prop names to metadata for tests
          isDefault: mainComponent.isDefault,
          isDefaultExport: mainComponent.isDefault,
          isForwardRef: mainComponent.isForwardRef,
          isMemo: mainComponent.isMemo,
          hasDisplayName: mainComponent.hasDisplayName,
          displayName: mainComponent.displayName,
          ...additionalMetadata,
        },
      };

      return component;

    } catch (error) {
      logger.error(`Failed to parse React component: ${filePath}`, { error: error.message, stack: error.stack });
      return null;
    }
  }

  /**
   * Find React components in the AST
   */
  private findReactComponents(tree: any): Array<{
    name: string;
    type: 'function' | 'class';
    node: any;
    isDefault: boolean;
    isForwardRef: boolean;
    isMemo: boolean;
    hasDisplayName: boolean;
    displayName?: string;
  }> {
    const components: any[] = [];

    if (!tree?.rootNode) return components;

    // Helper to get name from identifier or type_identifier
    const getNodeName = (node: any): string | undefined => {
      if (!node) return undefined;
      if (node.type === 'identifier' || node.type === 'type_identifier') {
        return node.text;
      }
      return undefined;
    };

    // Helper to find name node (handles both identifier and type_identifier)
    const findNameNode = (parent: any): any => {
      return parent.children?.find((child: any) =>
        child.type === 'identifier' || child.type === 'type_identifier'
      );
    };

    const traverse = (node: any) => {
      // Function components
      if (node.type === 'function_declaration') {
        const nameNode = findNameNode(node);
        const name = getNodeName(nameNode);

        if (name && this.isComponentName(name)) {
          components.push({
            name,
            type: 'function',
            node,
            isDefault: false,
            isForwardRef: false,
            isMemo: false,
            hasDisplayName: false,
          });
        }
      }

      // Handle lexical_declaration (const/let declarations) containing variable_declarator
      if (node.type === 'lexical_declaration') {
        const variableDeclarator = node.children?.find((child: any) => child.type === 'variable_declarator');
        if (variableDeclarator) {
          // Process the variable_declarator as if it were found directly
          processVariableDeclarator(variableDeclarator, components);
        }
      }

      // Arrow function components (const Component = () => {})
      if (node.type === 'variable_declarator') {
        processVariableDeclarator(node, components);
      }

      // Class components
      if (node.type === 'class_declaration') {
        const nameNode = findNameNode(node);
        const extendsClause = node.children?.find((child: any) => child.type === 'extends_clause' || child.type === 'class_heritage');
        const name = getNodeName(nameNode);

        if (name && this.isComponentName(name) && extendsClause) {
          // Handle both direct extends_clause and class_heritage wrapper
          let actualExtendsClause = extendsClause;
          if (extendsClause.type === 'class_heritage') {
            actualExtendsClause = extendsClause.children?.find((child: any) => child.type === 'extends_clause');
          }

          const superclass = actualExtendsClause?.children?.find((child: any) =>
            child.type === 'identifier' || child.type === 'type_identifier'
          )?.text;

          if (superclass && this.isReactComponentClass(superclass)) {
            components.push({
              name,
              type: 'class',
              node,
              isDefault: false,
              isForwardRef: false,
              isMemo: false,
              hasDisplayName: this.hasDisplayName(node, name),
              displayName: this.getDisplayName(node),
            });
          }
        }
      }

      // Handle export_statement containing lexical_declaration (TypeScript pattern)
      if (node.type === 'export_statement') {
        const isDefault = node.children?.some((child: any) => child.text === 'default');
        const lexicalDeclaration = node.children?.find((child: any) => child.type === 'lexical_declaration');

        if (lexicalDeclaration) {
          const variableDeclarator = lexicalDeclaration.children?.find((child: any) => child.type === 'variable_declarator');
          if (variableDeclarator) {
            const result = processVariableDeclarator(variableDeclarator, []);
            if (result.length > 0) {
              const component = result[0];
              component.isDefault = isDefault;
              components.push(component);
            }
          }
        }

        // Handle other export patterns
        const exported = node.children?.find((child: any) =>
          child.type === 'function_declaration' ||
          child.type === 'identifier' ||
          child.type === 'call_expression'
        );

        if (exported) {
          let name: string | undefined;
          let type: 'function' | 'class' = 'function';
          let isForwardRefExport = false;
          let isMemoExport = false;

          if (exported.type === 'function_declaration') {
            name = getNodeName(findNameNode(exported));
          } else if (exported.type === 'identifier') {
            name = exported.text;
          } else if (exported.type === 'call_expression') {
            const caller = exported.children?.[0]?.text;
            isForwardRefExport = caller === 'forwardRef' || caller === 'React.forwardRef';
            isMemoExport = caller === 'memo' || caller === 'React.memo';
            name = 'DefaultComponent'; // Will be derived from filename
          }

          if (name && this.isComponentName(name)) {
            components.push({
              name,
              type,
              node,
              isDefault: isDefault,
              isForwardRef: isForwardRefExport,
              isMemo: isMemoExport,
              hasDisplayName: false,
            });
          }
        }
      }

      // Default exports (export_default_declaration)
      if (node.type === 'export_default_declaration') {
        const exported = node.children?.find((child: any) =>
          child.type === 'function_declaration' ||
          child.type === 'identifier' ||
          child.type === 'call_expression'
        );

        if (exported) {
          let name: string | undefined;
          let type: 'function' | 'class' = 'function';
          let isForwardRef = false;
          let isMemo = false;

          if (exported.type === 'function_declaration') {
            name = getNodeName(findNameNode(exported));
          } else if (exported.type === 'identifier') {
            name = exported.text;
          } else if (exported.type === 'call_expression') {
            const caller = exported.children?.[0]?.text;
            isForwardRef = caller === 'forwardRef' || caller === 'React.forwardRef';
            isMemo = caller === 'memo' || caller === 'React.memo';
            name = 'DefaultComponent'; // Will be derived from filename
          }

          if (name && this.isComponentName(name)) {
            components.push({
              name,
              type,
              node,
              isDefault: true,
              isForwardRef,
              isMemo,
              hasDisplayName: false,
            });
          }
        }
      }

      // Traverse children
      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    // Helper method to process variable_declarator nodes
    const processVariableDeclarator = (node: any, targetArray: any[]) => {
      const nameNode = node.children?.[0];

      // Find the value node - could be at index 2 (JS) or 3 (TS with type annotation)
      let valueNode;
      const equalIndex = node.children?.findIndex((child: any) => child.text === '=');
      if (equalIndex !== -1 && equalIndex + 1 < node.children.length) {
        valueNode = node.children[equalIndex + 1];
      }

      const name = getNodeName(nameNode);

      if (name && this.isComponentName(name) && valueNode) {
        let isForwardRef = false;
        let isMemo = false;
        let actualComponent = valueNode;

        // Handle various wrapper patterns
        if (valueNode?.type === 'call_expression') {
          const caller = valueNode.children?.[0]?.text;

          if (caller === 'memo' || caller === 'React.memo') {
            isMemo = true;
            // Get the argument to memo()
            const args = valueNode.children?.find((child: any) => child.type === 'arguments');

            // Filter out punctuation and find the actual component argument
            const componentArgs = args?.children?.filter((child: any) =>
              child.type !== '(' && child.type !== ')' && child.type !== ','
            );

            actualComponent = componentArgs?.find((child: any) =>
              child.type === 'arrow_function' ||
              child.type === 'function_expression' ||
              child.type === 'call_expression'
            );

            // Check if memo wraps forwardRef
            if (actualComponent?.type === 'call_expression') {
              const innerCaller = actualComponent.children?.[0]?.text;
              if (innerCaller === 'forwardRef' || innerCaller === 'React.forwardRef') {
                isForwardRef = true;

                // For nested forwardRef, we need to update actualComponent to the inner function
                // This ensures validation passes for deeply nested patterns
                const forwardRefArgs = actualComponent.children?.find((child: any) => child.type === 'arguments');
                const forwardRefComponentArgs = forwardRefArgs?.children?.filter((child: any) =>
                  child.type !== '(' && child.type !== ')' && child.type !== ','
                );
                const innerFunction = forwardRefComponentArgs?.find((child: any) =>
                  child.type === 'arrow_function' || child.type === 'function_expression'
                );

                // Keep actualComponent as forwardRef call for validation, but note the inner function exists
                if (innerFunction) {
                  // We found the inner function, so this is a valid memo(forwardRef(func)) pattern
                  // The validation will pass via the valueNode check
                }
              }
            }
          } else if (caller === 'forwardRef' || caller === 'React.forwardRef') {
            isForwardRef = true;
          }
        }

        // Check if it's a valid component (arrow function, function expression, or wrapped)
        if (actualComponent?.type === 'arrow_function' ||
            actualComponent?.type === 'function_expression' ||
            valueNode?.type === 'call_expression') {

          const component = {
            name,
            type: 'function' as const,
            node,
            isDefault: false,
            isForwardRef,
            isMemo,
            hasDisplayName: this.hasDisplayName(node, name),
            displayName: this.getDisplayName(node),
          };

          targetArray.push(component);
          return [component];
        }
      }
      return [];
    };

    traverse(tree.rootNode);

    // Deduplicate components by name and prefer certain types over others
    const deduplicatedComponents = this.deduplicateComponents(components);

    return deduplicatedComponents;
  }

  /**
   * Deduplicate components that were found multiple times
   */
  private deduplicateComponents(components: any[]): any[] {
    const componentMap = new Map<string, any>();

    for (const component of components) {
      const existingComponent = componentMap.get(component.name);

      if (!existingComponent) {
        componentMap.set(component.name, component);
      } else {
        // Choose the better component based on priority rules
        const betterComponent = this.chooseBetterComponent(existingComponent, component);
        componentMap.set(component.name, betterComponent);
      }
    }

    return Array.from(componentMap.values());
  }

  /**
   * Choose the better component when duplicates are found
   */
  private chooseBetterComponent(comp1: any, comp2: any): any {
    // Priority rules (higher priority wins):
    // 1. Class components over function components with same name
    // 2. Components with more metadata (memo/forwardRef) over plain ones
    // 3. Default exports over named exports
    // 4. Actual component definitions over export references

    // Rule 1: Class components beat function components
    if (comp1.type === 'class' && comp2.type === 'function') return comp1;
    if (comp2.type === 'class' && comp1.type === 'function') return comp2;

    // Rule 2: Components with HOC patterns (memo/forwardRef) beat plain ones
    const comp1HOC = comp1.isMemo || comp1.isForwardRef;
    const comp2HOC = comp2.isMemo || comp2.isForwardRef;
    if (comp1HOC && !comp2HOC) return comp1;
    if (comp2HOC && !comp1HOC) return comp2;

    // Rule 3: Default exports beat named exports
    if (comp1.isDefault && !comp2.isDefault) return comp1;
    if (comp2.isDefault && !comp1.isDefault) return comp2;

    // Rule 4: Actual component nodes (with proper structure) beat simple export references
    // Check if the component has actual implementation vs just export reference
    const comp1HasBody = this.hasComponentImplementation(comp1.node);
    const comp2HasBody = this.hasComponentImplementation(comp2.node);
    if (comp1HasBody && !comp2HasBody) return comp1;
    if (comp2HasBody && !comp1HasBody) return comp2;

    // If all else is equal, keep the first one
    return comp1;
  }

  /**
   * Check if a component node has actual implementation (not just export reference)
   */
  private hasComponentImplementation(node: any): boolean {
    if (!node) return false;

    // Look for statement_block (function body) or class_body
    const hasBody = this.findNodeOfType(node, 'statement_block') ||
                    this.findNodeOfType(node, 'class_body');

    return !!hasBody;
  }

  /**
   * Find first node of specific type in subtree
   */
  private findNodeOfType(node: any, targetType: string): any {
    if (!node) return null;

    if (node.type === targetType) return node;

    if (node.children) {
      for (const child of node.children) {
        const result = this.findNodeOfType(child, targetType);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Find the main component (usually default export or first found)
   */
  private findMainComponent(components: any[], tree: any): any | null {
    // Prefer default export
    const defaultComponent = components.find(c => c.isDefault);
    if (defaultComponent) return defaultComponent;

    // Return first component
    return components[0] || null;
  }

  /**
   * Extract React props from component
   */
  private async extractReactProps(tree: any, component: any): Promise<PropDefinition[]> {
    const props: PropDefinition[] = [];

    logger.debug(`Extracting props for component type: ${component.type}`);

    // For functional components, look for destructured props parameter
    if (component.type === 'function') {
      // Find the actual function declaration node
      let functionNode = component.node;
      if (functionNode.type === 'export_statement') {
        // Look for function_declaration inside export statement
        functionNode = functionNode.children?.find((child: any) => child.type === 'function_declaration');

        // If no function_declaration found, look for lexical_declaration (TypeScript pattern)
        if (!functionNode) {
          const lexicalDeclaration = component.node.children?.find((child: any) => child.type === 'lexical_declaration');
          if (lexicalDeclaration) {
            const variableDeclarator = lexicalDeclaration.children?.find((child: any) => child.type === 'variable_declarator');
            if (variableDeclarator) {
              // Find arrow_function within the variable_declarator
              functionNode = variableDeclarator.children?.find((child: any) =>
                child.type === 'arrow_function' || child.type === 'function_expression'
              );
            }
          }
        }
      } else if (functionNode.type === 'variable_declarator') {
        // Handle variable_declarator directly (const Component = ...)
        functionNode = functionNode.children?.find((child: any) =>
          child.type === 'arrow_function' || child.type === 'function_expression'
        );
      }

      const params = this.getFunctionParameters(functionNode);
      logger.debug(`Found ${params.length} function parameters for component ${component.name}`);
      if (params.length > 0) {
        // Find the first actual parameter (not punctuation)
        const actualParams = params.filter((param: any) =>
          param.type !== '(' && param.type !== ')' && param.type !== ','
        );

        if (actualParams.length > 0) {
          const firstParam = actualParams[0];
          let objectPattern = null;

          // Handle different parameter structures
          if (firstParam.type === 'object_pattern') {
            objectPattern = firstParam;
          } else if (firstParam.type === 'required_parameter') {
            // TypeScript: { title, onSubmit }: Props
            objectPattern = firstParam.children?.find((child: any) => child.type === 'object_pattern');
          } else if (firstParam.type === 'identifier') {
            // Simple parameter: props
            // Could analyze usage within function, but for now skip
          }

          if (objectPattern) {
            const extractedProps = this.extractObjectPatternProperties(objectPattern);
            logger.debug(`Extracted ${extractedProps.length} props from component ${component.name}:`, extractedProps.map(p => p.name));

            // Extract destructured prop names
            for (const prop of extractedProps) {
              props.push({
                name: prop.name,
                type: prop.type || 'unknown',
                required: !prop.hasDefault,
                default: prop.defaultValue,
              });
            }
          }
        }
      }
    }

    // For class components, look for PropTypes or TypeScript interfaces
    if (component.type === 'class') {
      // This would require more complex analysis of PropTypes or TypeScript
      // For now, return empty array
    }

    return props;
  }

  /**
   * Extract hooks usage from component
   */
  private extractHooksUsage(tree: any): string[] {
    const hooks: string[] = [];

    if (!tree?.rootNode) return hooks;

    const reactHooks = [
      'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
      'useMemo', 'useRef', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue'
    ];

    const traverse = (node: any) => {
      if (node.type === 'call_expression') {
        const functionNode = node.children?.[0];
        let functionName: string | undefined;

        if (functionNode?.type === 'identifier') {
          functionName = functionNode.text;
        } else if (functionNode?.type === 'member_expression') {
          // React.useState
          const object = functionNode.children?.[0]?.text;
          const property = functionNode.children?.[2]?.text;
          if (object === 'React' && property) {
            functionName = property;
          }
        }

        if (functionName) {
          // Built-in React hooks
          if (reactHooks.includes(functionName) && !hooks.includes(functionName)) {
            hooks.push(functionName);
          }

          // Custom hooks (start with 'use' and are PascalCase)
          if (functionName.startsWith('use') && functionName.length > 3 &&
              functionName[3] === functionName[3].toUpperCase()) {
            if (!hooks.includes(functionName)) {
              hooks.push(functionName);
            }
          }
        }
      }

      // Traverse children
      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return hooks;
  }

  /**
   * Extract JSX dependencies (imported components used in JSX)
   */
  private extractJSXDependencies(tree: any): string[] {
    const dependencies: string[] = [];

    if (!tree?.rootNode) return dependencies;

    const traverse = (node: any) => {
      // JSX opening elements
      if (node.type === 'jsx_opening_element' || node.type === 'jsx_self_closing_element') {
        const nameNode = node.children?.find((child: any) =>
          child.type === 'jsx_identifier' || child.type === 'identifier'
        );

        if (nameNode) {
          const componentName = nameNode.text;
          // Only include PascalCase components (custom components)
          if (componentName && this.isComponentName(componentName) &&
              !dependencies.includes(componentName)) {
            dependencies.push(componentName);
          }
        }
      }

      // Traverse children
      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return dependencies;
  }

  /**
   * Parse custom React hooks
   */
  private async parseCustomHooks(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<ReactHook[]> {
    const hooks: ReactHook[] = [];

    try {
      // Configure parser language based on file extension
      this.configureParserLanguage(filePath);
      const tree = this.parser.parse(content);
      const hookFunctions = this.findCustomHooks(tree);

      for (const hookFunc of hookFunctions) {
        const dependencies = this.extractHookDependencies(tree, hookFunc);
        const returns = this.extractHookReturns(tree, hookFunc);

        const hook: ReactHook = {
          type: 'hook',
          name: hookFunc.name,
          filePath,
          returns,
          dependencies,
          metadata: {
            hooks: dependencies, // Add hooks array to metadata for tests
            returns: returns.length === 1 ? returns[0] : returns, // Add returns to metadata for tests
            isDefault: hookFunc.isDefault,
            parameters: hookFunc.parameters,
          },
        };

        hooks.push(hook);
      }

    } catch (error) {
      logger.error(`Failed to parse React hooks: ${filePath}`, { error });
    }

    return hooks;
  }

  /**
   * Find custom hook functions in the AST
   */
  private findCustomHooks(tree: any): Array<{
    name: string;
    node: any;
    isDefault: boolean;
    parameters: string[];
  }> {
    const hooks: any[] = [];

    if (!tree?.rootNode) return hooks;

    const traverse = (node: any) => {
      // Function declarations: function useExample() {}
      if (node.type === 'function_declaration') {
        const nameNode = node.children?.find((child: any) => child.type === 'identifier');
        const name = nameNode?.text;

        if (name && this.isCustomHookName(name)) {
          const parameters = this.getFunctionParameterNames(node);
          hooks.push({
            name,
            node,
            isDefault: false,
            parameters,
          });
        }
      }

      // Variable declarations: const useExample = () => {}
      if (node.type === 'variable_declarator') {
        const nameNode = node.children?.[0];
        const valueNode = node.children?.[2];
        const name = nameNode?.text;

        if (name && this.isCustomHookName(name) &&
            (valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression')) {
          const parameters = this.getFunctionParameterNames(valueNode);
          hooks.push({
            name,
            node: valueNode,
            isDefault: false,
            parameters,
          });
        }
      }

      // Export default function (both export_default_declaration and export_statement with default)
      if (node.type === 'export_default_declaration' ||
          (node.type === 'export_statement' && node.children?.some((child: any) => child.text === 'default'))) {
        const funcNode = node.children?.find((child: any) =>
          child.type === 'function_declaration' ||
          child.type === 'arrow_function' ||
          child.type === 'function_expression'
        );

        if (funcNode) {
          let name = 'default'; // Will be extracted from filename

          if (funcNode.type === 'function_declaration') {
            const nameNode = funcNode.children?.find((child: any) => child.type === 'identifier');
            name = nameNode?.text || name;
          }

          if (this.isCustomHookName(name)) {
            const parameters = this.getFunctionParameterNames(funcNode);
            hooks.push({
              name,
              node: funcNode,
              isDefault: true,
              parameters,
            });
          }
        }
      }

      // Traverse children
      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return hooks;
  }

  /**
   * Extract hook dependencies (other hooks it uses)
   */
  private extractHookDependencies(tree: any, hookFunc: any): string[] {
    const dependencies: string[] = [];

    if (!hookFunc.node) return dependencies;

    const reactHooks = [
      'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
      'useMemo', 'useRef', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue'
    ];

    const traverse = (node: any) => {
      if (node.type === 'call_expression') {
        const functionNode = node.children?.[0];
        let functionName: string | undefined;

        if (functionNode?.type === 'identifier') {
          functionName = functionNode.text;
        } else if (functionNode?.type === 'member_expression') {
          // React.useState
          const object = functionNode.children?.[0]?.text;
          const property = functionNode.children?.[2]?.text;
          if (object === 'React' && property) {
            functionName = property;
          }
        }

        if (functionName) {
          // Built-in React hooks
          if (reactHooks.includes(functionName) && !dependencies.includes(functionName)) {
            dependencies.push(functionName);
          }

          // Custom hooks (start with 'use' and are PascalCase)
          if (functionName.startsWith('use') && functionName.length > 3 &&
              functionName[3] === functionName[3].toUpperCase()) {
            if (!dependencies.includes(functionName)) {
              dependencies.push(functionName);
            }
          }
        }
      }

      // Traverse children
      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(hookFunc.node);
    return dependencies;
  }

  /**
   * Extract what the hook returns
   */
  private extractHookReturns(tree: any, hookFunc: any): string[] {
    const returns: string[] = [];

    if (!hookFunc.node) return returns;

    // Find the function body (statement_block)
    const functionBody = hookFunc.node.children?.find((child: any) =>
      child.type === 'statement_block'
    );

    if (!functionBody) return returns;

    // Look for direct return statements in the function body (not nested functions)
    const directReturnStatements = functionBody.children?.filter((child: any) =>
      child.type === 'return_statement'
    ) || [];

    for (const returnStmt of directReturnStatements) {
      const returnExpr = returnStmt.children?.find((child: any) =>
        child.type !== 'return' && child.type !== ';'
      );

      if (returnExpr) {
        if (returnExpr.type === 'identifier') {
          // return someValue
          returns.push(returnExpr.text);
        } else if (returnExpr.type === 'array') {
          // return [value1, value2]
          const elements = returnExpr.children?.filter((child: any) =>
            child.type === 'identifier'
          );
          elements?.forEach((elem: any) => returns.push(elem.text));
        } else if (returnExpr.type === 'object') {
          // return { prop1, prop2 }
          const properties = returnExpr.children?.filter((child: any) =>
            child.type === 'shorthand_property_identifier' ||
            child.type === 'property_identifier'
          );
          properties?.forEach((prop: any) => returns.push(prop.text));
        }
      }
    }

    return returns;
  }

  /**
   * Parse Higher-Order Components (HOCs)
   */
  private async parseHOCs(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<ReactHOC[]> {
    const hocs: ReactHOC[] = [];

    try {
      this.configureParserLanguage(filePath);
      const tree = this.parser.parse(content);
      const hocFunctions = this.findHOCs(tree);

      for (const hocFunc of hocFunctions) {
        const hoc: ReactHOC = {
          type: 'hoc',
          name: hocFunc.name,
          filePath,
          wrapsComponent: true, // HOCs by definition wrap components
          returnsComponent: true, // HOCs by definition return components
          metadata: {
            wrapsComponent: true,
            returnsComponent: true,
            isDefault: hocFunc.isDefault,
            parameters: hocFunc.parameters,
          },
        };

        hocs.push(hoc);
      }

    } catch (error) {
      logger.error(`Failed to parse React HOCs: ${filePath}`, { error });
    }

    return hocs;
  }

  /**
   * Find HOC functions in the AST
   */
  private findHOCs(tree: any): Array<{
    name: string;
    node: any;
    isDefault: boolean;
    parameters: string[];
  }> {
    const hocs: any[] = [];

    if (!tree?.rootNode) return hocs;

    const traverse = (node: any) => {
      // Function declarations: export function withAuth() {}
      if (node.type === 'function_declaration') {
        const nameNode = node.children?.find((child: any) => child.type === 'identifier');
        const name = nameNode?.text;

        if (name && this.isHOCName(name)) {
          const parameters = this.getFunctionParameterNames(node);
          hocs.push({
            name,
            node,
            isDefault: false,
            parameters,
          });
        }
      }

      // Variable declarations: export const withAuth = () => {}
      if (node.type === 'variable_declarator') {
        const nameNode = node.children?.[0];
        const valueNode = node.children?.[2];
        const name = nameNode?.text;

        if (name && this.isHOCName(name) &&
            (valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression')) {
          const parameters = this.getFunctionParameterNames(valueNode);
          hocs.push({
            name,
            node: valueNode,
            isDefault: false,
            parameters,
          });
        }
      }

      // Export default HOCs
      if (node.type === 'export_default_declaration' ||
          (node.type === 'export_statement' && node.children?.some((child: any) => child.text === 'default'))) {
        const funcNode = node.children?.find((child: any) =>
          child.type === 'function_declaration' ||
          child.type === 'arrow_function' ||
          child.type === 'function_expression' ||
          child.type === 'identifier'
        );

        if (funcNode) {
          let name = 'default';

          if (funcNode.type === 'function_declaration') {
            const nameNode = funcNode.children?.find((child: any) => child.type === 'identifier');
            name = nameNode?.text || name;
          } else if (funcNode.type === 'identifier') {
            name = funcNode.text;
          }

          if (this.isHOCName(name)) {
            const parameters = funcNode.type === 'identifier' ? [] : this.getFunctionParameterNames(funcNode);
            hocs.push({
              name,
              node: funcNode,
              isDefault: true,
              parameters,
            });
          }
        }
      }

      // Traverse children
      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return hocs;
  }

  /**
   * Check if name follows HOC naming convention (starts with 'with')
   */
  private isHOCName(name: string): boolean {
    return name.startsWith('with') && name.length > 4 && name[4] === name[4].toUpperCase();
  }

  /**
   * Check if file is TypeScript based on extension
   */
  private isTypeScriptFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ext === '.ts' || ext === '.tsx';
  }

  /**
   * Check if content has TypeScript-specific features
   */
  private hasTypeScriptFeatures(tree: any): boolean {
    if (!tree?.rootNode) return false;

    const typeScriptNodeTypes = [
      'interface_declaration',
      'type_alias_declaration',
      'type_annotation',
      'as_expression',
      'generic_type',
      'enum_declaration'
    ];

    const hasTypeScriptNodes = (node: any): boolean => {
      if (typeScriptNodeTypes.includes(node.type)) {
        return true;
      }

      if (node.children) {
        return node.children.some((child: any) => hasTypeScriptNodes(child));
      }

      return false;
    };

    return hasTypeScriptNodes(tree.rootNode);
  }

  /**
   * Check if component uses React.Suspense
   */
  private hasSuspense(tree: any): boolean {
    if (!tree?.rootNode) return false;

    const traverse = (node: any): boolean => {
      // Check for JSX elements
      if (node.type === 'jsx_opening_element' || node.type === 'jsx_self_closing_element') {
        const nameNode = node.children?.find((child: any) =>
          child.type === 'jsx_identifier' || child.type === 'identifier'
        );

        if (nameNode) {
          const elementName = nameNode.text;
          if (elementName === 'Suspense' || elementName === 'React.Suspense') {
            return true;
          }
        }
      }

      // Check for member expressions like React.Suspense
      if (node.type === 'member_expression') {
        const object = node.children?.[0];
        const property = node.children?.[2];
        if (object?.text === 'React' && property?.text === 'Suspense') {
          return true;
        }
      }

      if (node.children) {
        return node.children.some((child: any) => traverse(child));
      }

      return false;
    };

    return traverse(tree.rootNode);
  }

  /**
   * Check if component uses React.lazy
   */
  private hasLazy(tree: any): boolean {
    if (!tree?.rootNode) return false;

    const traverse = (node: any): boolean => {
      // Check for call expressions
      if (node.type === 'call_expression') {
        const functionNode = node.children?.[0];

        if (functionNode?.type === 'member_expression') {
          const object = functionNode.children?.[0];
          const property = functionNode.children?.[2];
          if (object?.text === 'React' && property?.text === 'lazy') {
            return true;
          }
        } else if (functionNode?.type === 'identifier' && functionNode.text === 'lazy') {
          return true;
        }
      }

      if (node.children) {
        return node.children.some((child: any) => traverse(child));
      }

      return false;
    };

    return traverse(tree.rootNode);
  }

  /**
   * Parse Context providers
   */
  private async parseContextProviders(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity[]> {
    const contexts: FrameworkEntity[] = [];

    // Parse createContext calls and Provider components
    // This is a placeholder for context provider analysis

    return contexts;
  }

  // Helper methods

  private isReactComponent(content: string): boolean {
    // Enhanced pattern to match various React component patterns:
    // 1. export const/function ComponentName
    // 2. const ComponentName = (with memo/forwardRef/arrow functions)
    // 3. class ComponentName extends Component
    // 4. export default ComponentName
    return this.containsPattern(content, /(?:export\s+(?:default\s+)?(?:function\s+[A-Z]|const\s+[A-Z]))|(?:const\s+[A-Z]\w*\s*=.*(?:memo|forwardRef|\(\s*\)|=>\s*{))|(?:class\s+[A-Z]\w*\s+extends\s+(?:React\.)?(?:Component|PureComponent))|(?:export\s+default\s+[A-Z])/);
  }

  private hasCustomHooks(content: string): boolean {
    return this.containsPattern(content, /(?:export\s+(?:default\s+)?)?(?:function\s+use[A-Z]|const\s+use[A-Z])/);
  }

  private hasHOCs(content: string): boolean {
    return this.containsPattern(content, /function\s+with[A-Z]|const\s+with[A-Z]|export\s+(?:const\s+|function\s+)?with[A-Z]/);
  }

  private hasContextProvider(content: string): boolean {
    return this.containsPattern(content, /createContext|Provider|Consumer/);
  }

  private isComponentName(name: string): boolean {
    return name.length > 0 && name[0] === name[0].toUpperCase();
  }

  private isCustomHookName(name: string): boolean {
    return name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase();
  }

  private isReactComponentClass(className: string): boolean {
    return ['Component', 'PureComponent', 'React.Component', 'React.PureComponent'].includes(className);
  }

  private getFunctionParameters(functionNode: any): any[] {
    const params = functionNode.children?.find((child: any) => child.type === 'formal_parameters');
    return params?.children || [];
  }

  private getFunctionParameterNames(functionNode: any): string[] {
    const params = this.getFunctionParameters(functionNode);
    return params
      .filter((param: any) => param.type === 'identifier')
      .map((param: any) => param.text);
  }

  private extractObjectPatternProperties(objectPattern: any): Array<{
    name: string;
    type?: string;
    hasDefault: boolean;
    defaultValue?: string;
  }> {
    const properties: any[] = [];

    if (!objectPattern || !objectPattern.children) {
      return properties;
    }

    // Find object pattern properties
    for (const child of objectPattern.children) {
      if (child.type === 'shorthand_property_identifier_pattern') {
        // Simple destructured property: { title, onSubmit }
        properties.push({
          name: child.text,
          hasDefault: false,
        });
      } else if (child.type === 'property_identifier') {
        // Property identifier
        properties.push({
          name: child.text,
          hasDefault: false,
        });
      } else if (child.type === 'assignment_pattern') {
        // Property with default value: { title = 'Default' }
        const nameNode = child.children?.[0];
        const defaultNode = child.children?.[2];
        if (nameNode) {
          properties.push({
            name: nameNode.text,
            hasDefault: true,
            defaultValue: defaultNode?.text,
          });
        }
      } else if (child.type === 'object_assignment_pattern') {
        // Nested object destructuring
        const nameNode = child.children?.[0];
        if (nameNode) {
          properties.push({
            name: nameNode.text,
            hasDefault: false,
          });
        }
      }
    }

    return properties;
  }

  private hasDisplayName(node: any, componentName: string): boolean {
    // Check if component has displayName property set
    return false;
  }

  private getDisplayName(node: any): string | undefined {
    // Extract displayName if present
    return undefined;
  }

  /**
   * Extract custom hooks usage from regular hooks list
   */
  private extractCustomHooksUsage(hooks: string[]): string[] {
    const builtInHooks = [
      'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
      'useMemo', 'useRef', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue'
    ];

    return hooks.filter(hook =>
      hook.startsWith('use') &&
      hook.length > 3 &&
      hook[3] === hook[3].toUpperCase() &&
      !builtInHooks.includes(hook)
    );
  }

  /**
   * Extract lifecycle methods from class component
   */
  private extractLifecycleMethods(tree: any, component: any): string[] {
    const lifecycleMethods: string[] = [];
    const commonLifecycleMethods = [
      'componentDidMount', 'componentDidUpdate', 'componentWillUnmount',
      'componentDidCatch', 'getSnapshotBeforeUpdate', 'shouldComponentUpdate',
      'getInitialState', 'getDefaultProps', 'componentWillMount',
      'componentWillReceiveProps', 'componentWillUpdate'
    ];

    if (!component?.node) return lifecycleMethods;

    let classNode = component.node;
    if (classNode?.type === 'export_statement') {
      classNode = classNode.children?.find((child: any) => child.type === 'class_declaration');
    }

    if (!classNode) return lifecycleMethods;

    const traverse = (node: any) => {
      if (node.type === 'method_definition') {
        const nameNode = node.children?.find((child: any) => child.type === 'property_identifier' || child.type === 'property_name');
        const methodName = nameNode?.text;

        if (methodName && commonLifecycleMethods.includes(methodName)) {
          if (!lifecycleMethods.includes(methodName)) {
            lifecycleMethods.push(methodName);
          }
        }
      }

      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(classNode);
    return lifecycleMethods;
  }

  /**
   * Extract state properties from class component
   */
  private extractStateProperties(tree: any, component: any): string[] {
    const stateProperties: string[] = [];

    if (!component?.node) return stateProperties;

    let classNode = component.node;
    if (classNode?.type === 'export_statement') {
      classNode = classNode.children?.find((child: any) => child.type === 'class_declaration');
    }

    if (!classNode) return stateProperties;

    const traverse = (node: any) => {
      // Look for constructor with this.state assignment
      if (node.type === 'method_definition') {
        const nameNode = node.children?.find((child: any) => child.type === 'property_identifier' || child.type === 'property_name');
        if (nameNode?.text === 'constructor') {
          this.extractStateFromConstructor(node, stateProperties);
        }
      }

      // Look for this.setState calls
      if (node.type === 'call_expression') {
        const memberExpr = node.children?.[0];
        if (memberExpr?.type === 'member_expression') {
          const object = memberExpr.children?.[0];
          const property = memberExpr.children?.[2];
          if (object?.text === 'this' && property?.text === 'setState') {
            this.extractStateFromSetState(node, stateProperties);
          }
        }
      }

      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(classNode);
    return stateProperties;
  }

  /**
   * Extract state properties from constructor
   */
  private extractStateFromConstructor(constructorNode: any, stateProperties: string[]): void {
    const traverse = (node: any) => {
      if (node.type === 'assignment_expression') {
        const left = node.children?.[0];
        const right = node.children?.[2];

        if (left?.type === 'member_expression') {
          const object = left.children?.[0];
          const property = left.children?.[2];

          if (object?.text === 'this' && property?.text === 'state' && right?.type === 'object') {
            // Extract properties from state object
            this.extractObjectProperties(right, stateProperties);
          }
        }
      }

      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(constructorNode);
  }

  /**
   * Extract state properties from setState calls
   */
  private extractStateFromSetState(setStateNode: any, stateProperties: string[]): void {
    const args = setStateNode.children?.find((child: any) => child.type === 'arguments');
    if (args && args.children) {
      for (const arg of args.children) {
        if (arg.type === 'object') {
          this.extractObjectProperties(arg, stateProperties);
        } else if (arg.type === 'arrow_function' || arg.type === 'function_expression') {
          // For setState(prevState => ({ ... }))
          const body = arg.children?.find((child: any) =>
            child.type === 'statement_block' || child.type === 'object'
          );
          if (body) {
            this.extractObjectProperties(body, stateProperties);
          }
        }
      }
    }
  }

  /**
   * Extract property names from object literal
   */
  private extractObjectProperties(objectNode: any, properties: string[]): void {
    if (!objectNode || !objectNode.children) return;

    for (const child of objectNode.children) {
      if (child.type === 'pair') {
        const key = child.children?.[0];
        if (key?.type === 'property_identifier' || key?.type === 'identifier') {
          const propName = key.text;
          if (propName && !properties.includes(propName)) {
            properties.push(propName);
          }
        }
      } else if (child.type === 'shorthand_property_identifier') {
        const propName = child.text;
        if (propName && !properties.includes(propName)) {
          properties.push(propName);
        }
      }
    }
  }

  /**
   * Extract class methods (non-lifecycle)
   */
  private extractClassMethods(tree: any, component: any): string[] {
    const methods: string[] = [];
    const lifecycleMethods = [
      'componentDidMount', 'componentDidUpdate', 'componentWillUnmount',
      'componentDidCatch', 'getSnapshotBeforeUpdate', 'shouldComponentUpdate',
      'constructor', 'render'
    ];

    if (!component?.node) return methods;

    let classNode = component.node;
    if (classNode?.type === 'export_statement') {
      classNode = classNode.children?.find((child: any) => child.type === 'class_declaration');
    }

    if (!classNode) return methods;

    const traverse = (node: any) => {
      if (node.type === 'method_definition') {
        const nameNode = node.children?.find((child: any) => child.type === 'property_identifier' || child.type === 'property_name');
        const methodName = nameNode?.text;

        if (methodName && !lifecycleMethods.includes(methodName)) {
          if (!methods.includes(methodName)) {
            methods.push(methodName);
          }
        }
      }

      // Also look for arrow function properties like increment = () => {}
      if (node.type === 'public_field_definition') {
        const nameNode = node.children?.[0];
        const valueNode = node.children?.[2];
        const methodName = nameNode?.text;

        if (methodName &&
            (valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression') &&
            !lifecycleMethods.includes(methodName)) {
          if (!methods.includes(methodName)) {
            methods.push(methodName);
          }
        }
      }

      if (node?.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    };

    traverse(classNode);
    return methods;
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
   * Collect syntax errors from content by parsing with tree-sitter
   */
  private collectSyntaxErrorsFromContent(filePath: string, content: string): Array<{ message: string; line: number; column: number; severity: 'error' }> {
    const errors: Array<{ message: string; line: number; column: number; severity: 'error' }> = [];

    try {
      // Configure parser language based on file extension
      this.configureParserLanguage(filePath);
      const tree = this.parser.parse(content);

      if (!tree || !tree.rootNode) {
        return errors;
      }

      // Walk the tree to find ERROR nodes
      const findErrors = (node: any): void => {
        if (node.type === 'ERROR') {
          const startPos = node.startPosition;
          errors.push({
            message: `Syntax error: ${node.text.substring(0, 50)}${node.text.length > 50 ? '...' : ''}`,
            line: startPos.row + 1, // Convert 0-based to 1-based
            column: startPos.column + 1, // Convert 0-based to 1-based
            severity: 'error'
          });
        }

        // Traverse children if the node has errors
        if (node.hasError && node.children) {
          for (const child of node.children) {
            findErrors(child);
          }
        }
      };

      findErrors(tree.rootNode);

    } catch (error) {
      logger.warn(`Failed to collect syntax errors for ${filePath}`, { error: (error as Error).message });
    }

    return errors;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['.jsx', '.tsx', '.js', '.ts'];
  }

  /**
   * Override parseFileDirectly to delegate to appropriate language parser
   * This ensures TypeScript interfaces and other language-specific symbols are extracted correctly
   */
  protected async parseFileDirectly(
    filePath: string,
    content: string,
    options?: FrameworkParseOptions
  ): Promise<ParseResult> {
    try {
      // Determine which parser to use based on file extension and content
      const useTypeScript = this.isTypeScriptFile(filePath) || this.shouldUseTypeScriptParser(content);
      const parser = useTypeScript ? this.typescriptParser : this.javascriptParser;

      logger.debug(`Using ${useTypeScript ? 'TypeScript' : 'JavaScript'} parser for ${filePath}`);

      // Delegate to the appropriate language parser
      const result = await parser.parseFile(filePath, content, options);

      return {
        symbols: result.symbols || [],
        dependencies: result.dependencies || [],
        imports: result.imports || [],
        exports: result.exports || [],
        errors: result.errors || [],
      };
    } catch (error) {
      logger.warn(`Language parser delegation failed for ${filePath}`, { error: (error as Error).message });

      // Fallback to base implementation
      return super.parseFileDirectly(filePath, content, options);
    }
  }

  /**
   * Determine if TypeScript parser should be used based on content analysis
   */
  private shouldUseTypeScriptParser(content: string): boolean {
    // Check for TypeScript-specific features
    const typeScriptFeatures = [
      /interface\s+\w+/,
      /type\s+\w+\s*=/,
      /enum\s+\w+/,
      /<\w+>/,  // Generic types
      /:\s*\w+/,  // Type annotations
      /as\s+\w+/,  // Type assertions
    ];

    return typeScriptFeatures.some(pattern => pattern.test(content));
  }

  /**
   * Extract symbols from AST - fallback for base class compatibility
   */
  protected extractSymbols(rootNode: any, content: string): ParsedSymbol[] {
    // This method is kept for compatibility but should not be called
    // since we override parseFileDirectly
    return [];
  }

  /**
   * Extract dependencies from AST - fallback for base class compatibility
   */
  protected extractDependencies(rootNode: any, content: string): ParsedDependency[] {
    // This method is kept for compatibility but should not be called
    // since we override parseFileDirectly
    return [];
  }

  /**
   * Extract imports from AST - fallback for base class compatibility
   */
  protected extractImports(rootNode: any, content: string): ParsedImport[] {
    // This method is kept for compatibility but should not be called
    // since we override parseFileDirectly
    return [];
  }

  /**
   * Extract exports from AST - fallback for base class compatibility
   */
  protected extractExports(rootNode: any, content: string): ParsedExport[] {
    // This method is kept for compatibility but should not be called
    // since we override parseFileDirectly
    return [];
  }
}