import Parser from 'tree-sitter';
import { PropDefinition, VueComponent } from '../base';
import { extractTemplateDependencies } from './vue-template';
import * as path from 'path';

/**
 * Parse props from an AST node (object or array)
 */
export function parsePropsFromNode(
  node: Parser.SyntaxNode | null,
  extractStringLiteralFn: (node: Parser.SyntaxNode | null) => string | null
): PropDefinition[] {
  const props: PropDefinition[] = [];

  if (!node) return props;

  // Handle array format: ['prop1', 'prop2']
  if (node.type === 'array') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const propName = extractStringLiteralFn(child);
        if (propName) {
          props.push({
            name: propName,
            type: 'unknown',
            required: false,
          });
        }
      }
    }
    return props;
  }

  // Handle object format: { prop1: String, prop2: { type: Number, required: true } }
  if (node.type === 'object') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'pair') {
        const propNameNode = child.child(0);
        const propName = extractStringLiteralFn(propNameNode) || propNameNode?.text;

        if (propName) {
          const propValue = child.child(2); // After property name and ':'

          if (propValue) {
            props.push(parsePropDefinition(propName, propValue, extractStringLiteralFn));
          }
        }
      }
    }
  }

  return props;
}

/**
 * Parse a single prop definition
 */
export function parsePropDefinition(
  name: string,
  valueNode: Parser.SyntaxNode | null,
  extractStringLiteralFn: (node: Parser.SyntaxNode | null) => string | null
): PropDefinition {
  const prop: PropDefinition = {
    name,
    type: 'unknown',
    required: false,
  };

  if (!valueNode) return prop;

  // Simple type: prop: String
  if (valueNode.type === 'identifier') {
    prop.type = valueNode.text.toLowerCase();
    return prop;
  }

  // Object definition: prop: { type: String, required: true, default: 'value' }
  if (valueNode.type === 'object') {
    for (let i = 0; i < valueNode.childCount; i++) {
      const child = valueNode.child(i);
      if (child && child.type === 'pair') {
        const keyNode = child.child(0);
        const key = keyNode?.text;
        const value = child.child(2);

        if (key === 'type' && value?.type === 'identifier') {
          prop.type = value.text.toLowerCase();
        } else if (key === 'required' && value?.text === 'true') {
          prop.required = true;
        } else if (key === 'default') {
          prop.default = extractStringLiteralFn(value) || value?.text;
        }
      }
    }
  }

  return prop;
}

/**
 * Parse emits array from node
 */
export function parseEmitsArray(
  arrayNode: Parser.SyntaxNode,
  getNodeTextFn: (node: Parser.SyntaxNode) => string
): string[] {
  const emits: string[] = [];

  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i);
    if (child?.type === 'string') {
      const emitName = getNodeTextFn(child).replace(/['"]/g, '');
      if (emitName && !emits.includes(emitName)) {
        emits.push(emitName);
      }
    }
  }

  return emits;
}

/**
 * Extract composables used in setup function
 */
export function extractComposablesFromSetup(setupNode: Parser.SyntaxNode): string[] {
  const composables: string[] = [];

  const traverse = (node: Parser.SyntaxNode) => {
    // Look for function calls starting with 'use'
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      const functionName = functionNode?.text;

      if (functionName && functionName.startsWith('use') && functionName.length > 3) {
        if (!composables.includes(functionName)) {
          composables.push(functionName);
        }
      }
    }

    // Recursively traverse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(setupNode);
  return composables;
}

/**
 * Parse Vue component options object
 */
