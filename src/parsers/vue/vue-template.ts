import Parser from 'tree-sitter';
import { ParsedDependency, ParsedSymbol } from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { DependencyType, SymbolType } from '../../database/models';
import { createComponentLogger } from '../../utils/logger';
import { entityClassifier } from '../../utils/entity-classifier';
import { kebabToPascal, getLineFromIndex, isJavaScriptKeyword } from './vue-utils';

const logger = createComponentLogger('vue-template');

export function extractTemplateDependencies(templateContent: string): string[] {
  const dependencies: string[] = [];

  // Match custom component tags (PascalCase or kebab-case)
  const componentRegex = /<(?:([A-Z][a-zA-Z0-9]*)|([a-z][a-z0-9]*(?:-[a-z0-9]+)+))(?:\s|>|\/)/g;

  let match: RegExpExecArray | null;
  while ((match = componentRegex.exec(templateContent)) !== null) {
    const componentName = match[1] || kebabToPascal(match[2]);
    if (componentName && !dependencies.includes(componentName)) {
      dependencies.push(componentName);
    }
  }

  return dependencies;
}

export function extractBuiltInComponents(templateContent: string): string[] {
  const builtInComponents: string[] = [];
  const builtIns = ['Teleport', 'Suspense', 'KeepAlive', 'Transition', 'TransitionGroup'];

  for (const component of builtIns) {
    const regex = new RegExp(`<${component}[\\s>]`, 'g');
    if (regex.test(templateContent)) {
      builtInComponents.push(component);
      // Also add kebab-case version for compatibility
      const kebabCase = component
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2') // Handle consecutive capitals
        .replace(/([a-z])([A-Z])/g, '$1-$2') // Handle normal camelCase
        .toLowerCase();
      builtInComponents.push(kebabCase);
    }
  }

  return [...new Set(builtInComponents)];
}

export function extractDirectives(templateContent: string): Array<{
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

  const builtInDirectives = [
    'if',
    'else',
    'else-if',
    'show',
    'for',
    'on',
    'bind',
    'model',
    'slot',
    'pre',
    'cloak',
    'once',
    'memo',
    'text',
    'html',
  ];

  // Match directives: v-directive:argument.modifier1.modifier2="value"
  const directiveRegex =
    /v-([a-zA-Z][a-zA-Z0-9-]*)(?::([a-zA-Z][a-zA-Z0-9-]*))?(?:\.([a-zA-Z0-9.-]+))?/g;

  let match: RegExpExecArray | null;
  while ((match = directiveRegex.exec(templateContent)) !== null) {
    const directiveName = match[1];
    const argument = match[2];
    const modifiers = match[3] ? match[3].split('.') : [];

    const type: 'built-in' | 'custom' = builtInDirectives.includes(directiveName)
      ? 'built-in'
      : 'custom';

    const directive = {
      name: directiveName,
      type,
      modifiers,
      ...(argument && { arguments: argument }),
    };

    // Avoid duplicates
    const exists = directives.some(
      d =>
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

export function extractScopedSlots(templateContent: string): Array<{
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
  const scopedSlotRegex =
    /<template\s+(?:#([a-zA-Z][a-zA-Z0-9-]*)|v-slot:([a-zA-Z][a-zA-Z0-9-]*))="?\{\s*([^}]*)\s*\}"?/g;

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
      props,
    });
  }

  return scopedSlots;
}

export function extractTemplateRefs(templateContent: string): string[] {
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

export function extractEventHandlers(templateContent: string): Array<{
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
  const eventRegex =
    /(?:@([a-zA-Z][a-zA-Z0-9-]*)|v-on:([a-zA-Z][a-zA-Z0-9-]*))(?:\.([a-zA-Z0-9.-]+))?="([^"]+)"/g;

  let match: RegExpExecArray | null;
  while ((match = eventRegex.exec(templateContent)) !== null) {
    const event = match[1] || match[2];
    const modifiers = match[3] ? match[3].split('.') : [];
    const handler = match[4];

    handlers.push({
      event,
      handler,
      modifiers,
    });
  }

  return handlers;
}

