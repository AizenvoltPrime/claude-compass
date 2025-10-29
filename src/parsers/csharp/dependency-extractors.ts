import Parser from 'tree-sitter';
import { DependencyType } from '../../database/models';
import { ParsedDependency, ParsedImport } from '../base';
import { ASTContext, MethodCall, ParameterInfo } from './types';
import { isBuiltInType } from './type-utils';
import { findChildByType, findNodeOfType } from './traversal-utils';

type GetNodeTextFn = (node: Parser.SyntaxNode, content: string) => string;

/**
 * Extract method call information from invocation expression
 */
export function extractMethodCall(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  extractCallParametersFn: (
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
  ) => { values: string[]; types: string[] },
  extractNameofIdentifierFn: (
    node: Parser.SyntaxNode,
    content: string,
    getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
  ) => string | null,
  resolveObjectTypeFn: (objectExpression: string, context: ASTContext) => string | undefined
): MethodCall | null {
  const functionNode = node.childForFieldName('function');
  if (!functionNode) return null;

  let methodName = '';
  let callingObject = '';
  let resolvedClass: string | undefined;

  if (functionNode.type === 'member_access_expression') {
    const nameNode = functionNode.childForFieldName('name');
    const objectNode = functionNode.childForFieldName('expression');

    methodName = nameNode ? getNodeTextFn(nameNode, content) : '';
    callingObject = objectNode ? getNodeTextFn(objectNode, content) : '';

    resolvedClass = resolveObjectTypeFn(callingObject, context);
  } else if (functionNode.type === 'identifier') {
    methodName = getNodeTextFn(functionNode, content);
    // Method call without object, likely on current class
    callingObject = 'this';
    resolvedClass = context.currentClass;
  } else if (functionNode.type === 'generic_name') {
    // Handle generic method calls like GetNode<T>()
    // generic_name structure: child(0) = identifier, child(1) = type_argument_list
    const identifierNode = functionNode.child(0);
    methodName =
      identifierNode && identifierNode.type === 'identifier'
        ? getNodeTextFn(identifierNode, content)
        : '';
    // Generic method call without object, likely on current class
    callingObject = 'this';
    resolvedClass = context.currentClass;
  } else if (functionNode.type === 'conditional_access_expression') {
    // Handle nested conditional access
    return extractConditionalCall(
      functionNode,
      content,
      context,
      getNodeTextFn,
      extractCallParametersFn,
      resolveObjectTypeFn
    );
  }

  const { values: parameters, types: parameterTypes } = extractCallParametersFn(
    node,
    content,
    context,
    getNodeTextFn
  );

  // Handle Godot's CallDeferred(nameof(MethodName)) pattern
  // This creates a reflection-based call that should be tracked as a dependency
  if (
    (methodName === 'CallDeferred' || methodName === 'CallDeferredThreadGroup') &&
    parameters.length > 0
  ) {
    const deferredMethodName = extractNameofIdentifierFn(node, content, getNodeTextFn);
    if (deferredMethodName) {
      // Create a call to the deferred method instead of CallDeferred
      methodName = deferredMethodName;
      // The deferred method is on the current class (this)
      callingObject = 'this';
      resolvedClass = context.currentClass;
    }
  }

  const fullyQualifiedName = resolvedClass ? `${resolvedClass}.${methodName}` : methodName;

  return {
    methodName,
    callingObject,
    resolvedClass,
    parameters,
    parameterTypes,
    fullyQualifiedName,
  };
}

/**
 * Extract method call from conditional access expression (?.operator)
 */
export function extractConditionalCall(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  extractCallParametersFn: (
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
  ) => { values: string[]; types: string[] },
  resolveObjectTypeFn: (objectExpression: string, context: ASTContext) => string | undefined
): MethodCall | null {
  // For conditional access, the structure is:
  // conditional_access_expression -> identifier + member_binding_expression

  if (node.namedChildCount < 2) return null;

  const objectNode = node.namedChild(0); // The object being accessed (_handManager)
  const memberBindingNode = node.namedChild(1); // The member binding (.SetHandPositions)

  if (!objectNode || !memberBindingNode) return null;

  const callingObject = getNodeTextFn(objectNode, content);

  // Extract method name from member binding expression
  let methodName = '';
  if (memberBindingNode.type === 'member_binding_expression') {
    // Find the identifier within the member binding
    const identifierNode = findChildByType(memberBindingNode, 'identifier');
    if (identifierNode) {
      methodName = getNodeTextFn(identifierNode, content);
    }
  }

  if (!methodName) return null;

  const resolvedClass = resolveObjectTypeFn(callingObject, context);

  let parameters: string[] = [];
  let parameterTypes: string[] = [];
  if (node.parent?.type === 'invocation_expression') {
    const extracted = extractCallParametersFn(node.parent, content, context, getNodeTextFn);
    parameters = extracted.values;
    parameterTypes = extracted.types;
  }

  const fullyQualifiedName = resolvedClass ? `${resolvedClass}.${methodName}` : methodName;

  return {
    methodName,
    callingObject,
    resolvedClass,
    parameters,
    parameterTypes,
    fullyQualifiedName,
  };
}

