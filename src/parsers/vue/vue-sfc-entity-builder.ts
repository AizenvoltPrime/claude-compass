import Parser from 'tree-sitter';
import { VueComponent, PropDefinition, FrameworkEntity } from '../base';
import { createComponentLogger } from '../../utils/logger';
import {
  extractSFCSections,
  extractBuiltInComponents,
  extractDirectives,
  extractScopedSlots,
  extractTemplateRefs,
  extractEventHandlers,
  extractVuePropsAndEmits,
  extractLifecycleHooks,
  extractAdvancedCompositionAPI,
  extractVueUseComposables,
  extractVitePatterns,
  extractTypeScriptFeatures,
  extractCSSModules,
  extractPreprocessors,
  extractUtilityTypes,
  hasUtilityTypes,
} from './index';
import { extractLeadingJSDocComment, extractDescriptionOnly } from '../utils/jsdoc-extractor';
import {
  extractCSSVariables,
  hasDynamicStyling,
  extractDynamicStyleVariables,
  extractTeleportTargets,
  extractTransitionNames,
  extractGenericFunctions,
} from './vue-style-extraction';
import { extractDynamicComponents } from './vue-options-parser';

const logger = createComponentLogger('vue-sfc-entity-builder');

/**
 * Parse Vue SFC as a framework entity with enhanced metadata
 */
