import Parser from 'tree-sitter';
import { ParsedSymbol, ParsedExport, ParsedDependency } from '../base';
import { SymbolType, DependencyType, Visibility } from '../../database/models';
import { entityClassifier } from '../../utils/entity-classifier';
import {
  ASTContext,
  GodotContext,
  TypeInfo,
  ParameterInfo,
  PATTERNS,
} from './types';
import {
  extractModifiers,
  getVisibility,
  extractBaseTypes,
  extractReturnType,
  extractParameters,
  extractExplicitInterfaceQualifier,
  buildClassSignature,
  buildInterfaceSignature,
  buildMethodSignature,
  buildConstructorSignature,
} from './signature-utils';
import { extractXmlDocComment } from './xmldoc-utils';
import { buildQualifiedName, isGodotClass, hasAttribute } from './helper-utils';
import { isInsideInterface, findNodesOfType } from './traversal-utils';
import { resolveType } from './type-utils';

type GetNodeTextFn = (node: Parser.SyntaxNode, content: string) => string;

/**
 * Process namespace declaration
 */
export function processNamespace(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  symbols: ParsedSymbol[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  context.currentNamespace = name;
  context.namespaceStack.push(name);

  const description = extractXmlDocComment(node, content, getNodeText);

  symbols.push({
    name,
    symbol_type: SymbolType.NAMESPACE,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: true,
    visibility: Visibility.PUBLIC,
    description,
  });
}

/**
 * Process class declaration with Godot awareness
 */
export function processClass(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  _godotContext: GodotContext,
  symbols: ParsedSymbol[],
  exports: ParsedExport[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);
  const baseTypes = extractBaseTypes(node, content, getNodeText);
  const isGodot = isGodotClass(baseTypes);
  const isPartial = modifiers.includes('partial');

  context.currentClass = name;
  context.classStack.push(name);
  context.isPartialClass = isPartial;

  // Add to type map for resolution
  const qualifiedName = buildQualifiedName(context, name);
  context.typeMap.set(name, {
    type: name,
    fullQualifiedName: qualifiedName,
    source: 'method',
    namespace: context.currentNamespace,
  });

  const description = extractXmlDocComment(node, content, getNodeText);

  // Classify entity type using configuration-driven classifier
  const classification = entityClassifier.classify(
    'class',
    name,
    baseTypes,
    context.filePath || '',
    undefined, // Auto-detect framework
    context.currentNamespace, // Pass namespace for framework detection
    context.options?.repositoryFrameworks // Pass repository frameworks from options
  );

  // Store class framework in context so methods can inherit it
  context.currentClassFramework = classification.framework;

  const symbol: ParsedSymbol = {
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.CLASS,
    entity_type: classification.entityType,
    framework: classification.framework,
    base_class: classification.baseClass || undefined,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: modifiers.includes('public'),
    visibility,
    signature: buildClassSignature(name, modifiers, baseTypes),
    description,
  };

  symbols.push(symbol);
  context.symbolCache.set(qualifiedName, symbol);

  if (modifiers.includes('public')) {
    exports.push({
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1,
    });
  }
}

/**
 * Process interface declaration
 */
export function processInterface(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  symbols: ParsedSymbol[],
  exports: ParsedExport[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);
  const baseTypes = extractBaseTypes(node, content, getNodeText);

  context.currentClass = name;
  context.classStack.push(name);

  const qualifiedName = buildQualifiedName(context, name);
  context.typeMap.set(name, {
    type: name,
    fullQualifiedName: qualifiedName,
    source: 'method',
    namespace: context.currentNamespace,
  });

  const description = extractXmlDocComment(node, content, getNodeText);

  // Classify entity type using configuration-driven classifier
  const classification = entityClassifier.classify(
    'interface',
    name,
    baseTypes,
    context.filePath || '',
    undefined, // Auto-detect framework
    context.currentNamespace, // Pass namespace for framework detection
    context.options?.repositoryFrameworks // Pass repository frameworks from options
  );

  // Store interface framework in context so methods can inherit it
  context.currentClassFramework = classification.framework;

  const symbol: ParsedSymbol = {
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.INTERFACE,
    framework: classification.framework,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: modifiers.includes('public'),
    visibility,
    signature: buildInterfaceSignature(name, modifiers, baseTypes),
    description,
  };

  symbols.push(symbol);
  context.symbolCache.set(qualifiedName, symbol);

  if (modifiers.includes('public')) {
    exports.push({
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1,
    });
  }
}

/**
 * Process struct declaration
 */
export function processStruct(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  symbols: ParsedSymbol[],
  exports: ParsedExport[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);
  const description = extractXmlDocComment(node, content, getNodeText);
  const qualifiedName = context.currentNamespace ? `${context.currentNamespace}.${name}` : name;

  let structFramework: string | undefined;
  if (context.currentClassFramework) {
    structFramework = context.currentClassFramework;
  } else {
    const classification = entityClassifier.classify(
      'struct',
      name,
      [],
      context.filePath || '',
      undefined,
      context.currentNamespace,
      context.options?.repositoryFrameworks
    );
    structFramework = classification.framework;
  }

  symbols.push({
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.STRUCT,
    framework: structFramework,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: modifiers.includes('public'),
    visibility,
    signature: `struct ${name}`,
    description,
  });

  if (modifiers.includes('public')) {
    exports.push({
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1,
    });
  }
}

/**
 * Process enum declaration
 */
export function processEnum(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  symbols: ParsedSymbol[],
  exports: ParsedExport[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);
  const description = extractXmlDocComment(node, content, getNodeText);
  const qualifiedName = context.currentNamespace ? `${context.currentNamespace}.${name}` : name;

  // Detect framework for enum using entity classifier
  let enumFramework: string | undefined;
  if (context.currentClassFramework) {
    enumFramework = context.currentClassFramework;
  } else {
    const classification = entityClassifier.classify(
      'enum',
      name,
      [], // Enums don't have base types
      context.filePath || '',
      undefined, // Auto-detect framework
      context.currentNamespace,
      context.options?.repositoryFrameworks
    );
    enumFramework = classification.framework;
  }

  symbols.push({
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.ENUM,
    framework: enumFramework,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: modifiers.includes('public'),
    visibility,
    signature: `enum ${name}`,
    description,
  });

  const bodyNode = node.childForFieldName('body');
  if (bodyNode) {
    const memberNodes = findNodesOfType(bodyNode, 'enum_member_declaration');
    for (const memberNode of memberNodes) {
      const memberNameNode = memberNode.childForFieldName('name');
      if (!memberNameNode) continue;

      const memberName = getNodeText(memberNameNode, content);
      const qualifiedMemberName = `${name}.${memberName}`;
      const memberDescription = extractXmlDocComment(memberNode, content, getNodeText);

      symbols.push({
        name: memberName,
        qualified_name: qualifiedMemberName,
        symbol_type: SymbolType.CONSTANT,
        framework: enumFramework,
        namespace: context.currentNamespace,
        start_line: memberNode.startPosition.row + 1,
        end_line: memberNode.endPosition.row + 1,
        is_exported: modifiers.includes('public'),
        visibility: Visibility.PUBLIC,
        signature: qualifiedMemberName,
        description: memberDescription,
      });
    }
  }

  if (modifiers.includes('public')) {
    exports.push({
      exported_names: [name],
      export_type: 'named',
      line_number: node.startPosition.row + 1,
    });
  }
}

/**
 * Process method declaration with Godot lifecycle detection
 */
export function processMethod(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  _godotContext: GodotContext,
  symbols: ParsedSymbol[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);
  const returnType = extractReturnType(node, content, getNodeText);
  const parameters = extractParameters(node, content, getNodeText);

  // Extract explicit interface qualifier if present
  const explicitInterfaceQualifier = extractExplicitInterfaceQualifier(node, content, getNodeText);
  const fullMethodName = explicitInterfaceQualifier
    ? `${explicitInterfaceQualifier}.${name}`
    : name;

  const methodQualifiedName = buildQualifiedName(context, name);
  const description = extractXmlDocComment(node, content, getNodeText);

  // Methods inherit framework from their parent class
  const methodFramework = context.currentClassFramework;

  // Interface members are implicitly public
  const isInterfaceMember = isInsideInterface(node);
  const isExported = isInterfaceMember || modifiers.includes('public');

  const symbol: ParsedSymbol = {
    name,
    qualified_name: methodQualifiedName,
    symbol_type: SymbolType.METHOD,
    framework: methodFramework,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: isExported,
    visibility,
    signature: buildMethodSignature(fullMethodName, modifiers, returnType, parameters),
    description,
  };

  symbols.push(symbol);
}

/**
 * Process constructor declaration
 */
export function processConstructor(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  symbols: ParsedSymbol[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);
  const parameters = extractParameters(node, content, getNodeText);
  const description = extractXmlDocComment(node, content, getNodeText);

  symbols.push({
    name,
    symbol_type: SymbolType.METHOD,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: modifiers.includes('public'),
    visibility,
    signature: buildConstructorSignature(name, modifiers, parameters),
    description,
  });
}

/**
 * Process property declaration
 */
export function processProperty(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  _godotContext: GodotContext,
  symbols: ParsedSymbol[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  const typeNode = node.childForFieldName('type');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const propertyType = typeNode ? getNodeText(typeNode, content) : 'object';
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);

  // Add to type map
  context.typeMap.set(name, {
    type: resolveType(propertyType),
    fullQualifiedName: propertyType,
    source: 'property',
    namespace: context.currentNamespace,
  });

  const description = extractXmlDocComment(node, content, getNodeText);

  // Interface members are implicitly public
  const isInterfaceMember = isInsideInterface(node);
  const isExported = isInterfaceMember || modifiers.includes('public');

  symbols.push({
    name,
    symbol_type: SymbolType.PROPERTY,
    framework: context.currentClassFramework,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: isExported,
    visibility,
    signature: `${modifiers.join(' ')} ${propertyType} ${name}`.trim(),
    description,
  });
}

/**
 * Process field declaration with Godot export detection
 */
export function processField(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  godotContext: GodotContext,
  symbols: ParsedSymbol[],
  getNodeText: GetNodeTextFn
): void {
  const variableDeclaration = node.children.find(child => child.type === 'variable_declaration');
  if (!variableDeclaration) return;

  const typeNode = variableDeclaration.childForFieldName('type');
  const fieldType = typeNode ? getNodeText(typeNode, content) : 'object';
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);

  // Check for Godot Export attribute
  const hasExportAttribute = hasAttribute(node, 'Export', content, getNodeText);
  const description = extractXmlDocComment(node, content, getNodeText);

  // Extract each variable declarator
  const declaratorNodes = findNodesOfType(variableDeclaration, 'variable_declarator');
  for (const declarator of declaratorNodes) {
    const nameNode = declarator.childForFieldName('name');
    if (!nameNode) continue;

    const fieldName = getNodeText(nameNode, content);

    const typeInfo: TypeInfo = {
      type: resolveType(fieldType),
      fullQualifiedName: fieldType,
      source: 'field',
      namespace: context.currentNamespace,
    };

    // Add to type map for resolution
    context.typeMap.set(fieldName, typeInfo);

    // If this is a partial class, also store in partialClassFields
    if (context.isPartialClass && context.currentClass) {
      const qualifiedClassName = buildQualifiedName(context, context.currentClass);
      if (!context.partialClassFields.has(qualifiedClassName)) {
        context.partialClassFields.set(qualifiedClassName, new Map());
      }
      context.partialClassFields.get(qualifiedClassName)!.set(fieldName, typeInfo);
    }

    // Track Godot exports
    if (hasExportAttribute) {
      godotContext.exports.set(fieldName, {
        name: fieldName,
        type: fieldType,
      });
    }

    symbols.push({
      name: fieldName,
      symbol_type: modifiers.includes('const') ? SymbolType.CONSTANT : SymbolType.VARIABLE,
      framework: context.currentClassFramework,
      namespace: context.currentNamespace,
      start_line: declarator.startPosition.row + 1,
      end_line: declarator.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: `${modifiers.join(' ')} ${fieldType} ${fieldName}`.trim(),
      description,
    });
  }
}

