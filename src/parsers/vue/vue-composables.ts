import Parser from 'tree-sitter';
import { VueComposable } from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { createComponentLogger } from '../../utils/logger';
import { extractJSDocComment, extractDescriptionOnly } from '../utils/jsdoc-extractor';
import { findParent, isComposableFile } from './vue-utils';

const logger = createComponentLogger('vue-composables');

export async function parseComposables(
  tree: Parser.Tree | null,
  content: string,
  filePath: string,
  options: FrameworkParseOptions
): Promise<VueComposable[]> {
  const composables: VueComposable[] = [];

  if (!isComposableFile(filePath, content)) {
    return composables;
  }

  try {
    if (content.length > 28000) {
      return composables;
    }

    if (!tree?.rootNode) return composables;

    const functions = findComposableFunctions(tree, content);

    for (const func of functions) {
      const composable: VueComposable = {
        type: 'composable',
        name: func.name,
        filePath,
        description: func.description,
        returns: func.returns,
        dependencies: func.dependencies,
        reactive_refs: func.reactiveRefs,
        metadata: {
          isDefault: func.isDefault,
          parameters: func.parameters,
          returns: func.returns,
          lifecycle: func.dependencies.filter(d =>
            ['onMounted', 'onUnmounted', 'onUpdated'].includes(d)
          ),
        },
      };

      composables.push(composable);
    }
  } catch (error) {
    logger.error(`Failed to parse Vue composables in ${filePath}`, { error });
  }

  return composables;
}

export function findComposableFunctions(
  tree: Parser.Tree,
  content: string
): Array<{
  name: string;
  returns: string[];
  dependencies: string[];
  reactiveRefs: string[];
  isDefault: boolean;
  parameters: string[];
  description?: string;
}> {
  const functions: any[] = [];

  if (!tree?.rootNode) return functions;

  const traverse = (node: Parser.SyntaxNode) => {
    // Function declarations: function useExample() {}
    if (node.type === 'function_declaration') {
      let nameNode = null;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'identifier') {
          nameNode = child;
          break;
        }
      }
      const name = nameNode?.text;

      if (name && name.startsWith('use') && name.length > 3) {
        functions.push(analyzeComposableFunction(node, name, false, content));
      }
    }

    // Variable declarations: const useExample = () => {}
    if (node.type === 'variable_declarator') {
      const nameNode = node.child(0);
      const valueNode = node.child(2);
      const name = nameNode?.text;

      if (
        name &&
        name.startsWith('use') &&
        name.length > 3 &&
        (valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression')
      ) {
        functions.push(analyzeComposableFunction(valueNode, name, false, content));
      }
    }

    // Export default function
    if (node.type === 'export_default_declaration') {
      let funcNode = null;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (
          child &&
          (child.type === 'function_declaration' ||
            child.type === 'arrow_function' ||
            child.type === 'function_expression')
        ) {
          funcNode = child;
          break;
        }
      }

      if (funcNode) {
        const name = 'default';
        functions.push(analyzeComposableFunction(funcNode, name, true, content));
      }
    }

    // Traverse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(tree.rootNode);
  return functions;
}

export function analyzeComposableFunction(
  node: Parser.SyntaxNode,
  name: string,
  isDefault: boolean,
  content?: string
): {
  name: string;
  returns: string[];
  dependencies: string[];
  reactiveRefs: string[];
  isDefault: boolean;
  parameters: string[];
  description?: string;
} {
  const returns: string[] = [];
  const dependencies: string[] = [];
  const reactiveRefs: string[] = [];
  const parameters: string[] = [];
  let description: string | undefined;

  if (content) {
    const jsdocComment = extractJSDocComment(node, content);
    if (jsdocComment) {
      description = extractDescriptionOnly(jsdocComment);
    }
  }

  // Extract parameters
  let parametersList = null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === 'formal_parameters') {
      parametersList = child;
      break;
    }
  }

  if (parametersList) {
    for (let i = 0; i < parametersList.childCount; i++) {
      const param = parametersList.child(i);
      if (param && param.type === 'identifier') {
        parameters.push(param.text);
      }
    }
  }

  // Find function body
  let body = null;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && (child.type === 'statement_block' || child.type === 'expression')) {
      body = child;
      break;
    }
  }

  if (body) {
    analyzeComposableBody(body, returns, dependencies, reactiveRefs);
  }

  return {
    name,
    returns,
    dependencies,
    reactiveRefs,
    isDefault,
    parameters,
    description,
  };
}

