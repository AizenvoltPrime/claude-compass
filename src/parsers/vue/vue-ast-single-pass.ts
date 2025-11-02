import Parser from 'tree-sitter';
import { ParsedSymbol, ParsedDependency } from '../base';
import { DependencyType, SymbolType } from '../../database/models';
import { entityClassifier } from '../../utils/entity-classifier';
import { FrameworkParseOptions } from '../base-framework';
import { normalizeTypeName } from './vue-utils';

/**
 * Performs optimized single-pass AST extraction for Vue files
 * Extracts symbols, dependencies, and imports in a single tree traversal
 */
export function performVueSinglePassExtraction(
  rootNode: Parser.SyntaxNode | null,
  content: string,
  currentFilePath: string,
  currentOptions: FrameworkParseOptions | undefined,
  buildQualifiedNameFn: (name: string) => string,
  getNodeTextFn: (node: Parser.SyntaxNode) => string,
  getBaseNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  findContainingFunctionFn: (callNode: Parser.SyntaxNode, symbols: ParsedSymbol[]) => string
): {
  symbols: ParsedSymbol[];
  dependencies: ParsedDependency[];
  imports: any[];
} {
  const symbols: ParsedSymbol[] = [];
  const dependencies: ParsedDependency[] = [];
  const imports: any[] = [];

  if (!rootNode) return { symbols, dependencies, imports };

  const traverse = (node: Parser.SyntaxNode) => {
    // Handle imports first
    if (node.type === 'import_statement') {
      let source = '';
      const importedNames: string[] = [];
      let importType: 'named' | 'default' | 'namespace' | 'side_effect' = 'side_effect';

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'string') {
          const stringFragment = child.child(1);
          if (stringFragment?.type === 'string_fragment') {
            source = stringFragment.text;
          } else {
            source = child.text.replace(/^['"]|['"]$/g, '');
          }
        }
        if (child?.type === 'import_clause') {
          for (let j = 0; j < child.childCount; j++) {
            const clauseChild = child.child(j);
            if (clauseChild?.type === 'named_imports') {
              importType = 'named';
              for (let k = 0; k < clauseChild.childCount; k++) {
                const importSpecifier = clauseChild.child(k);
                if (importSpecifier?.type === 'import_specifier') {
                  const nameNode = importSpecifier.child(0);
                  if (nameNode?.type === 'identifier') {
                    importedNames.push(nameNode.text);
                  }
                }
              }
            } else if (clauseChild?.type === 'identifier') {
              importType = 'default';
              importedNames.push(clauseChild.text);
            }
          }
        }
      }

      if (source) {
        imports.push({
          source,
          import_type: importType,
          line_number: node.startPosition?.row + 1 || 1,
          is_dynamic: false,
          imported_names: importedNames.length > 0 ? importedNames : undefined,
        });
      }
    }

    // Handle dependencies (call expressions)
    if (node.type === 'call_expression') {
      const dependency = extractVueCallDependency(
        node,
        content,
        symbols,
        getBaseNodeTextFn,
        findContainingFunctionFn
      );
      if (dependency) {
        dependency.dependency_type = DependencyType.CALLS;
        dependencies.push(dependency);
      }
    }

    // Variable declarations: const title = ref(...) or lexical_declaration containing variable_declarator
    if (node.type === 'variable_declarator') {
      const nameNode = node.child(0);
      const valueNode = node.child(2);

      if (nameNode?.text) {
        if (valueNode?.type === 'arrow_function') {
          const classification = entityClassifier.classify(
            'function',
            nameNode.text,
            [],
            currentFilePath,
            'vue',
            undefined,
            currentOptions?.repositoryFrameworks
          );

          symbols.push({
            name: nameNode.text,
            qualified_name: buildQualifiedNameFn(nameNode.text),
            symbol_type: SymbolType.FUNCTION,
            entity_type: classification.entityType,
            framework: 'vue',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: getNodeTextFn(node),
          });
        } else if (valueNode?.type === 'call_expression') {
          const callee = valueNode.child(0);

          if (callee?.text === 'defineStore') {
            const stateTypeDeps = extractPiniaStateFieldTypes(valueNode, nameNode.text);
            dependencies.push(...stateTypeDeps);
          }

          const classification = entityClassifier.classify(
            'variable',
            nameNode.text,
            [],
            currentFilePath,
            'vue',
            undefined,
            currentOptions?.repositoryFrameworks
          );

          let entityType = classification.entityType;
          if (callee?.text === 'defineStore') {
            entityType = 'store';
          }

          symbols.push({
            name: nameNode.text,
            qualified_name: buildQualifiedNameFn(nameNode.text),
            symbol_type: SymbolType.VARIABLE,
            entity_type: entityType,
            framework: 'vue',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
          });
        } else {
          const classification = entityClassifier.classify(
            'variable',
            nameNode.text,
            [],
            currentFilePath,
            'vue',
            undefined,
            currentOptions?.repositoryFrameworks
          );

          symbols.push({
            name: nameNode.text,
            qualified_name: buildQualifiedNameFn(nameNode.text),
            symbol_type: SymbolType.VARIABLE,
            entity_type: classification.entityType,
            framework: 'vue',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: getNodeTextFn(node),
          });
        }
      }
    }

    // Function declarations: function increment() {}
    if (node.type === 'function_declaration') {
      let nameNode = null;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'identifier') {
          nameNode = child;
          break;
        }
      }

      if (nameNode?.text) {
        const classification = entityClassifier.classify(
          'function',
          nameNode.text,
          [],
          currentFilePath,
          'vue',
          undefined,
          currentOptions?.repositoryFrameworks
        );

        symbols.push({
          name: nameNode.text,
          qualified_name: buildQualifiedNameFn(nameNode.text),
          symbol_type: SymbolType.FUNCTION,
          entity_type: classification.entityType,
          framework: 'vue',
          start_line: node.startPosition?.row + 1 || 1,
          end_line: node.endPosition?.row + 1 || 1,
          is_exported: false,
          signature: getNodeTextFn(node),
        });
      }
    }

    // Interface declarations: interface User {}
    if (
      node.type === 'interface_declaration' ||
      (node.type === 'ERROR' && node.text.startsWith('interface '))
    ) {
      let nameNode = null;

      if (node.type === 'interface_declaration') {
        nameNode = node.child(1);
      } else if (node.type === 'ERROR') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === 'identifier' && child.text !== 'interface') {
            nameNode = child;
            break;
          }
        }
      }

      if (nameNode?.text) {
        const classification = entityClassifier.classify(
          'interface',
          nameNode.text,
          [],
          currentFilePath,
          'vue',
          undefined,
          currentOptions?.repositoryFrameworks
        );

        symbols.push({
          name: nameNode.text,
          qualified_name: buildQualifiedNameFn(nameNode.text),
          symbol_type: SymbolType.INTERFACE,
          entity_type: classification.entityType,
          framework: 'vue',
          start_line: node.startPosition?.row + 1 || 1,
          end_line: node.endPosition?.row + 1 || 1,
          is_exported: false,
          signature: getNodeTextFn(node),
        });
      }
    }

    // Type alias declarations: type UserType = ...
    if (node.type === 'type_alias_declaration') {
      const nameNode = node.child(1);
      if (nameNode?.text) {
        const classification = entityClassifier.classify(
          'type_alias',
          nameNode.text,
          [],
          currentFilePath,
          'vue',
          undefined,
          currentOptions?.repositoryFrameworks
        );

        symbols.push({
          name: nameNode.text,
          qualified_name: buildQualifiedNameFn(nameNode.text),
          symbol_type: SymbolType.TYPE_ALIAS,
          entity_type: classification.entityType,
          framework: 'vue',
          start_line: node.startPosition?.row + 1 || 1,
          end_line: node.endPosition?.row + 1 || 1,
          is_exported: false,
          signature: getNodeTextFn(node),
        });
      }
    }

    // Class declarations: class MyClass {}
    if (node.type === 'class_declaration') {
      const nameNode = node.child(1);
      if (nameNode?.text) {
        const classification = entityClassifier.classify(
          'class',
          nameNode.text,
          [],
          currentFilePath,
          'vue',
          undefined,
          currentOptions?.repositoryFrameworks
        );

        symbols.push({
          name: nameNode.text,
          qualified_name: buildQualifiedNameFn(nameNode.text),
          symbol_type: SymbolType.CLASS,
          entity_type: classification.entityType,
          framework: 'vue',
          start_line: node.startPosition?.row + 1 || 1,
          end_line: node.endPosition?.row + 1 || 1,
          is_exported: false,
          signature: getNodeTextFn(node),
        });
      }
    }

    // Vue Composition API lifecycle hooks and callbacks
    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (functionNode && functionNode.type === 'identifier') {
        const functionName = functionNode.text;

        const vueCallbacks = [
          'onMounted',
          'onUnmounted',
          'onUpdated',
          'onCreated',
          'onBeforeMount',
          'onBeforeUpdate',
          'onBeforeUnmount',
          'onActivated',
          'onDeactivated',
          'onErrorCaptured',
          'watch',
          'watchEffect',
          'computed',
          'readonly',
          'customRef',
        ];

        if (vueCallbacks.includes(functionName)) {
          const argumentsNode = node.childForFieldName('arguments');
          if (argumentsNode) {
            for (let i = 0; i < argumentsNode.childCount; i++) {
              const child = argumentsNode.child(i);
              if (
                child &&
                (child.type === 'arrow_function' || child.type === 'function_expression')
              ) {
                const callbackName = `${functionName}_callback`;
                const classification = entityClassifier.classify(
                  'function',
                  callbackName,
                  [],
                  currentFilePath,
                  'vue',
                  undefined,
                  currentOptions?.repositoryFrameworks
                );

                symbols.push({
                  name: callbackName,
                  qualified_name: buildQualifiedNameFn(callbackName),
                  symbol_type: SymbolType.FUNCTION,
                  entity_type: classification.entityType,
                  framework: 'vue',
                  start_line: child.startPosition?.row + 1 || 1,
                  end_line: child.endPosition?.row + 1 || 1,
                  is_exported: false,
                  signature: getNodeTextFn(child),
                });
                break;
              }
            }
          }
        }
      }
    }

    // Traverse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(rootNode);

  return { symbols, dependencies, imports };
}