/**
 * Process event declaration
 */
export function processEvent(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  symbols: ParsedSymbol[],
  getNodeText: GetNodeTextFn
): void {
  const variableDeclaration = node.children.find(child => child.type === 'variable_declaration');
  if (!variableDeclaration) return;

  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);

  const declaratorNodes = findNodesOfType(variableDeclaration, 'variable_declarator');
  for (const declarator of declaratorNodes) {
    const nameNode = declarator.childForFieldName('name');
    if (!nameNode) continue;

    const name = getNodeText(nameNode, content);
    const description = extractXmlDocComment(node, content, getNodeText);

    symbols.push({
      name,
      symbol_type: SymbolType.VARIABLE,
      framework: context.currentClassFramework,
      namespace: context.currentNamespace,
      start_line: declarator.startPosition.row + 1,
      end_line: declarator.endPosition.row + 1,
      is_exported: modifiers.includes('public'),
      visibility,
      signature: `event ${name}`,
      description,
    });
  }
}

/**
 * Process delegate declaration
 */
export function processDelegate(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  symbols: ParsedSymbol[],
  getNodeText: GetNodeTextFn
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const visibility = getVisibility(modifiers, node);

  const isSignal = hasAttribute(node, 'Signal', content, getNodeText);

  const description = extractXmlDocComment(node, content, getNodeText);

  let delegateFramework: string | undefined;
  if (context.currentClassFramework) {
    delegateFramework = context.currentClassFramework;
  } else {
    const classification = entityClassifier.classify(
      'delegate',
      name,
      [],
      context.filePath || '',
      undefined,
      context.currentNamespace,
      context.options?.repositoryFrameworks
    );
    delegateFramework = classification.framework;
  }

  if (isSignal && !delegateFramework) {
    delegateFramework = 'godot';
  }

  symbols.push({
    name,
    symbol_type: SymbolType.TYPE_ALIAS,
    framework: delegateFramework,
    namespace: context.currentNamespace,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: modifiers.includes('public'),
    visibility,
    signature: `delegate ${name}`,
    description,
  });
}