/**
 * Extract constructor call information
 */
export function extractConstructorCall(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  extractCallParametersFn: (
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
  ) => { values: string[]; types: string[] },
  resolveTypeFn: (typeString: string) => string
): MethodCall | null {
  const typeNode = node.childForFieldName('type');
  if (!typeNode) return null;

  const typeName = getNodeTextFn(typeNode, content);
  const { values: parameters, types: parameterTypes } = extractCallParametersFn(
    node,
    content,
    context,
    getNodeTextFn
  );
  const resolvedClass = resolveTypeFn(typeName);

  return {
    methodName: 'constructor',
    callingObject: '',
    resolvedClass,
    parameters,
    parameterTypes,
    fullyQualifiedName: `${resolvedClass}.constructor`,
  };
}

/**
 * Process using directives
 */
export function processUsing(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  imports: ParsedImport[],
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): void {
  const nameNode = node.children.find(
    child => child.type === 'identifier' || child.type === 'qualified_name'
  );
  if (!nameNode) return;

  const namespaceName = getNodeTextFn(nameNode, content);
  context.usingDirectives.add(namespaceName);

  imports.push({
    source: namespaceName,
    imported_names: ['*'],
    import_type: 'namespace',
    line_number: node.startPosition.row + 1,
    is_dynamic: false,
  });
}

/**
 * Process extern alias directives
 */
export function processExternAlias(
  node: Parser.SyntaxNode,
  content: string,
  imports: ParsedImport[],
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const aliasName = getNodeTextFn(nameNode, content);

  imports.push({
    source: aliasName,
    imported_names: [aliasName],
    import_type: 'named',
    line_number: node.startPosition.row + 1,
    is_dynamic: false,
  });
}

/**
 * Extract constructor parameter dependencies
 */
export function extractConstructorDependencies(
  parameters: ParameterInfo[],
  context: ASTContext,
  lineNumber: number,
  resolveFQNFn: (className: string, context: ASTContext) => string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  if (!context.currentClass || parameters.length === 0) {
    return dependencies;
  }

  for (const param of parameters) {
    let typeName = param.type.trim();

    if (isBuiltInType(typeName)) continue;

    typeName = typeName.replace(/^\?/, '');

    const genericMatch = typeName.match(/^([^<]+)<(.+)>$/);
    if (genericMatch) {
      const baseType = genericMatch[1].trim();
      const genericArgs = genericMatch[2].split(',').map(t => t.trim());

      if (!isBuiltInType(baseType)) {
        const fullyQualifiedType = resolveFQNFn(baseType, context);
        dependencies.push({
          from_symbol: context.currentClass,
          to_symbol: baseType,
          to_qualified_name: fullyQualifiedType,
          dependency_type: DependencyType.IMPORTS,
          line_number: lineNumber,
        });
      }

      for (const genericArg of genericArgs) {
        const cleanArg = genericArg.trim();
        if (!isBuiltInType(cleanArg)) {
          const fullyQualifiedArg = resolveFQNFn(cleanArg, context);
          dependencies.push({
            from_symbol: context.currentClass,
            to_symbol: cleanArg,
            to_qualified_name: fullyQualifiedArg,
            dependency_type: DependencyType.IMPORTS,
            line_number: lineNumber,
          });
        }
      }
    } else {
      const fullyQualifiedType = resolveFQNFn(typeName, context);
      dependencies.push({
        from_symbol: context.currentClass,
        to_symbol: typeName,
        to_qualified_name: fullyQualifiedType,
        dependency_type: DependencyType.IMPORTS,
        line_number: lineNumber,
      });
    }
  }

  return dependencies;
}

/**
 * Extract containment relationships between parent classes/interfaces and their methods.
 * Creates CONTAINS dependencies when a class/interface/struct contains methods or properties.
 * Uses line range overlap to identify parent-child relationships.
 */
