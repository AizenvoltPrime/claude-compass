// Type definitions
export * from './vue-types';

// Utility functions
export * from './vue-utils';

// Template analysis
export * from './vue-template';

// Props and emits extraction
export * from './vue-props-emits';

// Feature extractors
export * from './vue-features';

// API calls parsing
export * from './vue-api-calls';

// Composables parsing
export * from './vue-composables';

// Router parsing
export * from './vue-router';

// Pinia stores parsing
export * from './vue-stores';

// AST single-pass extraction
export { performVueSinglePassExtraction } from './vue-ast-single-pass';

// SFC entity builder
export { buildVueSFCEntity } from './vue-sfc-entity-builder';

// Options API parsing (export only functions not in vue-props-emits or vue-template)
export {
  parseVueComponent,
  findVueComponentDefinition,
  looksLikeVueComponent,
  parseComponentOptions,
  extractComposablesFromSetup,
} from './vue-options-parser';
