import Parser from 'tree-sitter';
import { DependencyType } from '../../database/models';
import { ParsedDependency, ParseResult } from '../base';
import { ASTContext, GodotContext } from './types';
import { findChildByType, findNodeOfType } from './traversal-utils';

/**
 * Initialize Godot-specific context
 */
export function initializeGodotContext(): GodotContext {
  return {
    signals: new Map(),
    exports: new Map(),
    nodePaths: new Set(),
    autoloads: new Set(),
    sceneReferences: new Set(),
  };
}

/**
 * Process Godot-specific method calls
 */
export function processGodotMethodCall(
  methodName: string,
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  godotContext: GodotContext,
  dependencies: ParsedDependency[],
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
  findContainingMethodFn: (
    node: Parser.SyntaxNode,
    context: ASTContext,
    content: string,
    getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string,
    buildQualifiedNameFn: (context: ASTContext, name: string) => string
  ) => string,
  buildQualifiedNameFn: (context: ASTContext, name: string) => string,
  extractGenericTypeParameterFn: (
    invocationNode: Parser.SyntaxNode,
    content: string,
    getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
  ) => string | null
): void {
  const callerName = findContainingMethodFn(
    node,
    context,
    content,
    getNodeTextFn,
    buildQualifiedNameFn
  );
  if (!callerName) return;

  // Handle GetNode calls - create dependency to the referenced scene node
  if (methodName === 'GetNode') {
    // Extract generic type parameter (for metadata only)
    const genericType = extractGenericTypeParameterFn(node, content, getNodeTextFn);

    // Extract node path from first argument
    const nodePath = extractStringArgument(node, content, 0, getNodeTextFn);

    if (nodePath) {
      // Store node path for metadata
      godotContext.nodePaths.add(nodePath);

      // Check for autoload pattern (/root/ServiceName)
      if (nodePath.startsWith('/root/')) {
        const autoloadName = nodePath.substring(6);
        godotContext.autoloads.add(autoloadName);

        // Create dependency to autoload singleton class
        // Autoloads are actual C# classes that can be resolved
        dependencies.push({
          from_symbol: callerName,
          to_symbol: autoloadName,
          dependency_type: DependencyType.REFERENCES,
          line_number: node.startPosition.row + 1,
          parameter_context: `GetNode("/root/${autoloadName}")`,
        });
      } else {
        // Regular scene node reference
        // Create dependency to scene node (not framework type)
        // Prefix with "node:" to indicate this is a scene node reference
        // This can be resolved against godot_nodes table during graph building
        dependencies.push({
          from_symbol: callerName,
          to_symbol: `node:${nodePath}`,
          dependency_type: DependencyType.REFERENCES,
          line_number: node.startPosition.row + 1,
          // Preserve type information in parameter_context
          parameter_context: genericType
            ? `GetNode<${genericType}>("${nodePath}")`
            : `GetNode("${nodePath}")`,
        });
      }
    }
  }

  // Handle Connect calls - create dependency to signal handler method
  else if (methodName === 'Connect') {
    // Extract handler method name from Callable constructor using AST
    // Pattern: .Connect(signalName, new Callable(this, MethodName.HandlerMethod))
    const handlerMethodName = extractCallableHandlerName(node, content, getNodeTextFn);

    if (handlerMethodName) {
      // Create dependency to the handler method
      const handlerQualifiedName = context.currentClass
        ? `${context.currentClass}::${handlerMethodName}`
        : handlerMethodName;

      dependencies.push({
        from_symbol: callerName,
        to_symbol: handlerQualifiedName,
        dependency_type: DependencyType.REFERENCES,
        line_number: node.startPosition.row + 1,
        parameter_context: `Connect(signal, ${handlerMethodName})`,
      });
    }
  }

  // Handle EmitSignal calls - track signal emissions for metadata
  else if (methodName === 'EmitSignal') {
    // Extract signal name from first argument using AST
    const signalName = extractSignalName(node, content, getNodeTextFn);

    if (signalName) {
      if (!godotContext.signals.has(signalName)) {
        godotContext.signals.set(signalName, {
          name: signalName,
          parameters: [],
          emitters: [callerName],
        });
      } else {
        godotContext.signals.get(signalName)!.emitters.push(callerName);
      }
    }
  }
}

/**
 * Extract string literal argument from invocation using AST.
 */
export function extractStringArgument(
  node: Parser.SyntaxNode,
  content: string,
  argIndex: number,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  // Find argument_list child
  const argumentList = node.children.find(child => child.type === 'argument_list');
  if (!argumentList) return null;

  // Get all argument nodes (named children of argument_list)
  const args = argumentList.namedChildren;
  if (argIndex >= args.length) return null;

  const argNode = args[argIndex];

  // Handle string_literal directly
  if (argNode.type === 'string_literal') {
    const text = getNodeTextFn(argNode, content);
    // Remove quotes (handles both " and @")
    return text.replace(/^@?"(.*)"$/, '$1');
  }

  // Handle argument containing string_literal
  const stringLiteral = argNode.children.find(child => child.type === 'string_literal');
  if (stringLiteral) {
    const text = getNodeTextFn(stringLiteral, content);
    return text.replace(/^@?"(.*)"$/, '$1');
  }

  return null;
}

