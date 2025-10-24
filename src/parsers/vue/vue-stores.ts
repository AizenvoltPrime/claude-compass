import Parser from 'tree-sitter';
import { PiniaStore } from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { createComponentLogger } from '../../utils/logger';
import { findParent, findPropertyInObject, findReturnValue, extractObjectKeys } from './vue-utils';

const logger = createComponentLogger('vue-stores');

export async function parsePiniaStore(
  tree: Parser.Tree | null,
  content: string,
  filePath: string,
  options: FrameworkParseOptions
): Promise<PiniaStore[]> {
  try {
    if (content.length > 28000) {
      return [];
    }

    if (!tree?.rootNode) return [];

    const storeDefinitions = findStoreDefinitions(tree.rootNode);
    if (storeDefinitions.length === 0) return [];

    const stores: PiniaStore[] = [];

    for (const storeDefinition of storeDefinitions) {
      const store: any = {
        type: 'store',
        name: storeDefinition.composableName,
        filePath,
        state: storeDefinition.state,
        getters: storeDefinition.getters,
        actions: storeDefinition.actions,
        metadata: {
          storeId: storeDefinition.id,
          style: storeDefinition.style,
          state: storeDefinition.state,
          getters: storeDefinition.getters,
          actions: storeDefinition.actions,
          composableName: storeDefinition.composableName,
          isDefaultExport: storeDefinition.isDefaultExport,
        },
      };

      stores.push(store);
    }

    return stores;
  } catch (error) {
    logger.error(`Failed to parse Pinia stores in ${filePath}`, { error });
    return [];
  }
}

export function findStoreDefinitions(node: Parser.SyntaxNode): Array<{
  name: string;
  id: string;
  state: string[];
  getters: string[];
  actions: string[];
  composableName: string;
  isDefaultExport: boolean;
  style: string;
}> {
  const storeDefinitions: any[] = [];

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      if (functionNode?.text === 'defineStore') {
        const storeDef = parseDefineStoreCall(node);
        if (storeDef) {
          storeDefinitions.push(storeDef);
        }
      }
    }

    if (node.type === 'variable_declarator' || node.type === 'export_default_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(node);
  return storeDefinitions;
}

export function parseDefineStoreCall(callNode: Parser.SyntaxNode): {
  name: string;
  id: string;
  state: string[];
  getters: string[];
  actions: string[];
  composableName: string;
  isDefaultExport: boolean;
  style: string;
} | null {
  const argsNode = callNode.child(1);
  if (!argsNode) return null;

  let storeId = '';
  let storeConfig: Parser.SyntaxNode | null = null;
  let composableName = 'useStore';
  let isDefaultExport = false;

  const parent = findParent(callNode, 'variable_declarator');
  if (parent) {
    const nameNode = parent.child(0);
    if (nameNode?.text) {
      composableName = nameNode.text;
    }
  }

  const exportParent = findParent(callNode, 'export_default_declaration');
  if (exportParent) {
    isDefaultExport = true;
  }

  const firstArg = argsNode.child(1);
  const secondArg = argsNode.child(3);

  if (firstArg) {
    if (firstArg.type === 'string') {
      storeId = firstArg.text.replace(/['"]/g, '');
      storeConfig = secondArg;
    } else if (firstArg.type === 'object') {
      storeConfig = firstArg;
      storeId = findPropertyInObject(firstArg, 'id') || '';
    }
  }

  if (!storeConfig || !storeId) return null;

  let style = 'options';
  if (secondArg && secondArg.type === 'arrow_function') {
    style = 'setup';
  }

  let state: string[] = [];
  let getters: string[] = [];
  let actions: string[] = [];

  if (style === 'setup' && secondArg?.type === 'arrow_function') {
    const setupContent = extractSetupStoreContent(secondArg);
    state = setupContent.state;
    getters = setupContent.getters;
    actions = setupContent.actions;
  } else if (style === 'options' && storeConfig) {
    state = extractStoreSection(storeConfig, 'state');
    getters = extractStoreSection(storeConfig, 'getters');
    actions = extractStoreSection(storeConfig, 'actions');
  }

  return {
    name: storeId,
    id: storeId,
    state,
    getters,
    actions,
    composableName,
    isDefaultExport,
    style,
  };
}

export function extractSetupStoreContent(functionNode: Parser.SyntaxNode): {
  state: string[];
  getters: string[];
  actions: string[];
} {
  const state: string[] = [];
  const getters: string[] = [];
  const actions: string[] = [];

  let body: Parser.SyntaxNode | null = null;
  for (let i = 0; i < functionNode.childCount; i++) {
    const child = functionNode.child(i);
    if (child?.type === 'statement_block') {
      body = child;
      break;
    }
  }

  if (!body) return { state, getters, actions };

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === 'variable_declarator') {
      const nameNode = node.child(0);
      const valueNode = node.child(2);
      const varName = nameNode?.text;

      if (varName && valueNode) {
        if (valueNode.type === 'call_expression') {
          const functionCall = valueNode.child(0);
          const funcName = functionCall?.text;

          if (funcName === 'ref' || funcName === 'reactive') {
            state.push(varName);
          } else if (funcName === 'computed') {
            getters.push(varName);
          }
        } else if (
          valueNode.type === 'arrow_function' ||
          valueNode.type === 'function_expression'
        ) {
          actions.push(varName);
        }
      }
    }

    if (node.type === 'function_declaration') {
      let nameNode = null;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'identifier') {
          nameNode = child;
          break;
        }
      }

      if (nameNode?.text) {
        actions.push(nameNode.text);
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(body);
  return { state, getters, actions };
}

export function extractStoreSection(configNode: Parser.SyntaxNode, sectionName: string): string[] {
  const items: string[] = [];

  for (let i = 0; i < configNode.childCount; i++) {
    const pairNode = configNode.child(i);
    if (pairNode?.type === 'pair') {
      const keyNode = pairNode.child(0);
      const valueNode = pairNode.child(2);

      if (keyNode?.text === sectionName && valueNode) {
        if (sectionName === 'state' && valueNode.type === 'arrow_function') {
          const returnValue = findReturnValue(valueNode);
          if (returnValue?.type === 'object') {
            items.push(...extractObjectKeys(returnValue));
          }
        } else if (valueNode.type === 'object') {
          items.push(...extractObjectKeys(valueNode));
        }
      }
    }
  }

  return items;
}