/**
 * Extract call dependency from a call expression node
 */
function extractVueCallDependency(
  node: Parser.SyntaxNode,
  content: string,
  symbols: ParsedSymbol[],
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  findContainingFunctionFn: (callNode: Parser.SyntaxNode, symbols: ParsedSymbol[]) => string
): ParsedDependency | null {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return null;

  let functionName: string;

  if (functionNode.type === 'identifier') {
    // Simple function call: functionName()
    functionName = getNodeTextFn(functionNode, content);
  } else if (functionNode.type === 'member_expression') {
    // Method call: obj.method() - extract just the method name
    const propertyNode = functionNode.childForFieldName('property');
    if (!propertyNode) return null;
    functionName = getNodeTextFn(propertyNode, content);
  } else {
    return null;
  }

  const skipMethods = [
    'console',
    'log',
    'error',
    'warn',
    'push',
    'pop',
    'shift',
    'unshift',
    'slice',
    'splice',
    'toString',
    'valueOf',
  ];
  if (skipMethods.includes(functionName)) return null;

  const callerName = findContainingFunctionFn(node, symbols);

  return {
    from_symbol: callerName,
    to_symbol: functionName,
    dependency_type: DependencyType.CALLS,
    line_number: node.startPosition.row + 1,
  };
}

/**
 * Extract dependencies from Pinia store state field type annotations
 * Creates REFERENCES dependencies from store to managed types
 */
