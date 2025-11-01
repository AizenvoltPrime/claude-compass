import Parser from 'tree-sitter';
import * as path from 'path';
import { ParsedSymbol } from '../base';
import { SymbolType, JobQueueType, WorkerType } from '../../database/models';
import * as AstHelpers from './ast-helper-utils';

export function extractJobSymbols(
  filePath: string,
  content: string,
  jobSystems: (JobQueueType | WorkerType)[],
  parseContent: (content: string) => Parser.Tree | null,
  findNodesOfType: (rootNode: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  if (jobSystems.length === 0) return symbols;

  // Skip detailed analysis for large files to avoid Tree-sitter limits
  if (content.length > 28000) {
    return symbols;
  }

  const tree = parseContent(content);
  if (!tree) return symbols;

  // Extract queue definitions
  const queueSymbols = extractQueueDefinitions(tree, content, jobSystems, findNodesOfType);
  symbols.push(...queueSymbols);

  // Extract job definitions
  const jobSymbols = extractJobDefinitions(tree, content, findNodesOfType);
  symbols.push(...jobSymbols);

  // Extract processors
  const processorSymbols = extractJobProcessors(tree, content, findNodesOfType);
  symbols.push(...processorSymbols);

  // Extract worker threads
  const workerSymbols = extractWorkerThreads(tree, content, findNodesOfType);
  symbols.push(...workerSymbols);

  return symbols;
}

export function extractQueueDefinitions(
  tree: Parser.Tree,
  content: string,
  jobSystems: (JobQueueType | WorkerType)[],
  findNodesOfType: (rootNode: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  const variableNodes = findNodesOfType(tree.rootNode, 'variable_declarator');
  for (const node of variableNodes) {
    const queueSymbol = extractQueueSymbol(node, content, jobSystems);
    if (queueSymbol) symbols.push(queueSymbol);
  }

  return symbols;
}

export function extractJobDefinitions(
  tree: Parser.Tree,
  content: string,
  findNodesOfType: (rootNode: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  const callNodes = findNodesOfType(tree.rootNode, 'call_expression');
  for (const node of callNodes) {
    const jobSymbol = extractJobDefinitionSymbol(node, content);
    if (jobSymbol) symbols.push(jobSymbol);
  }

  return symbols;
}

export function extractJobProcessors(
  tree: Parser.Tree,
  content: string,
  findNodesOfType: (rootNode: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  const callNodes = findNodesOfType(tree.rootNode, 'call_expression');
  for (const node of callNodes) {
    const processorSymbol = extractProcessorSymbol(node, content);
    if (processorSymbol) symbols.push(processorSymbol);
  }

  return symbols;
}

export function extractWorkerThreads(
  tree: Parser.Tree,
  content: string,
  findNodesOfType: (rootNode: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  const callNodes = findNodesOfType(tree.rootNode, 'call_expression');
  for (const node of callNodes) {
    const workerSymbol = extractWorkerThreadSymbol(node, content);
    if (workerSymbol) symbols.push(workerSymbol);
  }

  return symbols;
}

export function extractQueueSymbol(
  node: Parser.SyntaxNode,
  content: string,
  jobSystems: (JobQueueType | WorkerType)[]
): ParsedSymbol | null {
  const nameNode = node.children.find(child => child.type === 'identifier');
  if (!nameNode) return null;

  const name = AstHelpers.getNodeText(nameNode, content);

  // Check if this looks like a queue definition
  const initNode = node.children.find(child => child.type === 'call_expression');
  if (!initNode) return null;

  const initText = AstHelpers.getNodeText(initNode, content);
  if (!/new\s+(Bull|Queue|Agenda)/i.test(initText)) return null;

  return {
    name,
    symbol_type: SymbolType.JOB_QUEUE,
    start_line: AstHelpers.getLineNumber(node.startIndex, content),
    end_line: AstHelpers.getLineNumber(node.endIndex, content),
    is_exported: false,
    signature: `Queue: ${name}`,
  };
}

export function extractJobDefinitionSymbol(
  node: Parser.SyntaxNode,
  content: string
): ParsedSymbol | null {
  const functionName = AstHelpers.getFunctionNameFromCall(node, content);
  if (!functionName) return null;

  // Look for job definition patterns
  if (!['add', 'define', 'every', 'schedule', 'now'].includes(functionName)) {
    return null;
  }

  const args = AstHelpers.getCallArguments(node);
  if (args.length === 0) return null;

  const jobName = AstHelpers.getStringLiteral(args[0], content);
  if (!jobName) return null;

  return {
    name: jobName,
    symbol_type: SymbolType.JOB_DEFINITION,
    start_line: AstHelpers.getLineNumber(node.startIndex, content),
    end_line: AstHelpers.getLineNumber(node.endIndex, content),
    is_exported: false,
    signature: `Job: ${jobName} (${functionName})`,
  };
}

export function extractProcessorSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
  const functionName = AstHelpers.getFunctionNameFromCall(node, content);
  if (!functionName || functionName !== 'process') return null;

  const args = AstHelpers.getCallArguments(node);
  if (args.length === 0) return null;

  const jobType = AstHelpers.getStringLiteral(args[0], content);
  const processorName = jobType ? `${jobType}_processor` : 'job_processor';

  return {
    name: processorName,
    symbol_type: SymbolType.FUNCTION,
    start_line: AstHelpers.getLineNumber(node.startIndex, content),
    end_line: AstHelpers.getLineNumber(node.endIndex, content),
    is_exported: false,
    signature: `Processor: ${processorName}`,
  };
}

export function extractWorkerThreadSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
  const initText = AstHelpers.getNodeText(node, content);
  if (!initText.includes('new Worker(')) return null;

  const args = AstHelpers.getCallArguments(node);
  if (args.length === 0) return null;

  const workerFile = AstHelpers.getStringLiteral(args[0], content);
  const workerName = workerFile ? path.basename(workerFile, path.extname(workerFile)) : 'worker';

  return {
    name: `${workerName}_thread`,
    symbol_type: SymbolType.WORKER_THREAD,
    start_line: AstHelpers.getLineNumber(node.startIndex, content),
    end_line: AstHelpers.getLineNumber(node.endIndex, content),
    is_exported: false,
    signature: `Worker: ${workerName}`,
  };
}