export function parseComponentOptions(
  configNode: Parser.SyntaxNode,
  definitionType: string,
  getNodeTextFn: (node: Parser.SyntaxNode) => string,
  extractStringLiteralFn: (node: Parser.SyntaxNode | null) => string | null
): {
  props: PropDefinition[];
  emits: string[];
  slots: string[];
  composables: string[];
  templateDependencies: string[];
  isCompositionAPI: boolean;
  hasTemplate: boolean;
  definitionType: string;
  lifecycle: string[];
} {
  const result = {
    props: [] as PropDefinition[],
    emits: [] as string[],
    slots: [] as string[],
    composables: [] as string[],
    templateDependencies: [] as string[],
    isCompositionAPI: false,
    hasTemplate: false,
    definitionType,
    lifecycle: [] as string[],
  };

  for (let i = 0; i < configNode.childCount; i++) {
    const pairNode = configNode.child(i);
    if (pairNode?.type === 'pair') {
      const keyNode = pairNode.child(0);
      const valueNode = pairNode.child(2);
      const key = keyNode?.text?.replace(/['"]/g, '');

      if (!key || !valueNode) continue;

      switch (key) {
        case 'props':
          result.props = parsePropsFromNode(valueNode, extractStringLiteralFn);
          break;

        case 'emits':
          if (valueNode.type === 'array') {
            result.emits = parseEmitsArray(valueNode, getNodeTextFn);
          }
          break;

        case 'setup':
          result.isCompositionAPI = true;
          result.composables = extractComposablesFromSetup(valueNode);
          break;

        case 'template':
          result.hasTemplate = true;
          if (valueNode.type === 'string') {
            const templateContent = getNodeTextFn(valueNode).replace(/['"]/g, '');
            result.templateDependencies = extractTemplateDependencies(templateContent);
            result.slots = extractSlots(templateContent);
          }
          break;

        case 'methods':
        case 'computed':
          // Could be enhanced to extract method/computed names and parse bodies for $emit calls
          break;

        case 'data':
          // In Options API, data function exists
          break;

        case 'mounted':
        case 'created':
        case 'beforeCreate':
        case 'beforeMount':
        case 'beforeUpdate':
        case 'updated':
        case 'beforeUnmount':
        case 'unmounted':
        case 'activated':
        case 'deactivated':
        case 'errorCaptured':
          result.lifecycle.push(key);
          break;
      }
    }
  }

  return result;
}

/**
 * Extract slots from template
 */
function extractSlots(templateContent: string): string[] {
  const slots: string[] = [];

  // Match slot definitions
  const slotRegex = /<slot(?:\s+name=["']([^"']+)["'])?/g;

  let match: RegExpExecArray | null;
  while ((match = slotRegex.exec(templateContent)) !== null) {
    const slotName = match[1] || 'default';
    if (!slots.includes(slotName)) {
      slots.push(slotName);
    }
  }

  return slots;
}

/**
 * Find Vue component definition in JS/TS files
 */
export function findVueComponentDefinition(
  node: Parser.SyntaxNode,
  parseComponentOptionsFn: typeof parseComponentOptions,
  looksLikeVueComponentFn: typeof looksLikeVueComponent,
  getNodeTextFn: (node: Parser.SyntaxNode) => string,
  extractStringLiteralFn: (node: Parser.SyntaxNode | null) => string | null
): {
  props: PropDefinition[];
  emits: string[];
  slots: string[];
  composables: string[];
  templateDependencies: string[];
  isCompositionAPI: boolean;
  hasTemplate: boolean;
  definitionType: string;
  lifecycle: string[];
} | null {
  let componentDef: any = null;

  const traverse = (node: Parser.SyntaxNode) => {
    // Pattern 1: defineComponent({ ... })
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      if (functionNode?.text === 'defineComponent') {
        const argsNode = node.child(1);
        const configNode = argsNode?.child(1); // First argument
        if (configNode?.type === 'object') {
          componentDef = parseComponentOptionsFn(
            configNode,
            'defineComponent',
            getNodeTextFn,
            extractStringLiteralFn
          );
          return;
        }
      }
    }

    // Pattern 2: export default { ... } (Options API)
    if (node.type === 'export_default_declaration') {
      const valueNode = node.child(1);
      if (valueNode?.type === 'object') {
        // Check if this looks like a Vue component
        if (looksLikeVueComponentFn(valueNode)) {
          componentDef = parseComponentOptionsFn(
            valueNode,
            'optionsAPI',
            getNodeTextFn,
            extractStringLiteralFn
          );
          return;
        }
      }
    }

    // Pattern 3: Vue.component('name', { ... })
    if (node.type === 'call_expression') {
      const memberNode = node.child(0);
      if (memberNode?.type === 'member_expression') {
        const objectNode = memberNode.child(0);
        const propertyNode = memberNode.child(2);

        if (objectNode?.text === 'Vue' && propertyNode?.text === 'component') {
          const argsNode = node.child(1);
          const configNode = argsNode?.child(3); // Second argument
          if (configNode?.type === 'object') {
            componentDef = parseComponentOptionsFn(
              configNode,
              'globalComponent',
              getNodeTextFn,
              extractStringLiteralFn
            );
            return;
          }
        }
      }
    }

    // Pattern 4: createApp({ ... }) or new Vue({ ... })
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      if (
        functionNode?.text === 'createApp' ||
        (functionNode?.type === 'new_expression' && functionNode.child(1)?.text === 'Vue')
      ) {
        const argsNode = node.child(1);
        const configNode = argsNode?.child(1); // First argument
        if (configNode?.type === 'object') {
          componentDef = parseComponentOptionsFn(
            configNode,
            'appComponent',
            getNodeTextFn,
            extractStringLiteralFn
          );
          return;
        }
      }
    }

    // Recursively traverse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && !componentDef) {
        traverse(child);
      }
    }
  };

  traverse(node);
  return componentDef;
}

