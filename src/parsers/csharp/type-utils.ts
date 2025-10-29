import Parser from 'tree-sitter';
import { ASTContext } from './types';

/**
 * Resolve object type from expression
 */
export function resolveObjectType(objectExpression: string, context: ASTContext): string | undefined {
  if (!objectExpression) return undefined;

  // Handle this. prefix
  const cleanedObject = objectExpression.replace(/^this\./, '');

  // Try direct lookup first
  let typeInfo = context.typeMap.get(cleanedObject);

  // Handle private field naming conventions
  if (!typeInfo) {
    // Try with underscore prefix for private fields
    if (!cleanedObject.startsWith('_')) {
      typeInfo = context.typeMap.get('_' + cleanedObject);
    }
    // Try without underscore prefix
    else if (cleanedObject.startsWith('_')) {
      typeInfo = context.typeMap.get(cleanedObject.substring(1));
    }
  }

  return typeInfo?.type;
}

/**
 * Resolve class name with using directives
 */
export function resolveClassNameWithUsings(className: string, context: ASTContext): string {
  if (!className) return className;

  if (className.includes('.')) {
    return className;
  }

  if (context.currentNamespace && isDefinedInCurrentNamespace(className, context)) {
    return `${context.currentNamespace}.${className}`;
  }

  for (const usingDirective of context.usingDirectives) {
    const potentialFqn = `${usingDirective}.${className}`;
    return potentialFqn;
  }

  return className;
}

/**
 * Resolve type string (currently identity function)
 */
export function resolveType(typeString: string): string {
  // Return the actual type name as declared in the code, including interface "I" prefix
  // The type system and symbol resolution should handle interface vs implementation resolution,
  // not arbitrary name transformations
  return typeString;
}

/**
 * Resolve fully qualified name
 */
export function resolveFQN(className: string, context: ASTContext): string {
  if (className.includes('.')) {
    return className;
  }

  for (const usingDirective of context.usingDirectives) {
    const potentialFqn = `${usingDirective}.${className}`;
    return potentialFqn;
  }

  if (context.currentNamespace) {
    return `${context.currentNamespace}.${className}`;
  }

  return className;
}

/**
 * Check if type is a C# built-in type
 */
export function isBuiltInType(type: string): boolean {
  const builtIns = new Set([
    'string',
    'int',
    'float',
    'double',
    'decimal',
    'bool',
    'byte',
    'sbyte',
    'short',
    'ushort',
    'uint',
    'long',
    'ulong',
    'char',
    'object',
    'void',
    'dynamic',
    'var',
    'nint',
    'nuint',
    'Action',
    'Func',
    'Task',
    'ValueTask',
    'Exception',
    'IEnumerable',
    'ICollection',
    'IList',
    'IDictionary',
    'IQueryable',
    'List',
    'Dictionary',
    'HashSet',
    'Queue',
    'Stack',
    'Array',
    'Tuple',
    'ValueTuple',
  ]);
  return builtIns.has(type) || /^System\./.test(type);
}

/**
 * Check if class is defined in current namespace (placeholder)
 */
export function isDefinedInCurrentNamespace(_className: string, _context: ASTContext): boolean {
  return false;
}

/**
 * Extract generic type parameter from invocation expression
 */
export function extractGenericTypeParameter(
  invocationNode: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  // The type_argument_list is inside generic_name, not directly under invocation_expression
  // Structure: invocation_expression -> generic_name -> type_argument_list -> type_argument

  // First, look for generic_name or member_access_expression that contains generic_name
  let genericNameNode: Parser.SyntaxNode | null = null;

  for (const child of invocationNode.children) {
    if (child.type === 'generic_name') {
      genericNameNode = child;
      break;
    } else if (child.type === 'member_access_expression') {
      // The generic_name might be nested in member_access_expression
      // e.g., obj.GetNode<T>() -> member_access_expression contains generic_name
      const nestedGeneric = child.children.find(c => c.type === 'generic_name');
      if (nestedGeneric) {
        genericNameNode = nestedGeneric;
        break;
      }
    }
  }

  if (!genericNameNode) return null;

  // Now find the type_argument_list within generic_name
  const typeArgList = genericNameNode.children.find(child => child.type === 'type_argument_list');

  if (!typeArgList) return null;

  // Get the first type argument (most common case)
  // The type_argument_list contains direct type nodes, not wrapped in 'type_argument'
  const typeArgNodes = typeArgList.namedChildren;
  if (typeArgNodes.length === 0) return null;

  // Get the text of the first type argument
  return getNodeTextFn(typeArgNodes[0], content);
}

