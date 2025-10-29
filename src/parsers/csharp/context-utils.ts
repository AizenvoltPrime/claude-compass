import { ASTContext } from './types';

/**
 * Initialize AST context for efficient traversal
 *
 * Creates a properly initialized context with namespace and class stacks,
 * type maps, and caches for efficient AST traversal.
 */
export function initializeASTContext(
  currentChunkNamespace?: string,
  currentChunkStructures?: {
    namespace?: string;
    classes?: string[];
    qualifiedClassName?: string;
  },
  enclosingStructures?: {
    namespace?: string;
    classes?: string[];
    qualifiedClassName?: string;
  }
): ASTContext {
  const namespaceStack: string[] = [];
  let currentNamespace: string | undefined;
  const classStack: string[] = [];
  let currentClass: string | undefined;

  if (currentChunkNamespace) {
    namespaceStack.push(currentChunkNamespace);
    currentNamespace = currentChunkNamespace;
  }

  const structures = enclosingStructures || currentChunkStructures;

  if (structures) {
    if (structures.namespace) {
      if (!namespaceStack.includes(structures.namespace)) {
        namespaceStack.push(structures.namespace);
        currentNamespace = structures.namespace;
      }
    }

    if (structures.classes && structures.classes.length > 0) {
      classStack.push(...structures.classes);
      currentClass = classStack[classStack.length - 1];
    }
  }

  return {
    typeMap: new Map(),
    methodMap: new Map(),
    namespaceStack,
    classStack,
    currentNamespace,
    currentClass,
    usingDirectives: new Set(),
    symbolCache: new Map(),
    nodeCache: new Map(),
    partialClassFields: new Map(),
    isPartialClass: false,
    currentMethodParameters: new Map(),
  };
}