/**
 * Process local variable declaration
 */
export function processLocalDeclaration(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  getNodeText: GetNodeTextFn,
  inferTypeFromExpressionFn: (
    node: Parser.SyntaxNode,
    content: string,
    context: ASTContext,
    getNodeTextFn: GetNodeTextFn
  ) => string | null
): void {
  const variableDeclaration = node.children.find(child => child.type === 'variable_declaration');
  if (!variableDeclaration) return;

  const typeNode = variableDeclaration.childForFieldName('type');
  const declaredType = typeNode ? getNodeText(typeNode, content) : null;

  // Process each variable declarator
  const declaratorNodes = findNodesOfType(variableDeclaration, 'variable_declarator');
  for (const declarator of declaratorNodes) {
    const nameNode = declarator.childForFieldName('name');
    if (!nameNode) continue;

    const varName = getNodeText(nameNode, content);
    let inferredType: string | null = null;

    // If type is explicitly declared (not 'var')
    if (declaredType && declaredType !== 'var') {
      inferredType = resolveType(declaredType);
    } else {
      // Type is 'var' - try to infer from initializer
      const initializerNode = declarator.namedChildren.find(
        child =>
          child !== nameNode && // Skip the name identifier
          child.type !== 'bracketed_argument_list' // Skip array brackets if present
      );

      if (initializerNode) {
        inferredType = inferTypeFromExpressionFn(initializerNode, content, context, getNodeText);
      }
    }

    // Add to type map if we have a type
    if (inferredType) {
      const resolvedType = resolveType(inferredType);
      context.typeMap.set(varName, {
        type: resolvedType,
        fullQualifiedName: inferredType,
        source: 'variable',
        namespace: context.currentNamespace,
      });
    }
  }
}

