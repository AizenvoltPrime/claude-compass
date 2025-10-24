import Parser from 'tree-sitter';
import { ParsedDependency } from '../base';
import { DependencyType } from '../../database/models';
import { PHPParsingContext } from './types';
import {
  findContainingFunction,
  extractCallingObject,
  resolvePhpType,
  extractCallParameters,
  generateQualifiedContext,
  generateCallInstanceId,
  isBuiltInType,
  resolveFQN,
  extractEloquentRelationshipDependencies
} from './';

export function extractCallDependency(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency | null {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return null;

  let functionName: string;

  if (functionNode.type === 'name') {
    functionName = getNodeText(functionNode, content);
  } else if (functionNode.type === 'qualified_name') {
    functionName = getNodeText(functionNode, content);
  } else {
    return null;
  }

  const callerName = findContainingFunction(node, content, getNodeText);
  const { values: parameters, types: parameterTypes } = extractCallParameters(node, content, context.typeMap, getNodeText);
  const qualifiedContext = generateQualifiedContext(context.currentNamespace, context.currentClass, '', functionName);
  const callInstanceId = generateCallInstanceId(context.currentClass, functionName, node.startPosition.row, node.startPosition.column);

  return {
    from_symbol: callerName,
    to_symbol: functionName,
    dependency_type: DependencyType.CALLS,
    line_number: node.startPosition.row + 1,
    calling_object: undefined,
    resolved_class: undefined,
    qualified_context: qualifiedContext,
    parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
    parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
    call_instance_id: callInstanceId,
  };
}

export function extractMethodCallDependency(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency | null {
  const memberNode = node.childForFieldName('name');
  if (!memberNode) return null;

  const methodName = getNodeText(memberNode, content);
  const callerName = findContainingFunction(node, content, getNodeText);
  const callingObject = extractCallingObject(node, content, getNodeText);
  const resolvedClass = resolvePhpType(callingObject, context.typeMap, context);
  const { values: parameters, types: parameterTypes } = extractCallParameters(node, content, context.typeMap, getNodeText);
  const qualifiedContext = generateQualifiedContext(context.currentNamespace, context.currentClass, callingObject, methodName);
  const callInstanceId = generateCallInstanceId(context.currentClass, methodName, node.startPosition.row, node.startPosition.column);

  return {
    from_symbol: callerName,
    to_symbol: methodName,
    dependency_type: DependencyType.CALLS,
    line_number: node.startPosition.row + 1,
    calling_object: callingObject || undefined,
    resolved_class: resolvedClass,
    qualified_context: qualifiedContext,
    parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
    parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
    call_instance_id: callInstanceId,
  };
}

export function extractNewDependency(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency | null {
  const classNode = node.childForFieldName('class');
  if (!classNode) return null;

  let className: string;
  if (classNode.type === 'name') {
    className = getNodeText(classNode, content);
  } else if (classNode.type === 'qualified_name') {
    className = getNodeText(classNode, content);
  } else {
    return null;
  }

  const callerName = findContainingFunction(node, content, getNodeText);
  const { values: parameters, types: parameterTypes } = extractCallParameters(node, content, context.typeMap, getNodeText);
  const qualifiedContext = generateQualifiedContext(context.currentNamespace, context.currentClass, 'new', className);
  const callInstanceId = generateCallInstanceId(context.currentClass, className, node.startPosition.row, node.startPosition.column);

  return {
    from_symbol: callerName,
    to_symbol: className,
    dependency_type: DependencyType.REFERENCES,
    line_number: node.startPosition.row + 1,
    calling_object: undefined,
    resolved_class: className,
    qualified_context: qualifiedContext,
    parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
    parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
    call_instance_id: callInstanceId,
  };
}

export function extractScopedCallDependency(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency[] | null {
  const children = node.children;
  if (children.length < 3) return null;

  const classNode = children[0];
  const methodNode = children[2];

  if (classNode.type !== 'name' || methodNode.type !== 'name') return null;

  const className = getNodeText(classNode, content);
  const methodName = getNodeText(methodNode, content);
  const callerName = findContainingFunction(node, content, getNodeText);
  const callingObject = `${className}::`;

  let resolvedClass: string | null;
  let fullyQualifiedName: string | null = null;

  if (className === 'self' || className === 'static') {
    resolvedClass = context.currentClass;
    if (context.currentNamespace && context.currentClass) {
      fullyQualifiedName = `${context.currentNamespace}\\${context.currentClass}`;
    }
  } else if (className === 'parent') {
    resolvedClass = context.parentClass;
    if (context.currentNamespace && context.parentClass) {
      fullyQualifiedName = `${context.currentNamespace}\\${context.parentClass}`;
    }
  } else {
    resolvedClass = className;

    const normalizedClassName = className.replace(/^\\/, '');

    if (process.env.CLAUDE_COMPASS_DEBUG === 'true' && className === 'Personnel') {
      console.log('[PHP Parser Debug] Resolving Personnel static call', {
        className,
        normalizedClassName,
        useStatementsCount: context.useStatements.length,
        useStatements: context.useStatements.map(u => u.imported_names),
        currentNamespace: context.currentNamespace,
        filePath: context.filePath
      });
    }

    for (const useStmt of context.useStatements) {
      if (!useStmt.imported_names) continue;

      for (const importedName of useStmt.imported_names) {
        const parts = importedName.split('\\');
        const lastPart = parts[parts.length - 1];

        if (lastPart === normalizedClassName || importedName === normalizedClassName) {
          fullyQualifiedName = importedName;
          break;
        }

        if (importedName.endsWith(`\\${normalizedClassName}`)) {
          fullyQualifiedName = importedName;
          break;
        }
      }
      if (fullyQualifiedName) break;
    }

    if (!fullyQualifiedName && context.currentNamespace) {
      fullyQualifiedName = `${context.currentNamespace}\\${className}`;
    } else if (!fullyQualifiedName) {
      fullyQualifiedName = className;
    }

    if (process.env.CLAUDE_COMPASS_DEBUG === 'true' && className === 'Personnel') {
      console.log('[PHP Parser Debug] Final FQN for Personnel', {
        fullyQualifiedName,
        toQualifiedName: fullyQualifiedName ? `${fullyQualifiedName}::${methodName}` : undefined
      });
    }
  }

  const { values: parameters, types: parameterTypes } = extractCallParameters(node, content, context.typeMap, getNodeText);
  const qualifiedContext = generateQualifiedContext(context.currentNamespace, context.currentClass, callingObject, methodName);
  const callInstanceId = generateCallInstanceId(context.currentClass, methodName, node.startPosition.row, node.startPosition.column);

  const dependencies: ParsedDependency[] = [];

  dependencies.push({
    from_symbol: callerName,
    to_symbol: methodName,
    to_qualified_name: fullyQualifiedName ? `${fullyQualifiedName}::${methodName}` : undefined,
    dependency_type: DependencyType.CALLS,
    line_number: node.startPosition.row + 1,
    calling_object: callingObject,
    resolved_class: resolvedClass || undefined,
    qualified_context: qualifiedContext,
    parameter_context: parameters.length > 0 ? parameters.join(', ') : undefined,
    parameter_types: parameterTypes.length > 0 ? parameterTypes : undefined,
    call_instance_id: callInstanceId,
  });

  if (className !== 'self' && className !== 'static' && className !== 'parent') {
    dependencies.push({
      from_symbol: callerName,
      to_symbol: className,
      to_qualified_name: fullyQualifiedName,
      dependency_type: DependencyType.REFERENCES,
      line_number: node.startPosition.row + 1,
    });
  }

  if (methodName === 'with' && node.namedChildCount > 0) {
    const relationshipDeps = extractEloquentRelationshipDependencies(
      node,
      content,
      callerName,
      className,
      fullyQualifiedName,
      context,
      getNodeText
    );
    dependencies.push(...relationshipDeps);
  }

  return dependencies;
}

export function extractConstructorDependencies(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];
  const parametersNode = node.childForFieldName('parameters');

  if (!parametersNode || !context.currentClass) {
    return dependencies;
  }

  for (const param of parametersNode.children) {
    if (param.type !== 'simple_parameter' && param.type !== 'property_promotion_parameter') {
      continue;
    }

    const typeNode = param.childForFieldName('type');
    if (!typeNode) continue;

    let typeName = getNodeText(typeNode, content).trim();

    if (isBuiltInType(typeName)) continue;

    typeName = typeName.replace(/^\?/, '');

    const unionTypes = typeName.split('|').map(t => t.trim());

    for (const singleType of unionTypes) {
      if (isBuiltInType(singleType)) continue;

      const fullyQualifiedType = resolveFQN(singleType, context);

      dependencies.push({
        from_symbol: context.currentClass,
        to_symbol: singleType,
        to_qualified_name: fullyQualifiedType,
        dependency_type: DependencyType.IMPORTS,
        line_number: param.startPosition.row + 1,
      });
    }
  }

  return dependencies;
}

export function extractMethodTypeDependencies(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];
  const methodName = node.childForFieldName('name')
    ? getNodeText(node.childForFieldName('name')!, content)
    : 'anonymous';

  const parametersNode = node.childForFieldName('parameters');
  if (parametersNode) {
    for (const param of parametersNode.children) {
      if (param.type !== 'simple_parameter' && param.type !== 'property_promotion_parameter') {
        continue;
      }

      const typeNode = param.childForFieldName('type');
      if (!typeNode) continue;

      let typeName = getNodeText(typeNode, content).trim();
      if (isBuiltInType(typeName)) continue;

      typeName = typeName.replace(/^\?/, '');

      const unionTypes = typeName.split('|').map(t => t.trim());

      for (const singleType of unionTypes) {
        if (isBuiltInType(singleType)) continue;

        const fullyQualifiedType = resolveFQN(singleType, context);

        dependencies.push({
          from_symbol: methodName,
          to_symbol: singleType,
          to_qualified_name: fullyQualifiedType,
          dependency_type: DependencyType.REFERENCES,
          line_number: param.startPosition.row + 1,
          qualified_context: `parameter type hint in ${methodName}`,
        });
      }
    }
  }

  const returnTypeNode = node.childForFieldName('return_type');
  if (returnTypeNode) {
    let returnType = getNodeText(returnTypeNode, content).trim();

    if (!isBuiltInType(returnType)) {
      returnType = returnType.replace(/^\?/, '');

      const unionTypes = returnType.split('|').map(t => t.trim());

      for (const singleType of unionTypes) {
        if (isBuiltInType(singleType)) continue;

        const fullyQualifiedType = resolveFQN(singleType, context);

        dependencies.push({
          from_symbol: methodName,
          to_symbol: singleType,
          to_qualified_name: fullyQualifiedType,
          dependency_type: DependencyType.REFERENCES,
          line_number: returnTypeNode.startPosition.row + 1,
          qualified_context: `return type hint in ${methodName}`,
        });
      }
    }
  }

  return dependencies;
}
