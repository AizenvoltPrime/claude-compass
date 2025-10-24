import Parser from 'tree-sitter';
import { ParsedDependency } from '../base';
import { DependencyType } from '../../database/models';
import { PHPParsingContext } from './types';

/**
 * Extract dependencies from Eloquent with() relationship strings.
 * Uses pure semantic analysis via relationship registry.
 *
 * Best Practice Implementation:
 * - Parses relationship method definitions to build registry
 * - Only creates dependencies for verified relationships
 * - No convention-based guessing or fallbacks
 * - 100% accuracy: if not in registry, not in dependencies
 *
 * Example: Model::with(['profile.address'])
 * - Looks up User → profile → Profile (from registry)
 * - Looks up Profile → address → Address (from registry)
 * - Creates references only for verified relationships
 */
export function extractEloquentRelationshipDependencies(
  node: Parser.SyntaxNode,
  content: string,
  callerName: string,
  baseClassName: string,
  _baseClassFQN: string | null,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  const argumentsNode = node.childForFieldName('arguments');
  if (!argumentsNode) return dependencies;

  const relationshipStrings: string[] = [];
  const traverse = (n: Parser.SyntaxNode) => {
    if (n.type === 'string' || n.type === 'encapsed_string') {
      let stringValue = getNodeText(n, content);
      stringValue = stringValue.replace(/^['"]|['"]$/g, '');
      if (stringValue) relationshipStrings.push(stringValue);
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) traverse(child);
    }
  };
  traverse(argumentsNode);

  for (const relString of relationshipStrings) {
    const parts = relString.split('.');

    let currentModelClass = baseClassName;

    for (const relationshipName of parts) {
      let targetModelClass: string | undefined;

      if (currentModelClass && context.relationshipRegistry.has(currentModelClass)) {
        const classRelationships = context.relationshipRegistry.get(currentModelClass)!;
        targetModelClass = classRelationships.get(relationshipName);
      }

      if (targetModelClass) {
        dependencies.push({
          from_symbol: callerName,
          to_symbol: targetModelClass,
          to_qualified_name: undefined,
          dependency_type: DependencyType.REFERENCES,
          line_number: node.startPosition.row + 1,
        });

        currentModelClass = targetModelClass;
      } else {
        break;
      }
    }
  }

  return dependencies;
}

/**
 * Extract Eloquent relationship definition from method body.
 * Parses: return $this->hasMany(Post::class);
 * Stores in registry: User → { posts → Post }
 *
 * Handles all Laravel relationship types:
 * - hasMany, hasOne, belongsTo, belongsToMany
 * - morphTo, morphOne, morphMany, morphToMany
 * - hasManyThrough, hasOneThrough
 */
export function extractRelationshipDefinition(
  methodNode: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): void {
  if (!context.currentClass) return;

  const methodName = methodNode.childForFieldName('name');
  if (!methodName) return;

  const methodNameStr = getNodeText(methodName, content);

  const body = methodNode.childForFieldName('body');
  if (!body) return;

  const findReturnStatements = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
    const returns: Parser.SyntaxNode[] = [];
    if (node.type === 'return_statement') {
      returns.push(node);
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) returns.push(...findReturnStatements(child));
    }
    return returns;
  };

  const returnStatements = findReturnStatements(body);

  const relationshipMethods = new Set([
    'hasMany', 'hasOne', 'belongsTo', 'belongsToMany',
    'morphTo', 'morphOne', 'morphMany', 'morphToMany', 'morphedByMany',
    'hasManyThrough', 'hasOneThrough'
  ]);

  for (const returnStmt of returnStatements) {
    const findMemberCalls = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
      const calls: Parser.SyntaxNode[] = []
      if (node.type === 'member_call_expression') {
        calls.push(node);
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) calls.push(...findMemberCalls(child));
      }
      return calls;
    };

    const memberCalls = findMemberCalls(returnStmt);

    for (const call of memberCalls) {
      const nameNode = call.childForFieldName('name');
      if (!nameNode) continue;

      const callMethod = getNodeText(nameNode, content);
      if (!relationshipMethods.has(callMethod)) continue;

      const argsNode = call.childForFieldName('arguments');
      if (!argsNode) continue;

      const findClassConstants = (node: Parser.SyntaxNode): Parser.SyntaxNode[] => {
        const constants: Parser.SyntaxNode[] = [];
        if (node.type === 'class_constant_access_expression') {
          constants.push(node);
        }
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) constants.push(...findClassConstants(child));
        }
        return constants;
      };

      const classConstants = findClassConstants(argsNode);

      for (const constant of classConstants) {
        if (constant.children.length === 0) continue;
        const classNameNode = constant.children[0];
        if (!classNameNode || classNameNode.type !== 'name') continue;

        const targetModelName = getNodeText(classNameNode, content);

        if (!context.relationshipRegistry.has(context.currentClass)) {
          context.relationshipRegistry.set(context.currentClass, new Map());
        }

        const classRelationships = context.relationshipRegistry.get(context.currentClass)!;
        classRelationships.set(methodNameStr, targetModelName);

        break;
      }
    }
  }
}