/**
 * Extract handler method name from Callable constructor in Connect() call.
 * Pattern: new Callable(this, MethodName.HandlerMethod)
 */
export function extractCallableHandlerName(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  // Find argument_list of Connect() call
  const argumentList = node.children.find(child => child.type === 'argument_list');
  if (!argumentList) return null;

  // Find object_creation_expression for "new Callable(...)"
  let callableCreation: Parser.SyntaxNode | null = null;

  for (const arg of argumentList.namedChildren) {
    // Look for object_creation_expression directly or within argument
    if (arg.type === 'object_creation_expression') {
      callableCreation = arg;
      break;
    }

    const creationNode = arg.children.find(c => c.type === 'object_creation_expression');
    if (creationNode) {
      callableCreation = creationNode;
      break;
    }
  }

  if (!callableCreation) return null;

  // Find argument_list of Callable constructor
  const callableArgs = callableCreation.children.find(child => child.type === 'argument_list');
  if (!callableArgs) return null;

  // Second argument is the handler method (MethodName.HandlerMethod or just handler name)
  const namedArgs = callableArgs.namedChildren;
  if (namedArgs.length < 2) return null;

  const handlerArg = namedArgs[1];

  // Handle member_access_expression (MethodName.OnPhaseChanged)
  const memberAccess =
    handlerArg.type === 'member_access_expression'
      ? handlerArg
      : handlerArg.children.find(c => c.type === 'member_access_expression');

  if (memberAccess) {
    const nameNode = memberAccess.childForFieldName('name');
    if (nameNode) {
      return getNodeTextFn(nameNode, content);
    }
  }

  // Handle direct identifier
  const identifier =
    handlerArg.type === 'identifier'
      ? handlerArg
      : handlerArg.children.find(c => c.type === 'identifier');

  if (identifier) {
    return getNodeTextFn(identifier, content);
  }

  return null;
}

/**
 * Extract signal name from EmitSignal() call.
 * Handles: EmitSignal("SignalName"), EmitSignal(nameof(SignalName)), EmitSignal(SignalName.SignalName)
 */
export function extractSignalName(
  node: Parser.SyntaxNode,
  content: string,
  getNodeTextFn: (node: Parser.SyntaxNode, content: string) => string
): string | null {
  // Find argument_list
  const argumentList = node.children.find(child => child.type === 'argument_list');
  if (!argumentList || argumentList.namedChildren.length === 0) return null;

  const firstArg = argumentList.namedChildren[0];

  // Handle string literal: EmitSignal("SignalName")
  if (firstArg.type === 'string_literal') {
    const text = getNodeTextFn(firstArg, content);
    return text.replace(/^@?"(.*)"$/, '$1');
  }

  const stringLiteral = firstArg.children.find(c => c.type === 'string_literal');
  if (stringLiteral) {
    const text = getNodeTextFn(stringLiteral, content);
    return text.replace(/^@?"(.*)"$/, '$1');
  }

  // Handle nameof: EmitSignal(nameof(SignalName))
  const nameofInvocation = firstArg.children.find(c => c.type === 'invocation_expression');
  if (nameofInvocation) {
    const nameofArgs = nameofInvocation.children.find(c => c.type === 'argument_list');
    if (nameofArgs && nameofArgs.namedChildren.length > 0) {
      const innerArg = nameofArgs.namedChildren[0];
      const identifier =
        innerArg.type === 'identifier'
          ? innerArg
          : innerArg.children.find(c => c.type === 'identifier');
      if (identifier) {
        return getNodeTextFn(identifier, content);
      }
    }
  }

  // Handle member access: EmitSignal(SignalName.SignalName)
  const memberAccess =
    firstArg.type === 'member_access_expression'
      ? firstArg
      : firstArg.children.find(c => c.type === 'member_access_expression');

  if (memberAccess) {
    const nameNode = memberAccess.childForFieldName('name');
    if (nameNode) {
      return getNodeTextFn(nameNode, content);
    }
  }

  // Handle direct identifier: EmitSignal(SignalName)
  const identifier =
    firstArg.type === 'identifier'
      ? firstArg
      : firstArg.children.find(c => c.type === 'identifier');

  if (identifier) {
    return getNodeTextFn(identifier, content);
  }

  return null;
}

/**
 * Enhance results with Godot-specific relationships
 */
export function enhanceGodotRelationships(result: ParseResult, godotContext: GodotContext): void {
  // Add signal connections
  for (const [signalName, signalInfo] of godotContext.signals) {
    for (const emitter of signalInfo.emitters) {
      result.dependencies.push({
        from_symbol: emitter,
        to_symbol: `signal:${signalName}`,
        dependency_type: DependencyType.REFERENCES,
        line_number: 0,
      });
    }
  }

  // Add node path references
  for (const nodePath of godotContext.nodePaths) {
    result.dependencies.push({
      from_symbol: '<scene>',
      to_symbol: `node:${nodePath}`,
      dependency_type: DependencyType.REFERENCES,
      line_number: 0,
    });
  }

  // Add autoload references
  for (const autoload of godotContext.autoloads) {
    result.dependencies.push({
      from_symbol: '<global>',
      to_symbol: `autoload:${autoload}`,
      dependency_type: DependencyType.REFERENCES,
      line_number: 0,
    });
  }
}