export function extractContainmentDependencies(
  symbols: import('../base').ParsedSymbol[]
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];
  const { SymbolType } = require('../../database/models');

  // Potential child symbols: methods and properties (C# fields are also stored as properties)
  const childCandidates = symbols.filter(
    s => s.symbol_type === SymbolType.METHOD || s.symbol_type === SymbolType.PROPERTY
  );

  // Potential parent symbols: classes, interfaces, structs
  const parentCandidates = symbols.filter(
    s =>
      s.symbol_type === SymbolType.CLASS ||
      s.symbol_type === SymbolType.INTERFACE ||
      s.symbol_type === SymbolType.STRUCT
  );

  if (childCandidates.length === 0 || parentCandidates.length === 0) return dependencies;

  // For each symbol, check if it's nested inside another symbol
  for (const child of childCandidates) {
    for (const parent of parentCandidates) {
      // Skip self-comparison
      if (child === parent) continue;

      // Skip if they don't have proper line ranges
      if (!child.start_line || !child.end_line || !parent.start_line || !parent.end_line) {
        continue;
      }

      // Check if parent's line range fully contains the child
      const isContained = parent.start_line < child.start_line && parent.end_line > child.end_line;

      if (isContained) {
        // Ensure we only capture direct containment (not grandparent)
        const hasIntermediateParent = parentCandidates.some(intermediate => {
          if (intermediate === parent || intermediate === child) return false;
          if (!intermediate.start_line || !intermediate.end_line) return false;

          const intermediateContainsChild =
            intermediate.start_line < child.start_line && intermediate.end_line > child.end_line;

          const parentContainsIntermediate =
            parent.start_line < intermediate.start_line && parent.end_line > intermediate.end_line;

          return intermediateContainsChild && parentContainsIntermediate;
        });

        if (!hasIntermediateParent) {
          dependencies.push({
            from_symbol: parent.name,
            to_symbol: child.name,
            dependency_type: DependencyType.CONTAINS,
            line_number: child.start_line,
          });
        }
      }
    }
  }

  return dependencies;
}

/**
 * Extract parameter values and types from call
 */
export function extractCallParameters(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): { values: string[]; types: string[] } {
  const values: string[] = [];
  const types: string[] = [];
  const argumentList = findNodeOfType(node, 'argument_list');

  if (argumentList) {
    for (let i = 0; i < argumentList.childCount; i++) {
      const child = argumentList.child(i);
      if (child?.type === 'argument') {
        const text = getNodeTextFn(child, content).trim();
        if (text) {
          values.push(text);
          types.push(inferParameterType(text, context));
        }
      }
    }
  }

  return { values, types };
}

/**
 * Infer parameter type from text
 */
export function inferParameterType(paramText: string, context: ASTContext): string {
  const cleanParam = paramText
    .replace(/^(ref|out|in)\s+/, '')
    .replace(/^.*:\s*/, '')
    .trim();

  if (cleanParam === 'null') return 'null';
  if (cleanParam === 'true' || cleanParam === 'false') return 'bool';
  if (/^".*"$/.test(cleanParam) || /^'.*'$/.test(cleanParam)) return 'string';
  if (/^\d+\.\d+[fFdDmM]?$/.test(cleanParam)) return 'float';
  if (/^\d+[uUlL]*$/.test(cleanParam)) return 'int';

  const methodParamType = context.currentMethodParameters.get(cleanParam);
  if (methodParamType) return methodParamType;

  const typeInfo = context.typeMap.get(cleanParam);
  if (typeInfo) return typeInfo.type;

  const dotIndex = cleanParam.indexOf('.');
  if (dotIndex > 0) {
    const objectName = cleanParam.substring(0, dotIndex);
    const methodParamTypeFromObject = context.currentMethodParameters.get(objectName);
    if (methodParamTypeFromObject) return methodParamTypeFromObject;

    const objectType = context.typeMap.get(objectName);
    if (objectType) return objectType.type;
  }

  return 'unknown';
}

/**
 * Extract the identifier from a nameof() expression in the first argument
 * Used to track CallDeferred(nameof(MethodName)) as a method call dependency
 */
export function extractNameofIdentifier(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  // Find the argument_list node
  const argumentList = findNodeOfType(node, 'argument_list');
  if (!argumentList || argumentList.namedChildCount === 0) return null;

  // Get the first argument
  const firstArg = argumentList.namedChild(0);
  if (!firstArg || firstArg.type !== 'argument') return null;

  // Look for invocation_expression (the nameof call itself)
  const invocationNode = findNodeOfType(firstArg, 'invocation_expression');
  if (!invocationNode) return null;

  // Verify it's actually a nameof call
  const functionNode = invocationNode.childForFieldName('function');
  if (!functionNode) return null;

  const functionName = getNodeTextFn(functionNode, content);
  if (functionName !== 'nameof') return null;

  // Extract the argument to nameof()
  const nameofArgList = findNodeOfType(invocationNode, 'argument_list');
  if (!nameofArgList || nameofArgList.namedChildCount === 0) return null;

  const nameofArg = nameofArgList.namedChild(0);
  if (!nameofArg) return null;

  // The argument text is the identifier we want (e.g., "InitializeGameplayCoordination")
  const identifier = getNodeTextFn(nameofArg, content).trim();
  return identifier || null;
}

