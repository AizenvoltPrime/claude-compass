/**
 * Extract CSS variables from Vue component content
 */
export function extractCSSVariables(content: string): string[] {
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
export function hasDynamicStyling(content: string): boolean {
  return /:style=/.test(content) || /:class=/.test(content);
}

/**
 * Extract dynamic style variables
 */
export function extractDynamicStyleVariables(content: string): string[] {
  const variables: string[] = [];

  // Extract variables from :style and :class bindings
  const styleRegex = /:(?:style|class)=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = styleRegex.exec(content)) !== null) {
    // Simple variable extraction - could be enhanced
    const varMatches = match[1].match(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g);
    if (varMatches) {
      for (const varMatch of varMatches) {
        if (
          !variables.includes(varMatch) &&
          !['true', 'false', 'null', 'undefined'].includes(varMatch)
        ) {
          variables.push(varMatch);
        }
      }
    }
  }

  return variables;
}

/**
 * Extract teleport targets
 */
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

/**
 * Extract transition names
 */
export function extractTransitionNames(template: string): string[] {
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
 * Extract generic functions
 */
export function extractGenericFunctions(content: string): string[] {
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
