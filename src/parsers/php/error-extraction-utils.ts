import Parser from 'tree-sitter';
import { ParseError } from '../base';

/**
 * Extract syntax errors from the Tree-sitter AST
 */
export function extractErrors(
  rootNode: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  wasChunked: boolean,
  tree?: Parser.Tree
): ParseError[] {
  const errors: ParseError[] = [];
  const seenErrors = new Set<string>();

  // Check if Tree-sitter detected syntax errors at the tree level
  if (tree && tree.rootNode.hasError) {
    // If tree has error but no specific ERROR nodes, we need to create a general syntax error
    let hasSpecificErrors = false;

    // First, try to find specific ERROR nodes
    const findSpecificErrors = (node: Parser.SyntaxNode) => {
      if (node.type === 'ERROR') {
        hasSpecificErrors = true;
        const line = node.startPosition.row + 1;
        const column = node.startPosition.column + 1;
        // Get limited error text (first 50 chars)
        const errorText = getNodeText(node, content);
        const limitedErrorText =
          errorText.length > 50 ? errorText.substring(0, 50) + '...' : errorText;
        // Create unique key to avoid duplicates
        const errorKey = `${line}:${column}:${limitedErrorText}`;
        if (!seenErrors.has(errorKey)) {
          seenErrors.add(errorKey);
          let errorMessage = `Syntax error: unexpected token '${limitedErrorText.trim()}'`;

          // Add chunking context if file was processed in chunks
          if (wasChunked) {
            errorMessage +=
              ' (Note: File was processed in chunks due to size. This may be a chunking boundary issue.)';
          }

          errors.push({
            message: errorMessage,
            line,
            column,
            severity: 'error',
          });
        }
      }
      // Recursively check all children
      for (const child of node.children) {
        findSpecificErrors(child);
      }
    };

    // Look for explicit ERROR nodes first
    findSpecificErrors(rootNode);

    // If no specific ERROR nodes found but tree has error, create a general error
    if (!hasSpecificErrors) {
      errors.push({
        message: 'Syntax error detected in file',
        line: 1,
        column: 1,
        severity: 'error',
      });
    }

    return errors;
  }

  // Fallback to original logic for explicit ERROR nodes only
  // Traverse the AST to find ERROR nodes
  const traverseForErrors = (node: Parser.SyntaxNode) => {
    if (node.type === 'ERROR') {
      const line = node.startPosition.row + 1;
      const column = node.startPosition.column + 1;

      // Get limited error text (first 50 chars)
      const errorText = getNodeText(node, content);
      const limitedErrorText =
        errorText.length > 50 ? errorText.substring(0, 50) + '...' : errorText;

      // Create unique key to avoid duplicates
      const errorKey = `${line}:${column}:${limitedErrorText}`;

      if (!seenErrors.has(errorKey)) {
        seenErrors.add(errorKey);
        errors.push({
          message: `Syntax error: unexpected token '${limitedErrorText.trim()}'`,
          line,
          column,
          severity: 'error',
        });
      }
    }

    // Recursively check all children
    for (const child of node.children) {
      traverseForErrors(child);
    }
  };

  traverseForErrors(rootNode);
  return errors;
}