/**
 * Unified dependency processing
 *
 * Orchestrates dependency extraction from different node types (invocations,
 * conditional access, object creation) and processes Godot-specific patterns.
 */
export function processDependency(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  godotContext: any, // GodotContext from godot-utils
  dependencies: ParsedDependency[],
  getNodeText: GetNodeTextFn,
  callInstanceCounters: Map<string, number>,
  findContainingMethodFn: (node: Parser.SyntaxNode, ctx: ASTContext, cnt: string) => string | null,
  buildQualifiedNameFn: (context: ASTContext, name: string) => string,
  buildQualifiedContextFn: (methodCall: MethodCall) => string,
  generateCallInstanceIdFn: (methodName: string, lineNumber: number, counters: Map<string, number>) => string,
  resolveObjectTypeFn: (objExpr: string, ctx: ASTContext) => string | null,
  resolveTypeFn: (typeStr: string) => string,
  resolveClassNameWithUsingsFn: (className: string, ctx: ASTContext) => string,
  processGodotMethodCallFn: (
    methodName: string,
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    godotContext: any,
    dependencies: ParsedDependency[],
    getNodeText: GetNodeTextFn,
    findContainingMethodFn: (n: Parser.SyntaxNode, ctx: ASTContext, cnt: string) => string | null,
    buildQualifiedNameFn: (ctx: ASTContext, name: string) => string,
    extractGenericTypeParameterFn: (invNode: Parser.SyntaxNode, cnt: string, getNodeTextFn: GetNodeTextFn) => string | null
  ) => void,
  extractGenericTypeParameterFn: (invNode: Parser.SyntaxNode, cnt: string, getNodeTextFn: GetNodeTextFn) => string | null
): void {
  const callerName = findContainingMethodFn(node, context, content);
  if (!callerName || callerName.trim() === '') return;

  const isClassOnly = context.currentClass && callerName === context.currentClass;
  if (isClassOnly) return;

  let methodCall: MethodCall | null = null;

  switch (node.type) {
    case 'invocation_expression':
      methodCall = extractMethodCall(
        node,
        content,
        context,
        getNodeText,
        extractCallParameters,
        extractNameofIdentifier,
        (objExpr: string, ctx: ASTContext) => resolveObjectTypeFn(objExpr, ctx)
      );
      break;
    case 'conditional_access_expression':
      methodCall = extractConditionalCall(
        node,
        content,
        context,
        getNodeText,
        extractCallParameters,
        (objExpr: string, ctx: ASTContext) => resolveObjectTypeFn(objExpr, ctx)
      );
      break;
    case 'object_creation_expression':
      methodCall = extractConstructorCall(
        node,
        content,
        context,
        getNodeText,
        extractCallParameters,
        (typeStr: string) => resolveTypeFn(typeStr)
      );
      break;
  }

  if (!methodCall) return;

  // Process Godot-specific method calls
  processGodotMethodCallFn(
    methodCall.methodName,
    node,
    content,
    context,
    godotContext,
    dependencies,
    getNodeText,
    findContainingMethodFn,
    buildQualifiedNameFn,
    extractGenericTypeParameterFn
  );

  const callInstanceId = generateCallInstanceIdFn(
    methodCall.methodName,
    node.startPosition.row + 1,
    callInstanceCounters
  );

  const qualifiedContext = buildQualifiedContextFn(methodCall);

  // Calculate fully qualified class name for to_qualified_name
  const fullyQualifiedClassName = methodCall.resolvedClass
    ? resolveClassNameWithUsingsFn(methodCall.resolvedClass, context)
    : undefined;

  const toQualifiedName = fullyQualifiedClassName
    ? `${fullyQualifiedClassName}::${methodCall.methodName}`
    : undefined;

  dependencies.push({
    from_symbol: callerName,
    to_symbol: methodCall.fullyQualifiedName,
    to_qualified_name: toQualifiedName,
    dependency_type: DependencyType.CALLS,
    line_number: node.startPosition.row + 1,
    calling_object: methodCall.callingObject || undefined,
    resolved_class: methodCall.resolvedClass,
    parameter_context:
      methodCall.parameters.length > 0 ? methodCall.parameters.join(', ') : undefined,
    parameter_types: methodCall.parameterTypes.length > 0 ? methodCall.parameterTypes : undefined,
    call_instance_id: callInstanceId,
    qualified_context: qualifiedContext,
  });
}