export function analyzeComposableBody(
  body: Parser.SyntaxNode,
  returns: string[],
  dependencies: string[],
  reactiveRefs: string[]
): void {
  const traverse = (node: Parser.SyntaxNode) => {
    // Look for return statements
    if (node.type === 'return_statement') {
      const returnValue = node.child(1);
      if (returnValue?.type === 'object') {
        // Extract returned object properties
        for (let i = 0; i < returnValue.childCount; i++) {
          const child = returnValue.child(i);
          if (child && (child.type === 'pair' || child.type === 'property_name')) {
            const propNameNode = child.child(0);
            const propName = propNameNode?.text || child.text;
            if (propName && !returns.includes(propName)) {
              returns.push(propName);
            }
          } else if (child && child.type === 'shorthand_property_identifier') {
            // Handle shorthand properties like { increment, decrement }
            const propName = child.text;
            if (propName && !returns.includes(propName)) {
              returns.push(propName);
            }
          }
        }
      }
    }

    // Look for Vue composition API calls
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      const functionName = functionNode?.text;

      if (functionName) {
        // Track composition API dependencies
        if (['ref', 'reactive', 'computed', 'watch', 'watchEffect'].includes(functionName)) {
          if (!dependencies.includes(functionName)) {
            dependencies.push(functionName);
          }

          // Track reactive references
          if (['ref', 'reactive'].includes(functionName)) {
            // Try to find variable name this is assigned to
            const parent = findParent(node, 'variable_declarator');
            if (parent) {
              const varNameNode = parent.child(0);
              const varName = varNameNode?.text;
              if (varName && !reactiveRefs.includes(varName)) {
                reactiveRefs.push(varName);
              }
            }
          }
        }

        // Track other composable calls
        if (functionName.startsWith('use') && functionName.length > 3) {
          if (!dependencies.includes(functionName)) {
            dependencies.push(functionName);
          }
        }

        // Track lifecycle hooks (onMounted, onUnmounted, etc.)
        if (functionName.startsWith('on') && functionName.length > 2) {
          if (!dependencies.includes(functionName)) {
            dependencies.push(functionName);
          }
        }
      }
    }

    // Traverse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(body);
}

export function extractLifecycleHooks(tree: Parser.Tree | null, content: string): string[] {
  const lifecycle: string[] = [];
  const lifecycleHooks = [
    'beforeCreate',
    'created',
    'beforeMount',
    'mounted',
    'beforeUpdate',
    'updated',
    'beforeUnmount',
    'unmounted',
    'beforeDestroy',
    'destroyed',
    'activated',
    'deactivated',
  ];

  if (!tree?.rootNode) return lifecycle;

  // Extract from Options API
  for (const hook of lifecycleHooks) {
    const hookPattern = new RegExp(`\\b${hook}\\s*\\(`, 'g');
    if (hookPattern.test(content)) {
      lifecycle.push(hook);
    }
  }

  return [...new Set(lifecycle)];
}

