import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import {
  BaseFrameworkParser,
  FrameworkParseOptions,
  FrameworkPattern,
  ParseFileResult,
} from './base-framework';
import {
  FrameworkEntity,
  FrameworkParseResult,
  VueComponent,
  VueComposable,
  VueRoute,
  PiniaStore,
  PropDefinition,
} from './base';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';

const logger = createComponentLogger('vue-parser');

/**
 * Vue.js-specific parser for Single File Components, composables, and Vue Router
 */
export class VueParser extends BaseFrameworkParser {
  private typescriptParser: Parser;

  constructor(parser: Parser) {
    super(parser, 'vue');

    // Create TypeScript parser for handling TS script sections
    this.typescriptParser = new Parser();
    this.typescriptParser.setLanguage(TypeScript.typescript);
  }

  /**
   * Helper method to choose the appropriate parser based on content type
   */
  private parseScriptContent(scriptContent: string, isTypeScript: boolean): Parser.Tree {
    return isTypeScript
      ? this.typescriptParser.parse(scriptContent)
      : this.parser.parse(scriptContent);
  }

  /**
   * Override parseFile to handle Vue SFCs properly
   */
  async parseFile(filePath: string, content: string, options: FrameworkParseOptions = {}): Promise<ParseFileResult> {
    logger.debug(`Parsing Vue file`, { filePath });

    try {
      // For Vue SFCs, we need to extract script content and parse it separately
      if (filePath.endsWith('.vue')) {
        return await this.parseVueSFC(filePath, content, options);
      }

      // For regular JS/TS files, use base framework parser
      return await super.parseFile(filePath, content, options);

    } catch (error) {
      logger.error(`Vue parsing failed for ${filePath}`, { error });

      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Vue parsing error: ${error.message}`,
          line: 0,
          column: 0,
          severity: 'error',
        }],
        frameworkEntities: [],
        metadata: {
          framework: 'vue',
          isFrameworkSpecific: false,
        },
      };
    }
  }

  /**
   * Parse Vue Single File Component with proper script extraction
   */
  private async parseVueSFC(filePath: string, content: string, options: FrameworkParseOptions): Promise<ParseFileResult> {
    const sections = this.extractSFCSections(content);

    // Extract symbols, imports, etc. from script section
    let symbols: any[] = [];
    let imports: any[] = [];
    let exports: any[] = [];
    let dependencies: any[] = [];
    let errors: any[] = [];

    if (sections.script || sections.scriptSetup) {
      const scriptContent = sections.scriptSetup || sections.script;

      try {
        const isTypeScript = sections.scriptLang === 'ts' || content.includes('lang="ts"');
        const tree = this.parseScriptContent(scriptContent!, isTypeScript);
        if (tree?.rootNode) {
          symbols = this.extractSymbols(tree.rootNode, scriptContent!);
          imports = this.extractImports(tree.rootNode, scriptContent!);
          exports = this.extractExports(tree.rootNode, scriptContent!);
          dependencies = this.extractDependencies(tree.rootNode, scriptContent!);

          if (tree.rootNode.hasError) {
            errors.push({
              message: 'Syntax errors in Vue script section',
              line: 1,
              column: 1,
              severity: 'warning' as const,
            });
          }
        }
      } catch (error) {
        errors.push({
          message: `Script parsing error: ${error.message}`,
          line: 1,
          column: 1,
          severity: 'error' as const,
        });
      }
    }

    // Detect framework entities
    const frameworkResult = await this.detectFrameworkEntities(content, filePath, options);

    return {
      symbols,
      dependencies,
      imports,
      exports,
      errors,
      frameworkEntities: frameworkResult.entities || [],
      metadata: {
        framework: 'vue',
        isFrameworkSpecific: (frameworkResult.entities?.length || 0) > 0,
        fileType: 'vue-sfc',
      },
    };
  }

  /**
   * Detect framework entities (components, composables, routes, stores)
   */
  public async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      if (filePath.endsWith('.vue')) {
        // Parse Vue Single File Component
        const component = await this.parseVueSFCEntity(content, filePath, options);
        if (component) {
          entities.push(component);
        }
      } else if (this.isPiniaStore(filePath, content)) {
        // Parse Pinia stores (check before composables since stores are more specific)
        const stores = await this.parsePiniaStore(content, filePath, options);
        entities.push(...stores);
      } else if (this.isRouterFile(filePath, content)) {
        // Parse Vue Router routes
        const routes = await this.parseVueRouterRoutes(content, filePath, options);
        entities.push(...routes);
      } else if (this.isComposableFile(filePath, content)) {
        // Parse Vue composables (check after more specific types)
        const composables = await this.parseComposables(content, filePath, options);
        entities.push(...composables);
      } else if (this.isVueComponentFile(content)) {
        // Parse regular Vue component (non-SFC)
        const component = await this.parseVueComponent(content, filePath, options);
        if (component) {
          entities.push(component);
        }
      }
    } catch (error) {
      logger.error(`Framework entity detection failed for ${filePath}`, { error });
    }

    return {
      entities
    };
  }

  /**
   * Parse Vue SFC as a framework entity with enhanced metadata
   */
  private async parseVueSFCEntity(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkEntity | null> {
    const sections = this.extractSFCSections(content);
    const componentName = this.extractComponentName(filePath);

    // Parse script content if available
    let scriptTree = null;
    const scriptContent = sections.scriptSetup || sections.script;
    if (scriptContent) {
      try {
        // Use TypeScript parser for TS content, otherwise use JavaScript parser
        const isTypeScript = sections.scriptLang === 'ts' || content.includes('lang="ts"');
        scriptTree = isTypeScript
          ? this.typescriptParser.parse(scriptContent)
          : this.parser.parse(scriptContent);
      } catch (error) {
        logger.warn(`Failed to parse script section for ${filePath}`, { error });
      }
    }

    // Extract enhanced metadata
    const builtInComponents = sections.template ? this.extractBuiltInComponents(sections.template) : [];
    const directives = sections.template ? this.extractDirectives(sections.template) : [];
    const scopedSlots = sections.template ? this.extractScopedSlots(sections.template) : [];
    const templateRefs = sections.template ? this.extractTemplateRefs(sections.template) : [];
    const dynamicComponents = sections.template ? this.extractDynamicComponents(sections.template) : [];
    const eventHandlers = sections.template ? this.extractEventHandlers(sections.template) : [];

    // Extract basic component properties
    const props = scriptTree ? this.extractProps(scriptTree, content) : [];
    const emits = scriptTree ? this.extractEmits(scriptTree, content) : [];
    const lifecycle = scriptTree ? this.extractLifecycleHooks(scriptTree, content) : [];

    // Extract advanced Composition API patterns
    const advancedComposition = scriptTree ? this.extractAdvancedCompositionAPI(scriptTree) : {
      provide: [],
      inject: [],
      defineExpose: [],
      defineModel: [],
      watchEffect: [],
      computed: []
    };

    // Extract VueUse composables
    const vueUseComposables = scriptTree ? this.extractVueUseComposables(scriptTree) : [];

    // Extract Vite patterns
    const vitePatterns = this.extractVitePatterns(content);

    // Extract styling features
    const stylingFeatures = this.extractStylingFeatures(content);

    // Extract TypeScript features
    const typescriptFeatures = scriptTree ? this.extractTypeScriptFeatures(content, scriptTree) : {
      interfaces: [],
      types: [],
      generics: [],
      imports: []
    };

    const component: FrameworkEntity = {
      type: 'component',
      name: componentName,
      filePath,
      metadata: {
        // Basic SFC metadata
        scriptSetup: !!sections.scriptSetup,
        hasScript: !!(sections.script || sections.scriptSetup),
        hasTemplate: !!sections.template,
        hasStyle: !!sections.style,
        scriptLang: sections.scriptLang || (filePath.includes('.ts') ? 'ts' : 'js'),

        // Component properties
        props,
        emits,
        lifecycle,

        // Vue 3 built-in components
        builtInComponents,
        teleportTargets: this.extractTeleportTargets(sections.template || ''),
        hasAsyncComponents: builtInComponents.includes('Suspense'),
        hasCaching: builtInComponents.includes('KeepAlive'),
        hasAnimations: builtInComponents.some(c => c.includes('Transition')),
        transitionNames: this.extractTransitionNames(sections.template || ''),

        // Advanced Composition API
        providedKeys: advancedComposition.provide.map(p => p.key),
        injectedKeys: advancedComposition.inject.map(i => i.key),
        hasProvideInject: advancedComposition.provide.length > 0 || advancedComposition.inject.length > 0,
        exposedMethods: advancedComposition.defineExpose,
        exposedProperties: advancedComposition.defineExpose,
        hasDefineExpose: advancedComposition.defineExpose.length > 0,
        models: advancedComposition.defineModel.map(m => m.name),
        hasDefineModel: advancedComposition.defineModel.length > 0,

        // Template analysis
        directives: {
          builtin: directives.filter(d => d.type === 'built-in').map(d => `v-${d.name}`),
          custom: directives.filter(d => d.type === 'custom').map(d => `v-${d.name}`)
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
          hasHotReload: vitePatterns.hotReload
        },

        // Styling features
        styling: {
          cssModules: this.extractCSSModules(content),
          hasCSSModules: /<style\s+module/.test(content),
          preprocessors: this.extractPreprocessors(content),
          hasPreprocessors: /<style\s+[^>]*lang=["'](scss|sass|less|stylus)["']/.test(content),
          scoped: /<style[^>]*\s+scoped/.test(content),
          variables: this.extractCSSVariables(content),
          hasDynamicStyling: this.hasDynamicStyling(content),
          dynamicStyleVariables: this.extractDynamicStyleVariables(content)
        },

        // TypeScript integration
        typescript: (() => {
          const genericFunctions = this.extractGenericFunctions(content);
          const utilityTypes = this.extractUtilityTypes(content);
          return {
            interfaces: typescriptFeatures.interfaces.map(i => i.name),
            types: typescriptFeatures.types.map(t => t.name),
            utilityTypes,
            hasTypeScript: sections.scriptLang === 'ts' || content.includes('lang="ts"'),
            hasGenerics: typescriptFeatures.generics.length > 0 || genericFunctions.length > 0,
            genericFunctions,
            hasUtilityTypes: this.hasUtilityTypes(content)
          };
        })()
      }
    };

    return component;
  }

  /**
   * Get Vue.js-specific detection patterns
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'vue-sfc',
        pattern: /<template>|<script>|<style>/,
        fileExtensions: ['.vue'],
        confidence: 0.95,
        description: 'Vue Single File Component',
      },
      {
        name: 'vue-composition-api',
        pattern: /import\s+\{[^}]*\}\s+from\s+['"]vue['"]|defineComponent|setup\s*\(/,
        fileExtensions: ['.js', '.ts', '.vue'],
        confidence: 0.8,
        description: 'Vue Composition API usage',
      },
      {
        name: 'vue-composable',
        pattern: /export\s+(default\s+)?function\s+use[A-Z]\w*|const\s+use[A-Z]\w*\s*=/,
        fileExtensions: ['.js', '.ts'],
        confidence: 0.85,
        description: 'Vue composable function',
      },
      {
        name: 'vue-router',
        pattern: /createRouter|useRouter|useRoute|router\.(push|replace)|RouterView|RouterLink/,
        fileExtensions: ['.js', '.ts', '.vue'],
        confidence: 0.9,
        description: 'Vue Router usage',
      },
      {
        name: 'pinia-store',
        pattern: /defineStore|usePinia|createPinia/,
        fileExtensions: ['.js', '.ts'],
        confidence: 0.9,
        description: 'Pinia store definition',
      },
      {
        name: 'vue-built-in-components',
        pattern: /<Teleport|<Suspense|<KeepAlive|<Transition|<TransitionGroup/,
        fileExtensions: ['.vue', '.js', '.jsx', '.ts', '.tsx'],
        confidence: 0.95,
        description: 'Vue 3 built-in components',
      },
      {
        name: 'vue-advanced-composition',
        pattern: /provide\s*\(|inject\s*\(|defineExpose\s*\(|defineModel\s*\(/,
        fileExtensions: ['.vue', '.js', '.ts'],
        confidence: 0.9,
        description: 'Vue 3 advanced Composition API',
      },
      {
        name: 'vueuse-composables',
        pattern: /@vueuse\/core|@vueuse\/head|use[A-Z]\w*(?:Storage|Element|Mouse|Keyboard|Network|Browser)/,
        fileExtensions: ['.js', '.ts', '.vue'],
        confidence: 0.85,
        description: 'VueUse composables library',
      },
      {
        name: 'vite-patterns',
        pattern: /import\.meta\.glob|import\.meta\.env|import\.meta\.hot/,
        fileExtensions: ['.js', '.ts', '.vue'],
        confidence: 0.9,
        description: 'Vite-specific patterns',
      },
      {
        name: 'vue-testing',
        pattern: /@vue\/test-utils|mount\s*\(|shallowMount\s*\(|\.stories\./,
        fileExtensions: ['.js', '.ts', '.spec.js', '.test.js', '.stories.js'],
        confidence: 0.9,
        description: 'Vue testing patterns',
      },
    ];
  }


  /**
   * Parse Vue Single File Component (.vue files)
   */
  private async parseSingleFileComponent(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueComponent | null> {
    try {
      // Extract sections from SFC
      const sections = this.extractSFCSections(content);

      if (!sections.script && !sections.template) {
        logger.warn(`Vue SFC has no script or template section: ${filePath}`);
        // Still create a basic component entity for empty Vue files
      }

      const componentName = this.extractComponentName(filePath);

      // Parse script section for component logic
      let props: PropDefinition[] = [];
      let emits: string[] = [];
      let composables: string[] = [];
      let templateDependencies: string[] = [];
      let scriptSymbols: any[] = [];
      let scriptImports: any[] = [];

      if (sections.script || sections.scriptSetup) {
        const scriptContent = sections.scriptSetup || sections.script;
        const scriptAnalysis = await this.analyzeVueScript(scriptContent!, filePath);
        props = scriptAnalysis.props;
        emits = scriptAnalysis.emits;
        composables = scriptAnalysis.composables;

        // Also extract symbols and imports from script content
        const isTypeScript = sections.scriptLang === 'ts' || content.includes('lang="ts"');
        const tree = this.parseScriptContent(scriptContent!, isTypeScript);
        if (tree?.rootNode) {
          scriptSymbols = this.extractSymbols(tree.rootNode, scriptContent!);
          scriptImports = this.extractImports(tree.rootNode, scriptContent!);
        }
      }

      // Parse template section for component dependencies and advanced features
      let builtInComponents: string[] = [];
      let directives: Array<{ name: string; type: 'built-in' | 'custom'; modifiers: string[]; arguments?: string }> = [];
      let scopedSlots: Array<{ name: string; props: string[] }> = [];
      let templateRefs: string[] = [];
      let dynamicComponents: string[] = [];
      let eventHandlers: Array<{ event: string; handler: string; modifiers: string[] }> = [];

      if (sections.template) {
        templateDependencies = this.extractTemplateDependencies(sections.template);
        builtInComponents = this.extractBuiltInComponents(sections.template);
        directives = this.extractDirectives(sections.template);
        scopedSlots = this.extractScopedSlots(sections.template);
        templateRefs = this.extractTemplateRefs(sections.template);
        dynamicComponents = this.extractDynamicComponents(sections.template);
        eventHandlers = this.extractEventHandlers(sections.template);
      }

      // Extract slots from template
      const slots = sections.template ? this.extractSlots(sections.template) : [];

      // Detect lifecycle methods from script content
      let lifecycleMethods: string[] = [];
      let advancedComposition: any = {};
      let vueUseComposables: string[] = [];
      let typeScriptFeatures: any = {};
      if (sections.script || sections.scriptSetup) {
        const scriptContent = sections.scriptSetup || sections.script;
        lifecycleMethods = this.extractLifecycleMethods(scriptContent!);

        // Parse the script content with Tree-sitter for advanced analysis
        const isTypeScript = sections.scriptLang === 'ts' || filePath.endsWith('.ts');
        const tree = this.parseScriptContent(scriptContent!, isTypeScript);
        if (tree?.rootNode) {
          advancedComposition = this.extractAdvancedCompositionAPI(tree);
          vueUseComposables = this.extractVueUseComposables(tree);

          // Extract TypeScript features if the file is TypeScript
          if (isTypeScript) {
            typeScriptFeatures = this.extractTypeScriptFeatures(scriptContent!, tree);
          }
        }
      }

      // Extract Vite patterns and styling features from the entire file content
      const vitePatterns = this.extractVitePatterns(content);
      const stylingFeatures = this.extractStylingFeatures(content);
      const testingPatterns = this.extractTestingPatterns(filePath);

      const component: VueComponent = {
        type: 'component',
        name: componentName,
        filePath,
        props,
        emits,
        slots,
        composables: [...composables, ...vueUseComposables],
        template_dependencies: templateDependencies,
        metadata: {
          scriptSetup: sections.scriptSetup !== null,
          hasScript: sections.script !== null || sections.scriptSetup !== null,
          hasTemplate: sections.template !== null,
          hasStyle: sections.style !== null,
          scriptLang: sections.scriptLang || 'js',
          props: props.map(p => p.name),
          emits: emits,
          lifecycle: lifecycleMethods,
          // Vue 3 built-in components
          builtInComponents,
          // Advanced Composition API
          advancedComposition,
          // VueUse composables
          vueUseComposables,
          // Template analysis
          directives: directives.map(d => ({
            name: d.name,
            type: d.type,
            modifiers: d.modifiers,
            arguments: d.arguments
          })),
          scopedSlots,
          templateRefs,
          dynamicComponents,
          eventHandlers,
          // Vite patterns
          vitePatterns,
          // Styling features
          styling: {
            cssModules: this.extractCSSModules(content),
            hasCSSModules: /<style\s+module/.test(content),
            preprocessors: this.extractPreprocessors(content),
            hasPreprocessors: /<style\s+[^>]*lang=["'](scss|sass|less|stylus)["']/.test(content),
            scoped: /<style[^>]*\s+scoped/.test(content),
            variables: this.extractCSSVariables(content),
            hasDynamicStyling: this.hasDynamicStyling(content),
            dynamicStyleVariables: this.extractDynamicStyleVariables(content)
          },
          // Testing patterns
          testingPatterns,
          // TypeScript features
          typeScriptFeatures,
        },
      };

      return component;

    } catch (error) {
      logger.error(`Failed to parse Vue SFC: ${filePath}`, { error });
      return null;
    }
  }

  /**
   * Extract <template>, <script>, <style> sections from Vue SFC
   */

  /**
   * Analyze Vue script section for component metadata
   */
  private async analyzeVueScript(scriptContent: string, filePath: string): Promise<{
    props: PropDefinition[];
    emits: string[];
    composables: string[];
  }> {
    const tree = this.parser.parse(scriptContent);

    return {
      props: this.extractVueProps(tree),
      emits: this.extractVueEmits(tree),
      composables: this.extractVueComposables(tree),
    };
  }

  /**
   * Extract Vue component props from AST
   */
  private extractVueProps(tree: any): PropDefinition[] {
    const props: PropDefinition[] = [];

    if (!tree?.rootNode) return props;

    // Look for props in different formats:
    // 1. defineProps() in <script setup>
    // 2. props: {} in options API
    // 3. Props interface in TypeScript

    const traverse = (node: Parser.SyntaxNode) => {
      // defineProps() call
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'defineProps') {
          const argsNode = node.child(1);
          const propsArg = argsNode?.child(1); // First argument (skip opening parenthesis)
          if (propsArg) {
            props.push(...this.parsePropsFromNode(propsArg));
          }
        }
      }

      // props: {} in options API
      if (node.type === 'pair') {
        const keyNode = node.child(0);
        if (keyNode?.text === 'props') {
          const propsValue = node.child(2); // After 'props' and ':'
          if (propsValue) {
            props.push(...this.parsePropsFromNode(propsValue));
          }
        }
      }

      // Traverse children using Tree-sitter API
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return props;
  }

  /**
   * Parse props from an AST node (object or array)
   */
  private parsePropsFromNode(node: any): PropDefinition[] {
    const props: PropDefinition[] = [];

    if (!node) return props;

    // Handle array format: ['prop1', 'prop2']
    if (node.type === 'array') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          const propName = this.extractStringLiteral(child);
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
          const propName = this.extractStringLiteral(propNameNode) || propNameNode?.text;

          if (propName) {
            const propValue = child.child(2); // After property name and ':'

            if (propValue) {
              props.push(this.parsePropDefinition(propName, propValue));
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
  private parsePropDefinition(name: string, valueNode: any): PropDefinition {
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
            prop.default = this.extractStringLiteral(value) || value?.text;
          }
        }
      }
    }

    return prop;
  }

  /**
   * Extract Vue component emits from AST
   */
  private extractVueEmits(tree: any): string[] {
    const emits: string[] = [];

    if (!tree?.rootNode) return emits;

    const traverse = (node: Parser.SyntaxNode) => {
      // defineEmits() call
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'defineEmits') {
          const argsNode = node.child(1);
          const emitsArg = argsNode?.child(1); // First argument
          if (emitsArg?.type === 'array') {
            for (let i = 0; i < emitsArg.childCount; i++) {
              const child = emitsArg.child(i);
              if (child) {
                const emitName = this.extractStringLiteral(child);
                if (emitName) {
                  emits.push(emitName);
                }
              }
            }
          }
        }
      }

      // emits: [] in options API
      if (node.type === 'pair') {
        const keyNode = node.child(0);
        if (keyNode?.text === 'emits') {
          const emitsValue = node.child(2); // After 'emits' and ':'
          if (emitsValue?.type === 'array') {
            for (let i = 0; i < emitsValue.childCount; i++) {
              const child = emitsValue.child(i);
              if (child) {
                const emitName = this.extractStringLiteral(child);
                if (emitName) {
                  emits.push(emitName);
                }
              }
            }
          }
        }
      }

      // Look for $emit calls
      if (node.type === 'call_expression') {
        const caller = node.child(0);
        if (caller?.type === 'member_expression') {
          const object = caller.child(0)?.text;
          const property = caller.child(2)?.text;

          if ((object === '$emit' || property === 'emit')) {
            const argsNode = node.child(1);
            const firstArg = argsNode?.child(1);
            const emitName = this.extractStringLiteral(firstArg);
            if (emitName && !emits.includes(emitName)) {
              emits.push(emitName);
            }
          }
        }
      }

      // Traverse children using Tree-sitter API
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return emits;
  }

  /**
   * Extract Vue composables used in the component
   */
  private extractVueComposables(tree: any): string[] {
    const composables: string[] = [];

    if (!tree?.rootNode) return composables;

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

      // Traverse children using Tree-sitter API
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(tree.rootNode);
    return composables;
  }


  /**
   * Extract advanced Composition API patterns
   */
  private extractAdvancedCompositionAPI(tree: any): {
    provide: Array<{ key: string; value?: string }>;
    inject: Array<{ key: string; defaultValue?: string }>;
    defineExpose: string[];
    defineModel: Array<{ name: string; options?: string }>;
    watchEffect: string[];
    computed: string[];
  } {
    const result = {
      provide: [] as Array<{ key: string; value?: string }>,
      inject: [] as Array<{ key: string; defaultValue?: string }>,
      defineExpose: [] as string[],
      defineModel: [] as Array<{ name: string; options?: string }>,
      watchEffect: [] as string[],
      computed: [] as string[]
    };

    if (!tree?.rootNode) return result;

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        const functionName = functionNode?.text;

        switch (functionName) {
          case 'provide':
            const provideArgs = this.extractCallArguments(node);
            if (provideArgs.length >= 1) {
              result.provide.push({
                key: provideArgs[0],
                value: provideArgs[1]
              });
            }
            break;

          case 'inject':
            const injectArgs = this.extractCallArguments(node);
            if (injectArgs.length >= 1) {
              result.inject.push({
                key: injectArgs[0],
                defaultValue: injectArgs[1]
              });
            }
            break;

          case 'defineExpose':
            const exposeArgs = this.extractCallArguments(node);
            if (exposeArgs.length > 0) {
              // Parse the exposed object to extract property names
              const exposedContent = exposeArgs[0];
              const propertyNames = this.parseObjectProperties(exposedContent);
              result.defineExpose.push(...propertyNames);
            }
            break;

          case 'defineModel':
            const modelArgs = this.extractCallArguments(node);
            if (modelArgs.length >= 1) {
              result.defineModel.push({
                name: modelArgs[0],
                options: modelArgs[1]
              });
            } else {
              // defineModel() without parameters defaults to 'modelValue'
              result.defineModel.push({
                name: 'modelValue',
                options: undefined
              });
            }
            break;

          case 'watchEffect':
            result.watchEffect.push(functionName);
            break;

          case 'computed':
            result.computed.push(functionName);
            break;
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
    return result;
  }

  /**
   * Extract call arguments as strings
   */
  private extractCallArguments(callNode: Parser.SyntaxNode): string[] {
    const args: string[] = [];
    const argsNode = callNode.child(1); // arguments node

    if (argsNode) {
      for (let i = 0; i < argsNode.childCount; i++) {
        const child = argsNode.child(i);
        if (child && child.type !== '(' && child.type !== ')' && child.type !== ',') {
          args.push(this.extractStringLiteral(child) || child.text);
        }
      }
    }

    return args;
  }

  /**
   * Parse object properties from a string representation
   * Handles patterns like "{ prop1, prop2, prop3: value }"
   */
  private parseObjectProperties(objectString: string): string[] {
    const properties: string[] = [];

    // Remove outer braces and whitespace
    const content = objectString.replace(/^\s*\{\s*|\s*\}\s*$/g, '');

    // Split by commas and extract property names
    const parts = content.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        // Extract property name (before colon if present, otherwise the whole thing)
        const colonIndex = trimmed.indexOf(':');
        const propertyName = colonIndex > 0 ? trimmed.substring(0, colonIndex).trim() : trimmed;

        // Basic validation that it looks like an identifier
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propertyName)) {
          properties.push(propertyName);
        }
      }
    }

    return properties;
  }

  /**
   * Extract props from component
   */
  private extractProps(tree: any, content: string): string[] {
    const props: string[] = [];

    if (!tree?.rootNode) return props;

    // Extract from defineProps in script setup
    const definePropsPattern = /defineProps\s*<([^>]+)>|defineProps\s*\(\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = definePropsPattern.exec(content)) !== null) {
      const propsDefinition = match[1] || match[2];
      if (propsDefinition) {
        // Extract prop names using simple regex
        const propNames = propsDefinition.match(/(\w+)(?=\s*[?:])/g);
        if (propNames) {
          props.push(...propNames);
        }
      }
    }

    // Extract from props option in Options API
    const propsOptionPattern = /props\s*:\s*\{([^}]+)\}/g;
    while ((match = propsOptionPattern.exec(content)) !== null) {
      const propsDefinition = match[1];
      if (propsDefinition) {
        const propNames = propsDefinition.match(/(\w+)\s*:/g);
        if (propNames) {
          props.push(...propNames.map(p => p.replace(':', '').trim()));
        }
      }
    }

    return [...new Set(props)];
  }

  /**
   * Extract emits from component
   */
  private extractEmits(tree: any, content: string): string[] {
    const emits: string[] = [];

    if (!tree?.rootNode) return emits;

    // Extract from defineEmits in script setup
    const defineEmitsPattern = /defineEmits\s*<([^>]+)>|defineEmits\s*\(\s*\[([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = defineEmitsPattern.exec(content)) !== null) {
      const emitsDefinition = match[1] || match[2];
      if (emitsDefinition) {
        // Extract emit names
        const emitNames = emitsDefinition.match(/['"`](\w+)['"`]/g);
        if (emitNames) {
          emits.push(...emitNames.map(e => e.replace(/['"`]/g, '')));
        }
      }
    }

    // Extract from emits option in Options API
    const emitsOptionPattern = /emits\s*:\s*\[([^\]]+)\]/g;
    while ((match = emitsOptionPattern.exec(content)) !== null) {
      const emitsDefinition = match[1];
      if (emitsDefinition) {
        const emitNames = emitsDefinition.match(/['"`](\w+)['"`]/g);
        if (emitNames) {
          emits.push(...emitNames.map(e => e.replace(/['"`]/g, '')));
        }
      }
    }

    return [...new Set(emits)];
  }

  /**
   * Extract lifecycle hooks from component
   */
  private extractLifecycleHooks(tree: any, content: string): string[] {
    const lifecycle: string[] = [];
    const lifecycleHooks = [
      'beforeCreate', 'created', 'beforeMount', 'mounted',
      'beforeUpdate', 'updated', 'beforeUnmount', 'unmounted',
      'beforeDestroy', 'destroyed', 'activated', 'deactivated'
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

  /**
   * Detect VueUse composables
   */
  private extractVueUseComposables(tree: any): string[] {
    const vueUseComposables: string[] = [];

    if (!tree?.rootNode) return vueUseComposables;

    // Common VueUse composables
    const commonVueUse = [
      // Core
      'useCounter', 'useToggle', 'useBoolean', 'useClipboard', 'useColorMode',
      'useCycleList', 'useLocalStorage', 'useSessionStorage', 'useStorage',
      'usePreferredDark', 'usePreferredLanguages', 'useTitle', 'useFavicon',
      'useDebounce', 'useFetch', 'useAsyncState',
      // Browser
      'useActiveElement', 'useBreakpoints', 'useBrowserLocation', 'useClipboard',
      'useEventListener', 'useFullscreen', 'useGeolocation', 'useIdle',
      'useIntersectionObserver', 'useMediaQuery', 'useMemory', 'useMouseInElement',
      'useMousePressed', 'useNetwork', 'useOnline', 'usePageLeave', 'usePermission',
      'usePreferredColorScheme', 'usePreferredReducedMotion', 'useResizeObserver',
      'useScriptTag', 'useShare', 'useSpeechRecognition', 'useSpeechSynthesis',
      'useUrlSearchParams', 'useVibrate', 'useWakeLock', 'useWebNotification',
      // Sensors
      'useAccelerometer', 'useBattery', 'useDeviceMotion', 'useDeviceOrientation',
      'useDevicePixelRatio', 'useDocumentVisibility', 'useElementBounding',
      'useElementSize', 'useElementVisibility', 'useEyeDropper', 'useFps',
      'useKeyModifier', 'useMagicKeys', 'useMouse', 'useMousePressed', 'useParallax',
      'usePointerSwipe', 'useScroll', 'useScrollLock', 'useSwipe', 'useTextareaAutosize',
      'useWindowFocus', 'useWindowScroll', 'useWindowSize',
      // Head management
      'useHead', 'useSeoMeta', 'useServerHead'
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

  /**
   * Detect Vite-specific patterns
   */
  private extractVitePatterns(content: string): {
    globImports: string[];
    envVariables: string[];
    hotReload: boolean;
  } {
    const result = {
      globImports: [] as string[],
      envVariables: [] as string[],
      hotReload: false
    };

    // Extract import.meta.glob patterns
    const globPattern = /import\.meta\.glob\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match: RegExpExecArray | null;
    while ((match = globPattern.exec(content)) !== null) {
      result.globImports.push(match[1]);
    }

    // Extract environment variables
    const envPattern = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
    while ((match = envPattern.exec(content)) !== null) {
      if (!result.envVariables.includes(match[1])) {
        result.envVariables.push(match[1]);
      }
    }

    // Check for hot reload
    result.hotReload = /import\.meta\.hot/.test(content);

    return result;
  }

  /**
   * Detect CSS Modules and scoped styles
   */
  private extractStylingFeatures(content: string): {
    cssModules: boolean;
    scopedStyles: boolean;
    cssVariables: string[];
    preprocessor?: string;
  } {
    const result = {
      cssModules: false,
      scopedStyles: false,
      cssVariables: [] as string[],
      preprocessor: undefined as string | undefined
    };

    // Check for CSS Modules
    result.cssModules = /<style\s+module/.test(content);

    // Check for scoped styles
    result.scopedStyles = /<style\s+scoped/.test(content);

    // Extract CSS custom properties (CSS variables)
    const cssVarPattern = /--([a-zA-Z-][a-zA-Z0-9-]*)/g;
    let match: RegExpExecArray | null;
    while ((match = cssVarPattern.exec(content)) !== null) {
      if (!result.cssVariables.includes(match[1])) {
        result.cssVariables.push(match[1]);
      }
    }

    // Detect preprocessor
    if (/<style\s+[^>]*lang=["']scss["']/.test(content)) {
      result.preprocessor = 'scss';
    } else if (/<style\s+[^>]*lang=["']sass["']/.test(content)) {
      result.preprocessor = 'sass';
    } else if (/<style\s+[^>]*lang=["']less["']/.test(content)) {
      result.preprocessor = 'less';
    } else if (/<style\s+[^>]*lang=["']stylus["']/.test(content)) {
      result.preprocessor = 'stylus';
    }

    return result;
  }


  /**
   * Detect testing patterns
   */
  private extractTestingPatterns(filePath: string): {
    isTestFile: boolean;
    isStoryFile: boolean;
    testUtils: string[];
    testFramework?: string;
  } {
    const result = {
      isTestFile: false,
      isStoryFile: false,
      testUtils: [] as string[],
      testFramework: undefined as string | undefined
    };

    // Check if it's a test file
    result.isTestFile = /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(filePath);

    // Check if it's a Storybook story
    result.isStoryFile = /\.stories\.(js|ts|jsx|tsx)$/.test(filePath);

    return result;
  }

  /**
   * Enhance TypeScript integration for Vue components
   */
  private extractTypeScriptFeatures(content: string, tree: any): {
    interfaces: Array<{ name: string; properties: string[] }>;
    types: Array<{ name: string; definition: string }>;
    generics: string[];
    imports: Array<{ name: string; isTypeOnly: boolean; source: string }>;
  } {
    const result = {
      interfaces: [] as Array<{ name: string; properties: string[] }>,
      types: [] as Array<{ name: string; definition: string }>,
      generics: [] as string[],
      imports: [] as Array<{ name: string; isTypeOnly: boolean; source: string }>
    };

    if (!tree?.rootNode) return result;

    const traverse = (node: Parser.SyntaxNode) => {
      // Extract TypeScript interfaces
      if (node.type === 'interface_declaration') {
        const nameNode = node.child(1);
        const interfaceName = nameNode?.text;
        if (interfaceName) {
          const properties = this.extractInterfaceProperties(node);
          result.interfaces.push({
            name: interfaceName,
            properties
          });
        }
      }

      // Extract type aliases
      if (node.type === 'type_alias_declaration') {
        const nameNode = node.child(1);
        const typeName = nameNode?.text;
        if (typeName) {
          const definition = node.text;
          result.types.push({
            name: typeName,
            definition
          });
        }
      }

      // Extract generic type parameters
      if (node.type === 'type_parameters') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === 'type_identifier') {
            const genericName = child.text;
            if (genericName && !result.generics.includes(genericName)) {
              result.generics.push(genericName);
            }
          }
        }
      }

      // Extract type-only imports
      if (node.type === 'import_statement') {
        const hasTypeKeyword = node.text.includes('import type');
        const sourceMatch = node.text.match(/from\s+['"`]([^'"`]+)['"`]/);
        const source = sourceMatch ? sourceMatch[1] : '';

        if (hasTypeKeyword && source) {
          // Extract imported type names
          const importNames = this.extractImportNames(node);
          for (const name of importNames) {
            result.imports.push({
              name,
              isTypeOnly: true,
              source
            });
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
    return result;
  }

  /**
   * Extract interface properties
   */
  private extractInterfaceProperties(interfaceNode: Parser.SyntaxNode): string[] {
    const properties: string[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'property_signature') {
        const nameNode = node.child(0);
        if (nameNode?.text) {
          properties.push(nameNode.text);
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(interfaceNode);
    return properties;
  }

  /**
   * Extract import names from import statement
   */
  private extractImportNames(importNode: Parser.SyntaxNode): string[] {
    const names: string[] = [];

    const traverse = (node: Parser.SyntaxNode) => {
      if (node.type === 'import_specifier') {
        const nameNode = node.child(0);
        if (nameNode?.text) {
          names.push(nameNode.text);
        }
      } else if (node.type === 'identifier' && node.parent?.type === 'named_imports') {
        names.push(node.text);
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    };

    traverse(importNode);
    return names;
  }

  /**
   * Extract template dependencies (used components)
   */
  private extractTemplateDependencies(templateContent: string): string[] {
    const dependencies: string[] = [];

    // Match custom component tags (PascalCase or kebab-case)
    const componentRegex = /<(?:([A-Z][a-zA-Z0-9]*)|([a-z][a-z0-9]*(?:-[a-z0-9]+)+))(?:\s|>|\/)/g;

    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(templateContent)) !== null) {
      const componentName = match[1] || this.kebabToPascal(match[2]);
      if (componentName && !dependencies.includes(componentName)) {
        dependencies.push(componentName);
      }
    }

    return dependencies;
  }

  /**
   * Extract Vue 3 built-in components from template
   */
  private extractBuiltInComponents(templateContent: string): string[] {
    const builtInComponents: string[] = [];
    const builtIns = ['Teleport', 'Suspense', 'KeepAlive', 'Transition', 'TransitionGroup'];

    for (const component of builtIns) {
      const regex = new RegExp(`<${component}[\\s>]`, 'g');
      if (regex.test(templateContent)) {
        builtInComponents.push(component);
        // Also add kebab-case version for compatibility
        const kebabCase = component
          .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2') // Handle consecutive capitals
          .replace(/([a-z])([A-Z])/g, '$1-$2')      // Handle normal camelCase
          .toLowerCase();
        builtInComponents.push(kebabCase);
      }
    }

    return [...new Set(builtInComponents)];
  }

  /**
   * Extract directives from template
   */
  private extractDirectives(templateContent: string): Array<{
    name: string;
    type: 'built-in' | 'custom';
    modifiers: string[];
    arguments?: string;
  }> {
    const directives: Array<{
      name: string;
      type: 'built-in' | 'custom';
      modifiers: string[];
      arguments?: string;
    }> = [];

    const builtInDirectives = ['if', 'else', 'else-if', 'show', 'for', 'on', 'bind', 'model', 'slot', 'pre', 'cloak', 'once', 'memo', 'text', 'html'];

    // Match directives: v-directive:argument.modifier1.modifier2="value"
    const directiveRegex = /v-([a-zA-Z][a-zA-Z0-9-]*)(?::([a-zA-Z][a-zA-Z0-9-]*))?(?:\.([a-zA-Z0-9.-]+))?/g;

    let match: RegExpExecArray | null;
    while ((match = directiveRegex.exec(templateContent)) !== null) {
      const directiveName = match[1];
      const argument = match[2];
      const modifiers = match[3] ? match[3].split('.') : [];

      const type: 'built-in' | 'custom' = builtInDirectives.includes(directiveName) ? 'built-in' : 'custom';

      const directive = {
        name: directiveName,
        type,
        modifiers,
        ...(argument && { arguments: argument })
      };

      // Avoid duplicates
      const exists = directives.some(d =>
        d.name === directive.name &&
        d.arguments === directive.arguments &&
        JSON.stringify(d.modifiers) === JSON.stringify(directive.modifiers)
      );

      if (!exists) {
        directives.push(directive);
      }
    }

    return directives;
  }

  /**
   * Extract scoped slots from template
   */
  private extractScopedSlots(templateContent: string): Array<{
    name: string;
    props: string[];
  }> {
    const scopedSlots: Array<{
      name: string;
      props: string[];
    }> = [];

    // Fixed regex to properly handle scoped slot patterns in template content
    // The templateContent contains inner template content, so we search for template tags within it
    // Matches: <template #slotName="{ prop1, prop2 }"> or <template v-slot:slotName="{ prop1, prop2 }">
    const scopedSlotRegex = /<template\s+(?:#([a-zA-Z][a-zA-Z0-9-]*)|v-slot:([a-zA-Z][a-zA-Z0-9-]*))="?\{\s*([^}]*)\s*\}"?/g;

    let match: RegExpExecArray | null;
    while ((match = scopedSlotRegex.exec(templateContent)) !== null) {
      const slotName = match[1] || match[2] || 'default';
      const propsString = match[3] || '';

      // Extract individual prop names from destructured props
      const props = propsString
        .split(',')
        .map((prop: string) => prop.trim())
        .filter((prop: string) => prop.length > 0);

      scopedSlots.push({
        name: slotName,
        props
      });
    }

    return scopedSlots;
  }

  /**
   * Extract template refs
   */
  private extractTemplateRefs(templateContent: string): string[] {
    const refs: string[] = [];

    // Match ref="refName"
    const refRegex = /ref="([^"]+)"/g;

    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(templateContent)) !== null) {
      const refName = match[1];
      if (!refs.includes(refName)) {
        refs.push(refName);
      }
    }

    return refs;
  }

  /**
   * Extract dynamic components
   */
  private extractDynamicComponents(templateContent: string): string[] {
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

  /**
   * Extract event handlers from template
   */
  private extractEventHandlers(templateContent: string): Array<{
    event: string;
    handler: string;
    modifiers: string[];
  }> {
    const handlers: Array<{
      event: string;
      handler: string;
      modifiers: string[];
    }> = [];

    // Match @event.modifier="handler" or v-on:event.modifier="handler"
    const eventRegex = /(?:@([a-zA-Z][a-zA-Z0-9-]*)|v-on:([a-zA-Z][a-zA-Z0-9-]*))(?:\.([a-zA-Z0-9.-]+))?="([^"]+)"/g;

    let match: RegExpExecArray | null;
    while ((match = eventRegex.exec(templateContent)) !== null) {
      const event = match[1] || match[2];
      const modifiers = match[3] ? match[3].split('.') : [];
      const handler = match[4];

      handlers.push({
        event,
        handler,
        modifiers
      });
    }

    return handlers;
  }

  /**
   * Extract Vue lifecycle methods from script content
   */
  private extractLifecycleMethods(scriptContent: string): string[] {
    const lifecycleMethods: string[] = [];

    try {
      const tree = this.parser.parse(scriptContent);
      if (!tree?.rootNode) return lifecycleMethods;

      const vueLifecycleHooks = [
        'beforeCreate', 'created', 'beforeMount', 'mounted',
        'beforeUpdate', 'updated', 'beforeUnmount', 'unmounted',
        'activated', 'deactivated', 'errorCaptured'
      ];

      const traverse = (node: any) => {
        // Look for method definitions in export default object (Options API)
        if (node.type === 'method_definition') {
          const nameNode = node.child(0); // property_identifier
          const methodName = nameNode?.text;

          if (methodName && vueLifecycleHooks.includes(methodName)) {
            if (!lifecycleMethods.includes(methodName)) {
              lifecycleMethods.push(methodName);
            }
          }
        }

        // Look for property pairs with function values (alternative Options API format)
        if (node.type === 'pair') {
          const keyNode = node.child(0);
          const key = keyNode?.text?.replace(/['"]/g, '');

          if (key && vueLifecycleHooks.includes(key)) {
            if (!lifecycleMethods.includes(key)) {
              lifecycleMethods.push(key);
            }
          }
        }

        // Look for lifecycle hooks in Composition API (onMounted, etc.)
        if (node.type === 'call_expression') {
          const functionNode = node.child(0);
          const functionName = functionNode?.text;

          if (functionName?.startsWith('on') && functionName.length > 2) {
            // Convert onMounted -> mounted, onCreated -> created, etc.
            const hookName = functionName.substring(2).toLowerCase();
            const lifecycleMap: Record<string, string> = {
              'mounted': 'mounted',
              'updated': 'updated',
              'unmounted': 'unmounted',
              'beforemount': 'beforeMount',
              'beforeupdate': 'beforeUpdate',
              'beforeunmount': 'beforeUnmount'
            };

            if (lifecycleMap[hookName]) {
              const mappedHook = lifecycleMap[hookName];
              if (!lifecycleMethods.includes(mappedHook)) {
                lifecycleMethods.push(mappedHook);
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

      traverse(tree.rootNode);
    } catch (error) {
      logger.warn('Failed to extract lifecycle methods', { error });
    }

    return lifecycleMethods;
  }

  /**
   * Extract slots from template
   */
  private extractSlots(templateContent: string): string[] {
    const slots: string[] = [];

    // Match slot definitions
    const slotRegex = /<slot(?:\s+name=["']([^"']+)["'])?/g;

    let match;
    while ((match = slotRegex.exec(templateContent)) !== null) {
      const slotName = match[1] || 'default';
      if (!slots.includes(slotName)) {
        slots.push(slotName);
      }
    }

    return slots;
  }

  /**
   * Parse Vue composables from JavaScript/TypeScript files
   */
  private async parseComposables(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueComposable[]> {
    const composables: VueComposable[] = [];

    // Check if this looks like a composable file
    if (!this.isComposableFile(filePath, content)) {
      return composables;
    }

    try {
      const tree = this.parser.parse(content);
      const functions = this.findComposableFunctions(tree);

      for (const func of functions) {
        const composable: VueComposable = {
          type: 'composable',
          name: func.name,
          filePath,
          returns: func.returns,
          dependencies: func.dependencies,
          reactive_refs: func.reactiveRefs,
          metadata: {
            isDefault: func.isDefault,
            parameters: func.parameters,
            returns: func.returns,
            lifecycle: func.dependencies.filter(d => ['onMounted', 'onUnmounted', 'onUpdated'].includes(d))
          },
        };

        composables.push(composable);
      }

    } catch (error) {
      logger.error(`Failed to parse Vue composables in ${filePath}`, { error });
    }

    return composables;
  }

  /**
   * Find composable functions in the AST
   */
  private findComposableFunctions(tree: any): Array<{
    name: string;
    returns: string[];
    dependencies: string[];
    reactiveRefs: string[];
    isDefault: boolean;
    parameters: string[];
  }> {
    const functions: any[] = [];

    if (!tree?.rootNode) return functions;

    const traverse = (node: any) => {
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
          functions.push(this.analyzeComposableFunction(node, name, false));
        }
      }

      // Variable declarations: const useExample = () => {}
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);
        const name = nameNode?.text;

        if (name && name.startsWith('use') && name.length > 3 &&
            (valueNode?.type === 'arrow_function' || valueNode?.type === 'function_expression')) {
          functions.push(this.analyzeComposableFunction(valueNode, name, false));
        }
      }

      // Export default function
      if (node.type === 'export_default_declaration') {
        let funcNode = null;
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && (child.type === 'function_declaration' ||
              child.type === 'arrow_function' ||
              child.type === 'function_expression')) {
            funcNode = child;
            break;
          }
        }

        if (funcNode) {
          const name = 'default'; // Will be extracted from filename
          functions.push(this.analyzeComposableFunction(funcNode, name, true));
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

  /**
   * Analyze a composable function to extract its metadata
   */
  private analyzeComposableFunction(node: any, name: string, isDefault: boolean): {
    name: string;
    returns: string[];
    dependencies: string[];
    reactiveRefs: string[];
    isDefault: boolean;
    parameters: string[];
  } {
    const returns: string[] = [];
    const dependencies: string[] = [];
    const reactiveRefs: string[] = [];
    const parameters: string[] = [];

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
      this.analyzeComposableBody(body, returns, dependencies, reactiveRefs);
    }

    return {
      name,
      returns,
      dependencies,
      reactiveRefs,
      isDefault,
      parameters,
    };
  }

  /**
   * Analyze composable function body for return values and dependencies
   */
  private analyzeComposableBody(body: any, returns: string[], dependencies: string[], reactiveRefs: string[]): void {
    const traverse = (node: any) => {
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
              const parent = this.findParent(node, 'variable_declarator');
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

  /**
   * Find parent node of a specific type
   */
  private findParent(node: Parser.SyntaxNode, parentType: string): Parser.SyntaxNode | null {
    let current = node.parent;
    while (current && current.type !== parentType) {
      current = current.parent;
    }
    return current;
  }

  /**
   * Parse Vue Router routes configuration
   */
  private async parseVueRouterRoutes(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueRoute[]> {
    const routes: VueRoute[] = [];

    try {
      const tree = this.parser.parse(content);
      if (!tree?.rootNode) return routes;

      // Find route definitions in different patterns
      this.findRouteDefinitions(tree.rootNode, routes, filePath);

    } catch (error) {
      logger.error(`Failed to parse Vue Router routes in ${filePath}`, { error });
    }

    return routes;
  }

  /**
   * Find and extract route definitions from AST
   */
  private findRouteDefinitions(node: Parser.SyntaxNode, routes: VueRoute[], filePath: string): void {
    const traverse = (node: Parser.SyntaxNode) => {
      // Pattern 1: createRouter({ routes: [...] })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'createRouter') {
          const argsNode = node.child(1);
          if (argsNode) {
            const routesArray = this.findRoutesArrayInObject(argsNode);
            if (routesArray) {
              this.parseRoutesArray(routesArray, routes, filePath);
            }
          }
        }
      }

      // Pattern 2: const routes = [...]
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);

        if (nameNode?.text === 'routes' && valueNode?.type === 'array') {
          this.parseRoutesArray(valueNode, routes, filePath);
        }
      }

      // Pattern 3: export default [...] (route array export)
      if (node.type === 'export_default_declaration') {
        const valueNode = node.child(1);
        if (valueNode?.type === 'array') {
          this.parseRoutesArray(valueNode, routes, filePath);
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

    traverse(node);
  }

  /**
   * Find routes array in createRouter object argument
   */
  private findRoutesArrayInObject(objectNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    for (let i = 0; i < objectNode.childCount; i++) {
      const child = objectNode.child(i);
      if (child?.type === 'pair') {
        const keyNode = child.child(0);
        const valueNode = child.child(2);

        if (keyNode?.text === 'routes' && valueNode?.type === 'array') {
          return valueNode;
        }
      }
    }
    return null;
  }

  /**
   * Parse routes array and extract individual route objects
   */
  private parseRoutesArray(arrayNode: Parser.SyntaxNode, routes: VueRoute[], filePath: string): void {
    for (let i = 0; i < arrayNode.childCount; i++) {
      const routeNode = arrayNode.child(i);
      if (routeNode?.type === 'object') {
        const route = this.parseRouteObject(routeNode, filePath);
        if (route) {
          routes.push(route);
        }
      }
    }
  }

  /**
   * Parse individual route object
   */
  private parseRouteObject(routeNode: Parser.SyntaxNode, filePath: string): VueRoute | null {
    const route: any = {
      type: 'route',
      name: '',
      filePath,
      path: '',
      component: null,
      metadata: {}
    };

    let metaObject: any = {};

    // Parse route properties
    for (let i = 0; i < routeNode.childCount; i++) {
      const pairNode = routeNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (!keyNode || !valueNode) continue;

        const key = this.getVueNodeText(keyNode).replace(/['"]/g, '');

        switch (key) {
          case 'path':
            route.path = this.getVueNodeText(valueNode).replace(/['"]/g, '');
            route.metadata.path = route.path;
            break;
          case 'name':
            route.name = this.getVueNodeText(valueNode).replace(/['"]/g, '');
            route.metadata.name = route.name;
            break;
          case 'component':
            const componentValue = this.getVueNodeText(valueNode).replace(/['"]/g, '');
            route.component = componentValue;
            route.metadata.component = componentValue;

            // Check if it's a lazy loaded component
            if (valueNode.type === 'arrow_function' || this.getVueNodeText(valueNode).includes('import(')) {
              route.metadata.lazy = true;
            }
            break;
          case 'meta':
            metaObject = this.parseObjectToJson(valueNode);
            // Extract specific meta properties the tests expect
            if (metaObject.requiresAuth !== undefined) {
              route.metadata.requiresAuth = metaObject.requiresAuth;
            }
            if (metaObject.role !== undefined) {
              route.metadata.role = metaObject.role;
            }
            break;
          case 'props':
            route.metadata.props = this.getVueNodeText(valueNode) === 'true';
            break;
          case 'children':
            if (valueNode.type === 'array') {
              route.metadata.children = [];
              for (let j = 0; j < valueNode.childCount; j++) {
                const childRouteNode = valueNode.child(j);
                if (childRouteNode?.type === 'object') {
                  const childRoute = this.parseRouteObject(childRouteNode, filePath);
                  if (childRoute) {
                    route.metadata.children.push(childRoute);
                  }
                }
              }
            }
            break;
          default:
            // Store other properties in metadata
            route.metadata[key] = this.getVueNodeText(valueNode);
        }
      }
    }

    // Check if route has dynamic segments
    if (route.path && (route.path.includes(':') || route.path.includes('['))) {
      route.metadata.dynamic = true;
    }

    // Use path as name if no name specified
    if (!route.name && route.path) {
      route.name = route.path.replace(/[\/:\[\]]/g, '_').replace(/^_|_$/g, '') || 'route';
      route.metadata.name = route.name;
    }

    return route.path ? route : null;
  }

  /**
   * Get text content of a node
   */
  protected getVueNodeText(node: Parser.SyntaxNode): string {
    return node.text || '';
  }

  /**
   * Parse an object node to JSON-like structure
   */
  private parseObjectToJson(node: Parser.SyntaxNode): any {
    const obj: any = {};

    for (let i = 0; i < node.childCount; i++) {
      const pairNode = node.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (keyNode && valueNode) {
          const key = this.getVueNodeText(keyNode).replace(/['"]/g, '');
          let value: any = this.getVueNodeText(valueNode);

          // Try to parse as boolean/number
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (!isNaN(Number(value)) && value.trim() !== '') value = Number(value);
          else value = value.replace(/['"]/g, '');

          obj[key] = value;
        }
      }
    }

    return obj;
  }

  /**
   * Parse Pinia store definitions (supports multiple stores per file)
   */
  private async parsePiniaStore(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<PiniaStore[]> {
    try {
      const tree = this.parser.parse(content);
      if (!tree?.rootNode) return [];

      const storeDefinitions = this.findStoreDefinitions(tree.rootNode);
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
            isDefaultExport: storeDefinition.isDefaultExport
          }
        };

        stores.push(store);
      }

      return stores;

    } catch (error) {
      logger.error(`Failed to parse Pinia stores in ${filePath}`, { error });
      return [];
    }
  }

  /**
   * Find ALL defineStore definitions in the AST (supports multiple stores per file)
   */
  private findStoreDefinitions(node: Parser.SyntaxNode): Array<{
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
      // Pattern 1: defineStore('id', { state, getters, actions })
      // Pattern 2: defineStore({ id: 'name', state, getters, actions })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'defineStore') {
          const storeDef = this.parseDefineStoreCall(node);
          if (storeDef) {
            storeDefinitions.push(storeDef);
          }
          // Continue searching for more stores (don't return here)
        }
      }

      // Look for variable declarations or exports that contain stores
      if (node.type === 'variable_declarator' || node.type === 'export_default_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
        return;
      }

      // Recursively traverse ALL children (removed the !storeDefinition condition)
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

  /**
   * Find defineStore definition in the AST (legacy method for single store)
   */
  private findStoreDefinition(node: Parser.SyntaxNode): {
    name: string;
    id: string;
    state: string[];
    getters: string[];
    actions: string[];
    composableName: string;
    isDefaultExport: boolean;
    style: string;
  } | null {
    let storeDefinition: any = null;

    const traverse = (node: Parser.SyntaxNode) => {
      // Pattern 1: defineStore('id', { state, getters, actions })
      // Pattern 2: defineStore({ id: 'name', state, getters, actions })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'defineStore') {
          storeDefinition = this.parseDefineStoreCall(node);
          return;
        }
      }

      // Look for variable declarations or exports that contain the store
      if (node.type === 'variable_declarator' || node.type === 'export_default_declaration') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            traverse(child);
          }
        }
        return;
      }

      // Recursively traverse children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && !storeDefinition) {
          traverse(child);
        }
      }
    };

    traverse(node);
    return storeDefinition;
  }

  /**
   * Parse defineStore function call
   */
  private parseDefineStoreCall(callNode: Parser.SyntaxNode): {
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

    // Check if this is wrapped in an export or variable declaration
    const parent = this.findParent(callNode, 'variable_declarator');
    if (parent) {
      const nameNode = parent.child(0);
      if (nameNode?.text) {
        composableName = nameNode.text;
      }
    }

    const exportParent = this.findParent(callNode, 'export_default_declaration');
    if (exportParent) {
      isDefaultExport = true;
    }

    // Parse arguments
    const firstArg = argsNode.child(1); // Skip opening parenthesis
    const secondArg = argsNode.child(3); // Skip comma

    if (firstArg) {
      if (firstArg.type === 'string') {
        // Pattern: defineStore('id', { ... })
        storeId = this.getVueNodeText(firstArg).replace(/['"]/g, '');
        storeConfig = secondArg;
      } else if (firstArg.type === 'object') {
        // Pattern: defineStore({ id: 'name', ... })
        storeConfig = firstArg;
        storeId = this.findPropertyInObject(firstArg, 'id') || '';
      }
    }

    if (!storeConfig || !storeId) return null;

    // Determine store style based on second argument
    let style = 'options';
    if (secondArg && secondArg.type === 'arrow_function') {
      style = 'setup';
    }

    let state: string[] = [];
    let getters: string[] = [];
    let actions: string[] = [];

    if (style === 'setup' && secondArg?.type === 'arrow_function') {
      // Parse Setup API store (arrow function)
      const setupContent = this.extractSetupStoreContent(secondArg);
      state = setupContent.state;
      getters = setupContent.getters;
      actions = setupContent.actions;
    } else if (style === 'options' && storeConfig) {
      // Parse Options API store (object)
      state = this.extractStoreSection(storeConfig, 'state');
      getters = this.extractStoreSection(storeConfig, 'getters');
      actions = this.extractStoreSection(storeConfig, 'actions');
    }

    return {
      name: storeId,
      id: storeId,
      state,
      getters,
      actions,
      composableName,
      isDefaultExport,
      style
    };
  }

  /**
   * Extract content from Setup API store (arrow function)
   */
  private extractSetupStoreContent(functionNode: Parser.SyntaxNode): {
    state: string[];
    getters: string[];
    actions: string[];
  } {
    const state: string[] = [];
    const getters: string[] = [];
    const actions: string[] = [];

    // Find the function body
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
      // Look for variable declarations
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);
        const varName = nameNode?.text;

        if (varName && valueNode) {
          // Check if it's a ref() call (state)
          if (valueNode.type === 'call_expression') {
            const functionCall = valueNode.child(0);
            const funcName = functionCall?.text;

            if (funcName === 'ref' || funcName === 'reactive') {
              state.push(varName);
            } else if (funcName === 'computed') {
              getters.push(varName);
            }
          }
          // Check if it's a function (action)
          else if (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression') {
            actions.push(varName);
          }
        }
      }

      // Look for function declarations (also actions)
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

      // Traverse children
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

  /**
   * Extract state, getters, or actions from store configuration
   */
  private extractStoreSection(configNode: Parser.SyntaxNode, sectionName: string): string[] {
    const items: string[] = [];

    for (let i = 0; i < configNode.childCount; i++) {
      const pairNode = configNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (keyNode?.text === sectionName && valueNode) {
          if (sectionName === 'state' && valueNode.type === 'arrow_function') {
            // state: () => ({ ... })
            const returnValue = this.findReturnValue(valueNode);
            if (returnValue?.type === 'object') {
              items.push(...this.extractObjectKeys(returnValue));
            }
          } else if (valueNode.type === 'object') {
            // getters: { ... } or actions: { ... }
            items.push(...this.extractObjectKeys(valueNode));
          }
        }
      }
    }

    return items;
  }

  /**
   * Find return value in arrow function or function
   */
  private findReturnValue(functionNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
    // For arrow functions like () => ({ ... })
    for (let i = 0; i < functionNode.childCount; i++) {
      const child = functionNode.child(i);
      if (child?.type === 'object' || child?.type === 'parenthesized_expression') {
        if (child.type === 'parenthesized_expression') {
          const innerChild = child.child(1);
          if (innerChild?.type === 'object') {
            return innerChild;
          }
        } else {
          return child;
        }
      }
    }

    return null;
  }

  /**
   * Extract keys from an object node
   */
  private extractObjectKeys(objectNode: Parser.SyntaxNode): string[] {
    const keys: string[] = [];

    for (let i = 0; i < objectNode.childCount; i++) {
      const pairNode = objectNode.child(i);
      if (pairNode?.type === 'pair' || pairNode?.type === 'method_definition') {
        const keyNode = pairNode.child(0);
        if (keyNode?.text) {
          keys.push(keyNode.text.replace(/['"]/g, ''));
        }
      }
    }

    return keys;
  }

  /**
   * Find a property value in an object node
   */
  private findPropertyInObject(objectNode: Parser.SyntaxNode, propertyName: string): string | null {
    for (let i = 0; i < objectNode.childCount; i++) {
      const pairNode = objectNode.child(i);
      if (pairNode?.type === 'pair') {
        const keyNode = pairNode.child(0);
        const valueNode = pairNode.child(2);

        if (keyNode?.text === propertyName && valueNode) {
          return this.getVueNodeText(valueNode).replace(/['"]/g, '');
        }
      }
    }
    return null;
  }

  /**
   * Parse regular Vue component (not SFC)
   */
  private async parseVueComponent(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<VueComponent | null> {
    try {
      const tree = this.parser.parse(content);
      if (!tree?.rootNode) return null;

      const componentDefinition = this.findVueComponentDefinition(tree.rootNode);
      if (!componentDefinition) return null;

      const componentName = this.extractComponentName(filePath);

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
          definitionType: componentDefinition.definitionType
        },
      };

      return component;

    } catch (error) {
      logger.error(`Failed to parse Vue component in ${filePath}`, { error });
      return null;
    }
  }

  /**
   * Find Vue component definition in JS/TS files
   */
  private findVueComponentDefinition(node: Parser.SyntaxNode): {
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
            componentDef = this.parseComponentOptions(configNode, 'defineComponent');
            return;
          }
        }
      }

      // Pattern 2: export default { ... } (Options API)
      if (node.type === 'export_default_declaration') {
        const valueNode = node.child(1);
        if (valueNode?.type === 'object') {
          // Check if this looks like a Vue component
          if (this.looksLikeVueComponent(valueNode)) {
            componentDef = this.parseComponentOptions(valueNode, 'optionsAPI');
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
              componentDef = this.parseComponentOptions(configNode, 'globalComponent');
              return;
            }
          }
        }
      }

      // Pattern 4: createApp({ ... }) or new Vue({ ... })
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'createApp' ||
           (functionNode?.type === 'new_expression' && functionNode.child(1)?.text === 'Vue')) {
          const argsNode = node.child(1);
          const configNode = argsNode?.child(1); // First argument
          if (configNode?.type === 'object') {
            componentDef = this.parseComponentOptions(configNode, 'appComponent');
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
  private looksLikeVueComponent(objectNode: Parser.SyntaxNode): boolean {
    const componentProperties = ['data', 'computed', 'methods', 'props', 'emits', 'setup', 'template', 'render'];

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
   * Parse Vue component options object
   */
  private parseComponentOptions(configNode: Parser.SyntaxNode, definitionType: string): {
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
      lifecycle: [] as string[]
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
            result.props = this.parsePropsFromNode(valueNode);
            break;

          case 'emits':
            if (valueNode.type === 'array') {
              result.emits = this.parseEmitsArray(valueNode);
            }
            break;

          case 'setup':
            result.isCompositionAPI = true;
            result.composables = this.extractComposablesFromSetup(valueNode);
            break;

          case 'template':
            result.hasTemplate = true;
            if (valueNode.type === 'string') {
              const templateContent = this.getVueNodeText(valueNode).replace(/['"]/g, '');
              result.templateDependencies = this.extractTemplateDependencies(templateContent);
              result.slots = this.extractSlots(templateContent);
            }
            break;

          case 'methods':
          case 'computed':
            if (valueNode.type === 'object') {
              // Extract method/computed names that might emit events
              const methodNames = this.extractObjectKeys(valueNode);
              // Look for $emit calls in method bodies (simplified)
              // This could be enhanced to actually parse method bodies
            }
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
   * Parse emits array from node
   */
  private parseEmitsArray(arrayNode: Parser.SyntaxNode): string[] {
    const emits: string[] = [];

    for (let i = 0; i < arrayNode.childCount; i++) {
      const child = arrayNode.child(i);
      if (child?.type === 'string') {
        const emitName = this.getVueNodeText(child).replace(/['"]/g, '');
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
  private extractComposablesFromSetup(setupNode: Parser.SyntaxNode): string[] {
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

  // Helper methods

  private isJavaScriptFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.js', '.ts', '.mjs', '.cjs'].includes(ext);
  }

  private isRouterFile(filePath: string, content: string): boolean {
    return filePath.includes('router') && this.containsPattern(content, /createRouter|routes\s*:/);
  }

  private isPiniaStore(filePath: string, content: string): boolean {
    const hasStoreInPath = filePath.includes('store') || filePath.includes('stores') ||
                          filePath.toLowerCase().includes('pinia');
    return hasStoreInPath && this.containsPattern(content, /defineStore/);
  }

  private isComposableFile(filePath: string, content: string): boolean {
    return (
      filePath.includes('composable') ||
      path.basename(filePath).startsWith('use') ||
      this.containsPattern(content, /export\s+(default\s+)?function\s+use[A-Z]/)
    );
  }

  private isVueComponentFile(content: string): boolean {
    return this.containsPattern(content, /defineComponent|createApp|Vue\.component/);
  }

  private kebabToPascal(kebabStr: string): string {
    return kebabStr
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  /**
   * Get chunk boundaries for large files
   */
  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const lines = content.split('\n');
    const boundaries: number[] = [0];
    let currentSize = 0;

    for (let i = 0; i < lines.length; i++) {
      currentSize += lines[i].length + 1; // +1 for newline

      if (currentSize > maxChunkSize) {
        boundaries.push(i);
        currentSize = 0;
      }
    }

    if (boundaries[boundaries.length - 1] !== lines.length - 1) {
      boundaries.push(lines.length - 1);
    }

    return boundaries;
  }

  /**
   * Merge results from multiple chunks
   */
  protected mergeChunkResults(chunks: any[]): any {
    const merged = {
      symbols: [] as any[],
      dependencies: [] as any[],
      imports: [] as any[],
      exports: [] as any[],
      errors: [] as any[]
    };

    for (const chunk of chunks) {
      merged.symbols.push(...chunk.symbols);
      merged.dependencies.push(...chunk.dependencies);
      merged.imports.push(...chunk.imports);
      merged.exports.push(...chunk.exports);
      merged.errors.push(...chunk.errors);
    }

    return merged;
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return ['.vue', '.js', '.ts'];
  }

  /**
   * Extract symbols from AST
   */
  protected extractSymbols(rootNode: any, content: string): any[] {
    const symbols: any[] = [];

    if (!rootNode) return symbols;

    const traverse = (node: any) => {
      // Variable declarations: const title = ref(...) or lexical_declaration containing variable_declarator
      if (node.type === 'variable_declarator') {
        const nameNode = node.child(0);
        const valueNode = node.child(2);

        if (nameNode?.text) {
          // Check if the value is an arrow function
          if (valueNode?.type === 'arrow_function') {
            symbols.push({
              name: nameNode.text,
              symbol_type: 'function',
              start_line: node.startPosition?.row + 1 || 1,
              end_line: node.endPosition?.row + 1 || 1,
              is_exported: false,
              signature: this.getVueNodeText(node)
            });
          } else {
            symbols.push({
              name: nameNode.text,
              symbol_type: 'variable',
              start_line: node.startPosition?.row + 1 || 1,
              end_line: node.endPosition?.row + 1 || 1,
              is_exported: false,
              signature: this.getVueNodeText(node)
            });
          }
        }
      }

      // Function declarations: function increment() {}
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
          symbols.push({
            name: nameNode.text,
            symbol_type: 'function',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node)
          });
        }
      }


      // Interface declarations: interface User {}
      // Handle both proper interface_declaration and ERROR nodes from JS parser on TS
      if (node.type === 'interface_declaration' ||
          (node.type === 'ERROR' && node.text.startsWith('interface '))) {
        let nameNode = null;

        if (node.type === 'interface_declaration') {
          nameNode = node.child(1); // interface keyword, then name
        } else if (node.type === 'ERROR') {
          // Handle ERROR pattern: ERROR { identifier: "interface", identifier: "Name" }
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child?.type === 'identifier' && child.text !== 'interface') {
              nameNode = child;
              break;
            }
          }
        }

        if (nameNode?.text) {
          symbols.push({
            name: nameNode.text,
            symbol_type: 'interface',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node)
          });
        }
      }

      // Type alias declarations: type UserType = ...
      if (node.type === 'type_alias_declaration') {
        const nameNode = node.child(1); // type keyword, then name
        if (nameNode?.text) {
          symbols.push({
            name: nameNode.text,
            symbol_type: 'type_alias',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node)
          });
        }
      }

      // Class declarations: class MyClass {}
      if (node.type === 'class_declaration') {
        const nameNode = node.child(1); // class keyword, then name
        if (nameNode?.text) {
          symbols.push({
            name: nameNode.text,
            symbol_type: 'class',
            start_line: node.startPosition?.row + 1 || 1,
            end_line: node.endPosition?.row + 1 || 1,
            is_exported: false,
            signature: this.getVueNodeText(node)
          });
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

    traverse(rootNode);
    return symbols;
  }

  /**
   * Extract dependencies from AST
   */
  protected extractDependencies(rootNode: any, content: string): any[] {
    // For Vue, dependencies are handled in detectFrameworkEntities
    return [];
  }

  /**
   * Extract imports from AST
   */
  protected extractImports(rootNode: any, content: string): any[] {
    const imports: any[] = [];

    if (!rootNode) return imports;

    const traverse = (node: any) => {
      // Import statements: import { ref, computed } from 'vue'
      if (node.type === 'import_statement') {
        let source = '';
        const importedNames: string[] = [];
        let importType: 'named' | 'default' | 'namespace' | 'side_effect' = 'side_effect';

        // Find source (from 'vue')
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === 'string') {
            // Extract text from string node (includes children: ', string_fragment, ')
            const stringFragment = child.child(1);
            if (stringFragment?.type === 'string_fragment') {
              source = stringFragment.text;
            } else {
              source = child.text.replace(/['"]/g, '');
            }
            break;
          }
        }

        // Find import clause and extract named imports
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);

          if (child?.type === 'import_clause') {
            // Look for named_imports inside import_clause
            for (let j = 0; j < child.childCount; j++) {
              const clauseChild = child.child(j);
              if (clauseChild?.type === 'named_imports') {
                importType = 'named';

                // Extract import specifiers from named_imports
                for (let k = 0; k < clauseChild.childCount; k++) {
                  const specChild = clauseChild.child(k);
                  if (specChild?.type === 'import_specifier') {
                    // Get identifier from import_specifier
                    for (let l = 0; l < specChild.childCount; l++) {
                      const identChild = specChild.child(l);
                      if (identChild?.type === 'identifier') {
                        importedNames.push(identChild.text);
                      }
                    }
                  }
                }
              } else if (clauseChild?.type === 'namespace_import') {
                importType = 'namespace';
                // Namespace import: * as Vue
                const asNode = clauseChild.child(2);
                if (asNode?.text) {
                  importedNames.push(asNode.text);
                }
              } else if (clauseChild?.type === 'identifier') {
                importType = 'default';
                // Default import: import Vue
                importedNames.push(clauseChild.text);
              }
            }
          }
        }

        if (source) {
          imports.push({
            source,
            imported_names: importedNames,
            import_type: importType,
            line_number: node.startPosition?.row + 1 || 1,
            is_dynamic: false
          });
        }
      }

      // Dynamic imports: import('vue')
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);
        if (functionNode?.text === 'import') {
          const argsNode = node.child(1);
          const sourceArg = argsNode?.child(1);
          if (sourceArg?.type === 'string') {
            const source = sourceArg.text.replace(/['"]/g, '');
            imports.push({
              source,
              imported_names: [],
              import_type: 'side_effect',
              line_number: node.startPosition?.row + 1 || 1,
              is_dynamic: true
            });
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

    traverse(rootNode);
    return imports;
  }

  /**
   * Extract exports from AST
   */
  protected extractExports(rootNode: any, content: string): any[] {
    // For Vue, exports are handled in detectFrameworkEntities
    return [];
  }

  // Missing helper methods for enhanced Vue parser functionality

  /**
   * Extract SFC sections from Vue file
   */
  private extractSFCSections(content: string): {
    template?: string;
    script?: string;
    scriptSetup?: string;
    style?: string;
    styleScoped?: boolean;
    scriptLang?: string;
  } {
    const sections: any = {};

    // Extract template (use greedy match to handle nested template tags in scoped slots)
    const templateMatch = content.match(/<template[^>]*>([\s\S]*)<\/template>/);
    if (templateMatch) {
      sections.template = templateMatch[1];
    }

    // Extract script setup
    const scriptSetupMatch = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    if (scriptSetupMatch) {
      sections.scriptSetup = scriptSetupMatch[1];
    }

    // Extract regular script
    const scriptMatch = content.match(/<script(?!\s+setup)[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      sections.script = scriptMatch[1];
    }

    // Extract script language
    const scriptLangMatch = content.match(/<script[^>]*\s+lang=["']([^"']+)["']/);
    if (scriptLangMatch) {
      sections.scriptLang = scriptLangMatch[1];
    }

    // Extract style
    const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    if (styleMatch) {
      sections.style = styleMatch[1];
      sections.styleScoped = /<style[^>]*\s+scoped/.test(content);
    }

    return sections;
  }

  /**
   * Extract teleport targets
   */
  private extractTeleportTargets(template: string): string[] {
    const targets: string[] = [];
    const regex = /<(?:Teleport|teleport)[^>]+to=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      if (!targets.includes(match[1])) {
        targets.push(match[1]);
      }
    }
    return targets;
  }

  /**
   * Extract transition names
   */
  private extractTransitionNames(template: string): string[] {
    const names: string[] = [];
    const regex = /<(?:Transition|transition|TransitionGroup)[^>]+name=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      if (!names.includes(match[1])) {
        names.push(match[1]);
      }
    }
    return names;
  }


  /**
   * Extract CSS Modules classes
   */
  private extractCSSModules(content: string): string[] {
    const classes: string[] = [];

    // Extract from template usage: $style.className
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (templateMatch) {
      const template = templateMatch[1];
      const regex = /\$style\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(template)) !== null) {
        if (!classes.includes(match[1])) {
          classes.push(match[1]);
        }
      }
    }

    // Extract from style module section
    const styleModuleMatch = content.match(/<style\s+module[^>]*>([\s\S]*?)<\/style>/);
    if (styleModuleMatch) {
      const styles = styleModuleMatch[1];
      const regex = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*{/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(styles)) !== null) {
        if (!classes.includes(match[1])) {
          classes.push(match[1]);
        }
      }
    }

    return classes;
  }

  /**
   * Extract CSS preprocessors
   */
  private extractPreprocessors(content: string): string[] {
    const preprocessors: string[] = [];
    const styleMatches = content.match(/<style[^>]*>/g);

    if (styleMatches) {
      for (const styleTag of styleMatches) {
        const langMatch = styleTag.match(/lang=["']([^"']+)["']/);
        if (langMatch) {
          const lang = langMatch[1];
          if (['scss', 'sass', 'less', 'stylus'].includes(lang) && !preprocessors.includes(lang)) {
            preprocessors.push(lang);
          }
        }
      }
    }

    return preprocessors;
  }

  /**
   * Extract CSS variables
   */
  private extractCSSVariables(content: string): string[] {
    const variables: string[] = [];

    // Extract CSS custom properties
    const cssVarRegex = /--([a-zA-Z-][a-zA-Z0-9-]*)/g;
    let match: RegExpExecArray | null;
    while ((match = cssVarRegex.exec(content)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }

    // Extract SCSS/SASS variables
    const sassVarRegex = /\$([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
    while ((match = sassVarRegex.exec(content)) !== null) {
      if (!variables.includes(`$${match[1]}`)) {
        variables.push(`$${match[1]}`);
      }
    }

    // Extract Less variables
    const lessVarRegex = /@import/g;
    if (lessVarRegex.test(content)) {
      variables.push('@import');
    }

    return variables;
  }

  /**
   * Check if content has dynamic styling
   */
  private hasDynamicStyling(content: string): boolean {
    return /:style=/.test(content) || /:class=/.test(content);
  }

  /**
   * Extract dynamic style variables
   */
  private extractDynamicStyleVariables(content: string): string[] {
    const variables: string[] = [];

    // Extract variables from :style and :class bindings
    const styleRegex = /:(?:style|class)=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = styleRegex.exec(content)) !== null) {
      // Simple variable extraction - could be enhanced
      const varMatches = match[1].match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g);
      if (varMatches) {
        for (const varMatch of varMatches) {
          if (!variables.includes(varMatch) && !['true', 'false', 'null', 'undefined'].includes(varMatch)) {
            variables.push(varMatch);
          }
        }
      }
    }

    return variables;
  }

  /**
   * Extract TypeScript utility types
   */
  private extractUtilityTypes(content: string): string[] {
    const utilityTypes: string[] = [];
    const regex = /\b(Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|Parameters|ConstructorParameters|ReturnType|InstanceType|ThisParameterType|OmitThisParameter|ThisType|Uppercase|Lowercase|Capitalize|Uncapitalize|Array|Promise)\b/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (!utilityTypes.includes(match[1])) {
        utilityTypes.push(match[1]);
      }
    }

    return utilityTypes;
  }

  /**
   * Extract generic functions
   */
  private extractGenericFunctions(content: string): string[] {
    const functions: string[] = [];
    const regex = /(?:function\s+(\w+)\s*<[^>]+>|const\s+(\w+)\s*=\s*<[^>]+>)/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const funcName = match[1] || match[2];
      if (funcName && !functions.includes(funcName)) {
        functions.push(funcName);
      }
    }

    return functions;
  }

  /**
   * Check if content has utility types
   */
  private hasUtilityTypes(content: string): boolean {
    return /\b(Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|Parameters|ConstructorParameters|ReturnType|InstanceType|Array|Promise)</.test(content);
  }
}