export function convertTemplateHandlersToDependencies(
  templateContent: string,
  componentName: string,
  filePath: string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];
  const eventHandlers = extractEventHandlers(templateContent);

  for (const handler of eventHandlers) {
    const handlerName = handler.handler.trim();

    // Skip inline expressions like "count++" or "doSomething(arg)"
    // Only process simple handler names like "onMonthRangeChanged"
    if (handlerName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(handlerName)) {
      dependencies.push({
        from_symbol: componentName,
        to_symbol: handlerName,
        dependency_type: DependencyType.CALLS,
        line_number: 1, // Template line numbers not tracked by regex
        qualified_context: `${componentName} template @${handler.event}`,
      });
    }
  }

  return dependencies;
}

export function convertTemplateComponentsToDependencies(
  templateContent: string,
  componentName: string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];
  const templateDependencies = extractTemplateDependencies(templateContent);

  for (const usedComponent of templateDependencies) {
    dependencies.push({
      from_symbol: componentName,
      to_symbol: usedComponent,
      dependency_type: DependencyType.REFERENCES,
      line_number: 1, // Template line numbers not precisely tracked by regex
      qualified_context: `${componentName} template uses ${usedComponent}`,
    });
  }

  return dependencies;
}

export function extractSlots(templateContent: string): string[] {
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

export function extractTemplateSymbols(
  template: string,
  filePath?: string,
  options?: FrameworkParseOptions
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  if (!template) {
    return symbols;
  }

  try {
    // NOTE: Component tags like <GoogleMap> are NOT extracted as symbols here.
    // Component usage creates dependency edges via convertTemplateComponentsToDependencies().
    // Actual component symbols come from script imports/definitions.

    // Extract template refs
    const refRegex = /ref=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(template)) !== null) {
      const refName = match[1];

      const classification = entityClassifier.classify(
        'variable',
        refName,
        [],
        filePath || '',
        'vue',
        undefined,
        options?.repositoryFrameworks
      );

      symbols.push({
        name: refName,
        symbol_type: SymbolType.VARIABLE,
        entity_type: classification.entityType,
        framework: 'vue',
        base_class: classification.baseClass || undefined,
        start_line: getLineFromIndex(template, match.index),
        end_line: getLineFromIndex(template, match.index),
        is_exported: false,
        signature: `ref="${refName}"`,
      });
    }

    // Extract v-model variables
    const vModelRegex = /v-model=["']([^"']+)["']/g;
    while ((match = vModelRegex.exec(template)) !== null) {
      const varName = match[1];

      const classification = entityClassifier.classify(
        'variable',
        varName,
        [],
        filePath || '',
        'vue',
        undefined,
        options?.repositoryFrameworks
      );

      symbols.push({
        name: varName,
        symbol_type: SymbolType.VARIABLE,
        entity_type: classification.entityType,
        framework: 'vue',
        base_class: classification.baseClass || undefined,
        start_line: getLineFromIndex(template, match.index),
        end_line: getLineFromIndex(template, match.index),
        is_exported: false,
        signature: `v-model="${varName}"`,
      });
    }

    // Extract interpolated variables {{ variable }}
    const interpolationRegex = /\{\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\}\}/g;
    while ((match = interpolationRegex.exec(template)) !== null) {
      const varName = match[1];
      if (!isJavaScriptKeyword(varName)) {
        const classification = entityClassifier.classify(
          'variable',
          varName,
          [],
          filePath || '',
          'vue',
          undefined,
          options?.repositoryFrameworks
        );

        symbols.push({
          name: varName,
          symbol_type: SymbolType.VARIABLE,
          entity_type: classification.entityType,
          framework: 'vue',
          base_class: classification.baseClass || undefined,
          start_line: getLineFromIndex(template, match.index),
          end_line: getLineFromIndex(template, match.index),
          is_exported: false,
          signature: `{{ ${varName} }}`,
        });
      }
    }
  } catch (error) {
    logger.warn(`Error extracting template symbols: ${error}`);
  }

  return symbols;
}

export function extractTeleportTargets(template: string): string[] {
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

export function extractTransitionNames(template: string): string[] {
  const names: string[] = [];
  const regex = /<(?:Transition|transition)[^>]+name=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}