export function extractVueUseComposables(tree: Parser.Tree | null): string[] {
  const vueUseComposables: string[] = [];

  if (!tree?.rootNode) return vueUseComposables;

  // Common VueUse composables
  const commonVueUse = [
    // Core
    'useCounter',
    'useToggle',
    'useBoolean',
    'useClipboard',
    'useColorMode',
    'useCycleList',
    'useLocalStorage',
    'useSessionStorage',
    'useStorage',
    'usePreferredDark',
    'usePreferredLanguages',
    'useTitle',
    'useFavicon',
    'useDebounce',
    'useFetch',
    'useAsyncState',
    // Browser
    'useActiveElement',
    'useBreakpoints',
    'useBrowserLocation',
    'useEventListener',
    'useFullscreen',
    'useGeolocation',
    'useIdle',
    'useIntersectionObserver',
    'useMediaQuery',
    'useMemory',
    'useMouseInElement',
    'useMousePressed',
    'useNetwork',
    'useOnline',
    'usePageLeave',
    'usePermission',
    'usePreferredColorScheme',
    'usePreferredReducedMotion',
    'useResizeObserver',
    'useScriptTag',
    'useShare',
    'useSpeechRecognition',
    'useSpeechSynthesis',
    'useUrlSearchParams',
    'useVibrate',
    'useWakeLock',
    'useWebNotification',
    // Sensors
    'useAccelerometer',
    'useBattery',
    'useDeviceMotion',
    'useDeviceOrientation',
    'useDevicePixelRatio',
    'useDocumentVisibility',
    'useElementBounding',
    'useElementSize',
    'useElementVisibility',
    'useEyeDropper',
    'useFps',
    'useKeyModifier',
    'useMagicKeys',
    'useMouse',
    'useParallax',
    'usePointerSwipe',
    'useScroll',
    'useScrollLock',
    'useSwipe',
    'useTextareaAutosize',
    'useWindowFocus',
    'useWindowScroll',
    'useWindowSize',
    // Head management
    'useHead',
    'useSeoMeta',
    'useServerHead',
  ];

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      const functionName = functionNode?.text;

      if (functionName && commonVueUse.includes(functionName)) {
        if (!vueUseComposables.includes(functionName)) {
          vueUseComposables.push(functionName);
        }
      }
    }

    // Traverse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(tree.rootNode);
  return vueUseComposables;
}

export function extractAdvancedCompositionAPI(tree: Parser.Tree | null): {
  provide: Array<{ key: string; value: string }>;
  inject: Array<{ key: string; defaultValue?: string }>;
  defineExpose: string[];
  defineModel: Array<{ name: string; options?: any }>;
  watchEffect: string[];
  computed: string[];
} {
  const result = {
    provide: [] as Array<{ key: string; value: string }>,
    inject: [] as Array<{ key: string; defaultValue?: string }>,
    defineExpose: [] as string[],
    defineModel: [] as Array<{ name: string; options?: any }>,
    watchEffect: [] as string[],
    computed: [] as string[],
  };

  if (!tree?.rootNode) return result;

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      const functionName = functionNode?.text;

      if (functionName === 'provide') {
        const argsNode = node.child(1);
        if (argsNode && argsNode.childCount >= 3) {
          const keyNode = argsNode.child(1);
          const valueNode = argsNode.child(3);
          if (keyNode && valueNode) {
            result.provide.push({
              key: keyNode.text.replace(/['"]/g, ''),
              value: valueNode.text,
            });
          }
        }
      }

      if (functionName === 'inject') {
        const argsNode = node.child(1);
        if (argsNode && argsNode.childCount >= 2) {
          const keyNode = argsNode.child(1);
          const defaultNode = argsNode.child(3);
          if (keyNode) {
            result.inject.push({
              key: keyNode.text.replace(/['"]/g, ''),
              defaultValue: defaultNode?.text,
            });
          }
        }
      }

      if (functionName === 'defineExpose') {
        const argsNode = node.child(1);
        if (argsNode && argsNode.child(1)?.type === 'object') {
          const objectNode = argsNode.child(1);
          if (objectNode) {
            for (let i = 0; i < objectNode.childCount; i++) {
              const child = objectNode.child(i);
              if (child?.type === 'shorthand_property_identifier') {
                result.defineExpose.push(child.text);
              } else if (child?.type === 'pair') {
                const keyNode = child.child(0);
                if (keyNode) {
                  result.defineExpose.push(keyNode.text);
                }
              }
            }
          }
        }
      }

      if (functionName === 'defineModel') {
        const argsNode = node.child(1);
        if (argsNode && argsNode.childCount >= 2) {
          const nameNode = argsNode.child(1);
          const optionsNode = argsNode.child(3);
          if (nameNode) {
            result.defineModel.push({
              name: nameNode.text.replace(/['"]/g, ''),
              options: optionsNode?.text,
            });
          }
        }
      }

      if (functionName === 'watchEffect') {
        result.watchEffect.push(node.text.substring(0, 50));
      }

      if (functionName === 'computed') {
        const parent = findParent(node, 'variable_declarator');
        if (parent) {
          const varNameNode = parent.child(0);
          if (varNameNode) {
            result.computed.push(varNameNode.text);
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(tree.rootNode);
  return result;
}
