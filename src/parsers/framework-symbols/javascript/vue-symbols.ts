import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize Vue.js Composition API and framework symbols
 */
export function initializeVueSymbols(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

  // Vue 3 Composition API
  const vueCompositionAPI = [
    'ref', 'reactive', 'computed', 'watch', 'watchEffect', 'readonly',
    'toRef', 'toRefs', 'isRef', 'unref', 'shallowRef', 'shallowReactive',
    'markRaw', 'toRaw', 'isReactive', 'isReadonly', 'isProxy',
    'nextTick', 'defineComponent', 'defineAsyncComponent',
    'onMounted', 'onUnmounted', 'onUpdated', 'onBeforeMount', 'onBeforeUnmount',
    'onBeforeUpdate', 'onActivated', 'onDeactivated', 'onErrorCaptured',
    'provide', 'inject', 'getCurrentInstance', 'useSlots', 'useAttrs'
  ];

  for (const method of vueCompositionAPI) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.FUNCTION,
      visibility: Visibility.PUBLIC,
      framework: 'Vue',
      context: 'composition-api',
      description: `Vue 3 Composition API: ${method}`
    });
  }

  // Vue Router composables
  const vueRouterAPI = [
    'useRouter', 'useRoute', 'onBeforeRouteLeave', 'onBeforeRouteUpdate'
  ];

  for (const method of vueRouterAPI) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.FUNCTION,
      visibility: Visibility.PUBLIC,
      framework: 'Vue',
      context: 'router',
      description: `Vue Router composable: ${method}`
    });
  }

  // Common i18n function
  symbols.push({
    name: 't',
    symbol_type: SymbolType.FUNCTION,
    visibility: Visibility.PUBLIC,
    framework: 'Vue',
    context: 'i18n',
    description: 'Vue i18n translation function'
  });

  return symbols;
}