function extractPiniaStateFieldTypes(
  defineStoreNode: Parser.SyntaxNode,
  storeName: string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  const argsNode = defineStoreNode.children.find(c => c.type === 'arguments');
  if (!argsNode) return dependencies;

  const optionsArg = argsNode.namedChildren[1];
  if (!optionsArg || optionsArg.type !== 'object') {
    return dependencies;
  }

  for (const prop of optionsArg.namedChildren) {
    if (prop.type !== 'pair') continue;

    const key = prop.child(0);
    if (key?.text !== 'state') continue;

    const value = prop.child(2);
    if (!value || value.type !== 'arrow_function') continue;

    const body = value.child(value.childCount - 1);
    if (!body) continue;

    const stateObject = body.type === 'parenthesized_expression' ? body.child(1) : body;

    if (stateObject?.type !== 'object') continue;

    for (const stateProp of stateObject.namedChildren) {
      if (stateProp.type !== 'pair') continue;

      const propValue = stateProp.child(2);
      if (!propValue) continue;

      const types = extractTypeAssertions(propValue);

      for (const typeName of types) {
        dependencies.push({
          from_symbol: storeName,
          to_symbol: typeName,
          dependency_type: DependencyType.REFERENCES,
          line_number: propValue.startPosition.row + 1,
        });
      }
    }
  }

  return dependencies;
}

/**
 * Recursively extract type assertions from an expression
 * Handles: [] as Type[], Array<Type>, etc.
 */
function extractTypeAssertions(node: Parser.SyntaxNode): string[] {
  const types: string[] = [];

  if (node.type === 'as_expression') {
    const typeNode = node.child(2);
    if (typeNode) {
      const typeName = normalizeTypeName(typeNode.text);
      if (typeName) types.push(typeName);
    }
  }

  for (const child of node.children) {
    types.push(...extractTypeAssertions(child));
  }

  return types;
}
