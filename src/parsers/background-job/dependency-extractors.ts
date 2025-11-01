import Parser from 'tree-sitter';
import { ParsedDependency } from '../base';
import { DependencyType } from '../../database/models';
import * as AstHelpers from './ast-helper-utils';

export function extractJobDependencies(
  filePath: string,
  content: string,
  parseContent: (content: string) => Parser.Tree | null,
  findNodesOfType: (rootNode: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  // Skip detailed analysis for large files to avoid Tree-sitter limits
  if (content.length > 28000) {
    return dependencies;
  }

  const tree = parseContent(content);
  if (!tree) return dependencies;

  // Look for job processing relationships
  const callNodes = findNodesOfType(tree.rootNode, 'call_expression');
  for (const node of callNodes) {
    const dependency = extractJobCallDependency(node, content);
    if (dependency) dependencies.push(dependency);
  }

  return dependencies;
}

export function extractJobCallDependency(
  node: Parser.SyntaxNode,
  content: string
): ParsedDependency | null {
  const functionName = AstHelpers.getFunctionNameFromCall(node, content);
  if (!functionName) return null;

  // Job processing dependencies
  if (['add', 'process', 'define', 'every', 'schedule'].includes(functionName)) {
    const args = AstHelpers.getCallArguments(node);
    if (args.length > 0) {
      const targetJob = AstHelpers.getStringLiteral(args[0], content);
      if (targetJob) {
        return {
          from_symbol: 'current_context',
          to_symbol: targetJob,
          dependency_type: DependencyType.PROCESSES_JOB,
          line_number: AstHelpers.getLineNumber(node.startIndex, content),
        };
      }
    }
  }

  return null;
}