/**
 * Process member access expression
 */
export function processMemberAccess(
  node: Parser.SyntaxNode,
  content: string,
  context: ASTContext,
  dependencies: ParsedDependency[],
  getNodeText: GetNodeTextFn,
  findContainingMethodFn: (
    node: Parser.SyntaxNode,
    context: ASTContext,
    content: string,
    getNodeTextFn: GetNodeTextFn,
    buildQualifiedNameFn: typeof buildQualifiedName
  ) => string
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;

  // Get the full qualified name (e.g., "GameConstants.CARD_BACK_PATH") instead of just the name part
  let memberName = getNodeText(node, content);

  // Strip "this." prefix as it's redundant for local class references
  if (memberName.startsWith('this.')) {
    memberName = memberName.substring(5);
  }

  const callerName = findContainingMethodFn(node, context, content, getNodeText, buildQualifiedName);

  dependencies.push({
    from_symbol: callerName,
    to_symbol: memberName,
    dependency_type: DependencyType.REFERENCES,
    line_number: node.startPosition.row + 1,
  });
}

/**
 * Process inheritance relationships
 */
export function processInheritance(
  node: Parser.SyntaxNode,
  content: string,
  _context: ASTContext,
  dependencies: ParsedDependency[],
  getNodeText: GetNodeTextFn,
  findParentDeclarationFn: (node: Parser.SyntaxNode) => Parser.SyntaxNode | null,
  extractBaseTypesFromListFn: (
    baseList: Parser.SyntaxNode,
    content: string,
    getNodeTextFn: GetNodeTextFn
  ) => string[]
): void {
  const parent = findParentDeclarationFn(node);
  if (!parent) return;

  const parentNameNode = parent.childForFieldName('name');
  if (!parentNameNode) return;

  const fromSymbol = getNodeText(parentNameNode, content);
  const isInterface = parent.type === 'interface_declaration';
  const baseTypes = extractBaseTypesFromListFn(node, content, getNodeText);

  for (let i = 0; i < baseTypes.length; i++) {
    const baseName = baseTypes[i];
    const isFirstItem = i === 0;
    const looksLikeInterface = PATTERNS.interfacePrefix.test(baseName);

    let dependencyType: DependencyType;
    if (isInterface) {
      dependencyType = DependencyType.INHERITS;
    } else if (isFirstItem && !looksLikeInterface) {
      dependencyType = DependencyType.INHERITS;
    } else {
      dependencyType = DependencyType.IMPLEMENTS;
    }

    dependencies.push({
      from_symbol: fromSymbol,
      to_symbol: baseName,
      dependency_type: dependencyType,
      line_number: node.startPosition.row + 1,
    });
  }
}