/**
 * Check if an object looks like a Vue component configuration
 */
export function looksLikeVueComponent(objectNode: Parser.SyntaxNode): boolean {
  const componentProperties = [
    'data',
    'computed',
    'methods',
    'props',
    'emits',
    'setup',
    'template',
    'render',
  ];

  for (let i = 0; i < objectNode.childCount; i++) {
    const pairNode = objectNode.child(i);
    if (pairNode?.type === 'pair') {
      const keyNode = pairNode.child(0);
      const key = keyNode?.text?.replace(/['"]/g, '');

      if (componentProperties.includes(key || '')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parse regular Vue component (not SFC)
 */
export function parseVueComponent(
  content: string,
  filePath: string,
  parseContentFn: (content: string) => Parser.Tree | null,
  extractComponentNameFn: (filePath: string) => string,
  getNodeTextFn: (node: Parser.SyntaxNode) => string,
  extractStringLiteralFn: (node: Parser.SyntaxNode | null) => string | null
): VueComponent | null {
  try {
    // Skip component analysis for large files to avoid Tree-sitter limits
    if (content.length > 28000) {
      return null;
    }

    const tree = parseContentFn(content);
    if (!tree?.rootNode) return null;

    const componentDefinition = findVueComponentDefinition(
      tree.rootNode,
      parseComponentOptions,
      looksLikeVueComponent,
      getNodeTextFn,
      extractStringLiteralFn
    );
    if (!componentDefinition) return null;

    const componentName = extractComponentNameFn(filePath);

    const component: VueComponent = {
      type: 'component',
      name: componentName,
      filePath,
      props: componentDefinition.props,
      emits: componentDefinition.emits,
      slots: componentDefinition.slots,
      composables: componentDefinition.composables,
      template_dependencies: componentDefinition.templateDependencies,
      metadata: {
        scriptSetup: componentDefinition.isCompositionAPI,
        hasScript: true,
        hasTemplate: componentDefinition.hasTemplate,
        hasStyle: false,
        scriptLang: path.extname(filePath) === '.ts' ? 'ts' : 'js',
        props: componentDefinition.props.map(p => p.name),
        emits: componentDefinition.emits,
        lifecycle: componentDefinition.lifecycle || [],
        definitionType: componentDefinition.definitionType,
      },
    };

    return component;
  } catch (error) {
    return null;
  }
}

/**
 * Extract dynamic components
 */
export function extractDynamicComponents(templateContent: string): string[] {
  const dynamicComponents: string[] = [];

  // Match <component :is="componentName">
  const dynamicComponentRegex = /<component\s+:is="([^"]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = dynamicComponentRegex.exec(templateContent)) !== null) {
    const componentExpression = match[1];
    if (!dynamicComponents.includes(componentExpression)) {
      dynamicComponents.push(componentExpression);
    }
  }

  return dynamicComponents;
}