export async function buildVueSFCEntity(
  content: string,
  filePath: string,
  extractComponentNameFn: (filePath: string) => string,
  parseScriptContentFn: (scriptContent: string, isTypeScript: boolean) => Parser.Tree | null
): Promise<FrameworkEntity | null> {
  const sections = extractSFCSections(content);
  const componentName = extractComponentNameFn(filePath);

  // Parse script content if available
  let scriptTree: Parser.Tree | null = null;
  const scriptContent = sections.scriptSetup || sections.script;

  if (scriptContent) {
    try {
      // Use TypeScript parser for TS content, otherwise use JavaScript parser
      const isTypeScript = sections.scriptLang === 'ts' || content.includes('lang="ts"');

      // Check if script content is too large and skip tree parsing for framework entity extraction
      if (scriptContent.length > 28000) {
        // For large scripts, we skip detailed parsing for framework entities
        // The symbols will be extracted via the main parseFile path with chunking
        scriptTree = null;
      } else {
        scriptTree = parseScriptContentFn(scriptContent, isTypeScript);
      }
    } catch (error) {
      logger.warn(`Failed to parse script section for ${filePath}`, { error });
      // Continue with component creation even if script parsing fails
      scriptTree = null;
    }
  }

  let componentDescription: string | undefined;
  if (scriptTree && scriptContent) {
    const jsdocComment = extractLeadingJSDocComment(scriptTree.rootNode, scriptContent);
    if (jsdocComment) {
      componentDescription = extractDescriptionOnly(jsdocComment);
    }
  }

  // Extract enhanced metadata (with error handling)
  let builtInComponents: any[] = [];
  let directives: any[] = [];
  let scopedSlots: any[] = [];
  let templateRefs: string[] = [];
  let dynamicComponents: string[] = [];
  let eventHandlers: any[] = [];
  let props: PropDefinition[] = [];
  let emits: string[] = [];
  let lifecycle: string[] = [];

  try {
    builtInComponents = sections.template ? extractBuiltInComponents(sections.template) : [];
    directives = sections.template ? extractDirectives(sections.template) : [];
    scopedSlots = sections.template ? extractScopedSlots(sections.template) : [];
    templateRefs = sections.template ? extractTemplateRefs(sections.template) : [];
    dynamicComponents = sections.template ? extractDynamicComponents(sections.template) : [];
    eventHandlers = sections.template ? extractEventHandlers(sections.template) : [];

    // Extract basic component properties (single-pass optimization)
    if (scriptTree) {
      const extracted = extractVuePropsAndEmits(scriptTree);
      props = extracted.props;
      emits = extracted.emits;
    } else {
      props = [];
      emits = [];
    }
    lifecycle = scriptTree ? extractLifecycleHooks(scriptTree, content) : [];
  } catch (error) {
    logger.warn(`Failed to extract Vue component metadata for ${filePath}`, { error });
    // Continue with empty arrays - better to have a basic component than no component
  }

  // Extract advanced Composition API patterns (with error handling)
  let advancedComposition = {
    provide: [],
    inject: [],
    defineExpose: [],
    defineModel: [],
    watchEffect: [],
    computed: [],
  };
  let vueUseComposables: any[] = [];
  let vitePatterns = { globImports: [], envVariables: [], hotReload: false };
  let typescriptFeatures = {
    interfaces: [],
    types: [],
    generics: [],
    imports: [],
  };

  try {
    advancedComposition = scriptTree
      ? extractAdvancedCompositionAPI(scriptTree)
      : advancedComposition;
    vueUseComposables = scriptTree ? extractVueUseComposables(scriptTree) : [];
    vitePatterns = extractVitePatterns(content);
    typescriptFeatures = scriptTree
      ? extractTypeScriptFeatures(content, scriptTree)
      : typescriptFeatures;
  } catch (error) {
    logger.warn(`Failed to extract advanced Vue component features for ${filePath}`, { error });
    // Continue with default values
  }

  const component: VueComponent = {
    type: 'component',
    name: componentName,
    filePath,
    description: componentDescription,
    props,
    emits,
    slots: scopedSlots.map(s => s.name),
    composables: [],
    template_dependencies: eventHandlers.map(e => e.handler),
    metadata: {
      // Basic SFC metadata
      scriptSetup: !!sections.scriptSetup,
      hasScript: !!(sections.script || sections.scriptSetup),
      hasTemplate: !!sections.template,
      hasStyle: !!sections.style,
      scriptLang: sections.scriptLang || (filePath.includes('.ts') ? 'ts' : 'js'),

      // Component props and emits (simplified for querying)
      props: props.map(p => p.name),
      emits: emits,

      // Component lifecycle
      lifecycle,

      // Vue 3 built-in components
      builtInComponents,
      teleportTargets: extractTeleportTargets(sections.template || ''),
      hasAsyncComponents: builtInComponents.includes('Suspense'),
      hasCaching: builtInComponents.includes('KeepAlive'),
      hasAnimations: builtInComponents.some(c => c.includes('Transition')),
      transitionNames: extractTransitionNames(sections.template || ''),

      // Advanced Composition API
      providedKeys: advancedComposition.provide.map(p => p.key),
      injectedKeys: advancedComposition.inject.map(i => i.key),
      hasProvideInject:
        advancedComposition.provide.length > 0 || advancedComposition.inject.length > 0,
      exposedMethods: advancedComposition.defineExpose,
      exposedProperties: advancedComposition.defineExpose,
      hasDefineExpose: advancedComposition.defineExpose.length > 0,
      models: advancedComposition.defineModel.map(m => m.name),
      hasDefineModel: advancedComposition.defineModel.length > 0,

      // Template analysis
      directives: {
        builtin: directives.filter(d => d.type === 'built-in').map(d => `v-${d.name}`),
        custom: directives.filter(d => d.type === 'custom').map(d => `v-${d.name}`),
      },
      eventHandlers: eventHandlers.map(h => h.event),
      scopedSlots: scopedSlots.map(s => s.name),
      hasScopedSlots: scopedSlots.length > 0,
      templateRefs,
      hasTemplateRefs: templateRefs.length > 0,
      hasDynamicComponents: dynamicComponents.length > 0,
      dynamicComponentVariables: dynamicComponents,

      // VueUse integration
      vueUseComposables,
      hasVueUse: vueUseComposables.length > 0,

      // Vite patterns
      vitePatterns: {
        globImports: vitePatterns.globImports,
        envVariables: vitePatterns.envVariables,
        hasGlobImports: vitePatterns.globImports.length > 0,
        hasEnvVariables: vitePatterns.envVariables.length > 0,
        hasHotReload: vitePatterns.hotReload,
      },

      // Styling features
      styling: {
        cssModules: extractCSSModules(content),
        hasCSSModules: sections.styleModules === true,
        preprocessors: extractPreprocessors(content),
        hasPreprocessors:
          sections.styleLang !== undefined &&
          ['scss', 'sass', 'less', 'stylus'].includes(sections.styleLang),
        scoped: sections.styleScoped === true,
        variables: extractCSSVariables(content),
        hasDynamicStyling: hasDynamicStyling(content),
        dynamicStyleVariables: extractDynamicStyleVariables(content),
      },

      // TypeScript integration
      typescript: (() => {
        const genericFunctions = extractGenericFunctions(content);
        const utilityTypes = extractUtilityTypes(content);
        return {
          interfaces: typescriptFeatures.interfaces.map(i => i.name),
          types: typescriptFeatures.types.map(t => t.name),
          utilityTypes,
          hasTypeScript: sections.scriptLang === 'ts' || content.includes('lang="ts"'),
          hasGenerics: typescriptFeatures.generics.length > 0 || genericFunctions.length > 0,
          genericFunctions,
          hasUtilityTypes: hasUtilityTypes(content),
        };
      })(),
    },
  };

  return component;
}