/**
 * Infer type from expression node (complex switch-based inference)
 */
export function inferTypeFromExpression(
  expressionNode: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  switch (expressionNode.type) {
    // Generic method invocation: GetNode<Node3D>()
    case 'invocation_expression': {
      const genericType = extractGenericTypeParameter(expressionNode, content, getNodeTextFn);
      if (genericType) return genericType;
      // TODO: Could infer return type from method signature lookup
      return null;
    }

    // Object creation: new List<string>() or new Node3D()
    case 'object_creation_expression':
    case 'implicit_object_creation_expression': {
      const typeNode = expressionNode.childForFieldName('type');
      if (typeNode) {
        return getNodeTextFn(typeNode, content);
      }
      return null;
    }

    // Array creation: new int[10] or new[] { 1, 2, 3 }
    case 'array_creation_expression': {
      const typeNode = expressionNode.childForFieldName('type');
      if (typeNode) {
        return getNodeTextFn(typeNode, content);
      }
      return null;
    }

    case 'implicit_array_creation_expression': {
      // new[] { ... } - would need to infer from elements
      return null;
    }

    // Literals
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal':
    case 'interpolated_string_expression':
      return 'string';

    case 'integer_literal':
      return 'int';

    case 'real_literal':
      return 'float';

    case 'boolean_literal':
      return 'bool';

    case 'null_literal':
      return 'null';

    case 'character_literal':
      return 'char';

    // Member access: GameConstants.PLAYER_HAND_PATH
    case 'member_access_expression': {
      // Try to infer type from the member being accessed
      const nameNode = expressionNode.childForFieldName('name');
      if (nameNode) {
        const memberName = getNodeTextFn(nameNode, content);
        // Check if we have type information for this member
        const typeInfo = context.typeMap.get(memberName);
        if (typeInfo) return typeInfo.type;
      }
      return null;
    }

    // Identifier: just a variable reference
    case 'identifier': {
      const varName = getNodeTextFn(expressionNode, content);
      const typeInfo = context.typeMap.get(varName);
      if (typeInfo) return typeInfo.type;
      return null;
    }

    // Conditional expression: condition ? trueExpr : falseExpr
    case 'conditional_expression': {
      // Infer from the true branch (both branches should have same type)
      const trueExpr = expressionNode.children.find(
        c => c.type !== '?' && c.type !== ':' && c.type !== 'expression'
      );
      if (trueExpr) {
        return inferTypeFromExpression(trueExpr, content, context, getNodeTextFn);
      }
      return null;
    }

    // Binary expressions: a + b, a * b, etc.
    case 'binary_expression': {
      const operatorNode = expressionNode.children.find(c =>
        ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '&&', '||'].includes(c.type)
      );

      if (!operatorNode) return null;

      const operator = operatorNode.type;

      // Comparison operators return bool
      if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(operator)) {
        return 'bool';
      }

      // Arithmetic operators - infer from left operand
      const leftNode = expressionNode.childForFieldName('left');
      if (leftNode) {
        return inferTypeFromExpression(leftNode, content, context, getNodeTextFn);
      }

      return null;
    }

    // Cast expression: (Type)value
    case 'cast_expression': {
      const typeNode = expressionNode.childForFieldName('type');
      if (typeNode) {
        return getNodeTextFn(typeNode, content);
      }
      return null;
    }

    // As expression: value as Type
    case 'as_expression': {
      const typeNode = expressionNode.childForFieldName('right');
      if (typeNode) {
        return getNodeTextFn(typeNode, content);
      }
      return null;
    }

    // Default expression: default(Type) or default
    case 'default_expression': {
      const typeNode = expressionNode.childForFieldName('type');
      if (typeNode) {
        return getNodeTextFn(typeNode, content);
      }
      return null;
    }

    // Parenthesized expression: (expression)
    case 'parenthesized_expression': {
      const innerExpr = expressionNode.namedChildren[0];
      if (innerExpr) {
        return inferTypeFromExpression(innerExpr, content, context, getNodeTextFn);
      }
      return null;
    }

    // Lambda expressions, anonymous methods, etc. - can't easily infer
    case 'lambda_expression':
    case 'anonymous_method_expression':
    case 'anonymous_object_creation_expression':
      return null;

    // For any other expression type, we can't infer
    default:
      return null;
  }
}
