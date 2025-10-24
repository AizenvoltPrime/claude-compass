import Parser from 'tree-sitter';

export function extractVitePatterns(content: string): {
  globImports: string[];
  envVariables: string[];
  hotReload: boolean;
} {
  const result = {
    globImports: [] as string[],
    envVariables: [] as string[],
    hotReload: false,
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

export function extractStylingFeatures(content: string): {
  cssModules: boolean;
  scopedStyles: boolean;
  cssVariables: string[];
  preprocessor?: string;
} {
  const result = {
    cssModules: false,
    scopedStyles: false,
    cssVariables: [] as string[],
    preprocessor: undefined as string | undefined,
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

export function extractTestingPatterns(filePath: string): {
  isTestFile: boolean;
  isStoryFile: boolean;
  testUtils: string[];
  testFramework?: string;
} {
  const result = {
    isTestFile: false,
    isStoryFile: false,
    testUtils: [] as string[],
    testFramework: undefined as string | undefined,
  };

  // Check if it's a test file
  result.isTestFile = /\.(test|spec)\.(js|ts|jsx|tsx)$/.test(filePath);

  // Check if it's a Storybook story
  result.isStoryFile = /\.stories\.(js|ts|jsx|tsx)$/.test(filePath);

  return result;
}

export function extractTypeScriptFeatures(
  content: string,
  tree: any
): {
  interfaces: Array<{ name: string; properties: string[] }>;
  types: Array<{ name: string; definition: string }>;
  generics: string[];
  imports: Array<{ name: string; isTypeOnly: boolean; source: string }>;
} {
  const result = {
    interfaces: [] as Array<{ name: string; properties: string[] }>,
    types: [] as Array<{ name: string; definition: string }>,
    generics: [] as string[],
    imports: [] as Array<{ name: string; isTypeOnly: boolean; source: string }>,
  };

  if (!tree?.rootNode) return result;

  const traverse = (node: Parser.SyntaxNode) => {
    // Extract TypeScript interfaces
    if (node.type === 'interface_declaration') {
      const nameNode = node.child(1);
      const interfaceName = nameNode?.text;
      if (interfaceName) {
        const properties = extractInterfaceProperties(node);
        result.interfaces.push({
          name: interfaceName,
          properties,
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
          definition,
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
    if (node.type === 'import_statement' && node.text) {
      const hasTypeKeyword = node.text.includes('import type');
      const sourceMatch = node.text.match(/from\s+['"`]([^'"`]+)['"`]/);
      const source = sourceMatch ? sourceMatch[1] : '';

      if (hasTypeKeyword && source) {
        // Extract imported type names
        const importNames = extractImportNames(node);
        for (const name of importNames) {
          result.imports.push({
            name,
            isTypeOnly: true,
            source,
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

export function extractInterfaceProperties(interfaceNode: Parser.SyntaxNode): string[] {
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

export function extractImportNames(importNode: Parser.SyntaxNode): string[] {
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

export function extractCSSModules(content: string): string[] {
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

export function extractPreprocessors(content: string): string[] {
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

export function hasDynamicStyling(content: string): boolean {
  return /:style=/.test(content) || /:class=/.test(content);
}

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

export function extractUtilityTypes(content: string): string[] {
  const utilityTypes: string[] = [];
  const regex =
    /\b(Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|Parameters|ConstructorParameters|ReturnType|InstanceType|ThisParameterType|OmitThisParameter|ThisType|Uppercase|Lowercase|Capitalize|Uncapitalize|Array|Promise)\b/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (!utilityTypes.includes(match[1])) {
      utilityTypes.push(match[1]);
    }
  }

  return utilityTypes;
}

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

export function hasUtilityTypes(content: string): boolean {
  return /\b(Partial|Required|Readonly|Record|Pick|Omit|Exclude|Extract|NonNullable|Parameters|ConstructorParameters|ReturnType|InstanceType|Array|Promise)</.test(
    content
  );
}
