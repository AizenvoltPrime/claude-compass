import Parser from 'tree-sitter';
import * as path from 'path';

export interface SFCSections {
  template?: string;
  script?: string;
  scriptSetup?: string;
  style?: string;
  styleScoped?: boolean;
  styleModules?: boolean;
  styleLang?: string;
  scriptLang?: string;
}

export function extractSFCSections(content: string): SFCSections {
  const sections: SFCSections = {};

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
    sections.styleModules = /<style\s+module/.test(content);
  }

  // Extract style language
  const styleLangMatch = content.match(/<style\s+[^>]*lang=["']([^"']+)["']/);
  if (styleLangMatch) {
    sections.styleLang = styleLangMatch[1];
  }

  return sections;
}

export function extractStringValue(node: Parser.SyntaxNode, content: string): string {
  if (node.type === 'string' || node.type === 'template_string') {
    const text = node.text;
    if (text.startsWith('`') && text.endsWith('`')) {
      return text.slice(1, -1);
    }
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text.slice(1, -1);
    }
    return text;
  }
  return '';
}

export function extractStringLiteral(node: Parser.SyntaxNode | null | undefined): string | null {
  if (!node) return null;

  if (node.type === 'string') {
    const text = node.text;
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text.slice(1, -1);
    }
    return text;
  }

  if (node.type === 'template_string') {
    const text = node.text;
    if (text.startsWith('`') && text.endsWith('`')) {
      return text.slice(1, -1);
    }
    return text;
  }

  if (node.type === 'literal_type') {
    const stringChild = node.child(0);
    if (stringChild && stringChild.type === 'string') {
      return extractStringLiteral(stringChild);
    }
  }

  return null;
}

export function isValidApiUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  if (!url.startsWith('/') && !url.startsWith('http')) {
    return false;
  }

  if (url.includes('.') && !url.includes('://')) {
    return false;
  }

  if (url.includes('(') || url.includes(')')) {
    return false;
  }

  const singleWordPattern = /^[a-z]+$/;
  if (singleWordPattern.test(url)) {
    return false;
  }

  return true;
}

export function findObjectProperty(
  objectNode: Parser.SyntaxNode,
  propertyName: string
): Parser.SyntaxNode | null {
  for (let i = 0; i < objectNode.childCount; i++) {
    const child = objectNode.child(i);
    if (child && child.type === 'pair') {
      const keyNode = child.child(0);
      if (keyNode && keyNode.text.includes(propertyName)) {
        return child.child(2); // Return value node
      }
    }
  }
  return null;
}

export function inferTypeFromExpression(node: Parser.SyntaxNode, content: string): string | undefined {
  if (node.type === 'object_expression') {
    return 'object';
  }
  if (node.type === 'array_expression') {
    return 'array';
  }
  if (node.type === 'string' || node.type === 'template_string') {
    return 'string';
  }
  return undefined;
}

export function extractUrlFromFunction(functionNode: Parser.SyntaxNode, content: string): string {
  const body = functionNode.childForFieldName('body');
  if (body) {
    return extractStringValue(body, content);
  }
  return '';
}

export function extractGenericType(callNode: Parser.SyntaxNode, content: string): string | undefined {
  const typeArgs = callNode.childForFieldName('type_arguments');
  if (typeArgs && typeArgs.childCount > 0) {
    const firstType = typeArgs.child(1); // Skip opening bracket
    if (firstType) {
      return firstType.text;
    }
  }
  return undefined;
}

export function getLineFromIndex(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

export function isJavaScriptKeyword(word: string): boolean {
  const keywords = new Set([
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'try',
    'catch',
    'finally',
    'throw',
    'new',
    'this',
    'typeof',
    'instanceof',
    'in',
    'of',
    'true',
    'false',
    'null',
    'undefined',
    'void',
    'delete',
    'class',
    'extends',
    'super',
    'static',
  ]);

  return keywords.has(word);
}

export function isJavaScriptFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  return ['.js', '.ts', '.mjs', '.cjs'].includes(ext);
}

export function isRouterFile(filePath: string, content: string): boolean {
  return filePath.includes('router') && /createRouter|routes\s*:/.test(content);
}

export function isPiniaStore(filePath: string, content: string): boolean {
  const hasStoreInPath =
    filePath.includes('store') ||
    filePath.includes('stores') ||
    filePath.toLowerCase().includes('pinia');
  return hasStoreInPath && /defineStore/.test(content);
}

export function isComposableFile(filePath: string, content: string): boolean {
  return (
    filePath.includes('composable') ||
    path.basename(filePath).startsWith('use') ||
    /export\s+(default\s+)?function\s+use[A-Z]/.test(content)
  );
}

export function isVueComponentFile(content: string): boolean {
  return /defineComponent|createApp|Vue\.component/.test(content);
}

export function kebabToPascal(kebabStr: string): string {
  return kebabStr
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function findParent(node: Parser.SyntaxNode, parentType: string): Parser.SyntaxNode | null {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === parentType) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

export function parseObjectToJson(node: Parser.SyntaxNode): any {
  if (node.type === 'object' || node.type === 'object_expression') {
    const obj: any = {};
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'pair') {
        const keyNode = child.child(0);
        const valueNode = child.child(2);
        if (keyNode && valueNode) {
          const key = extractStringLiteral(keyNode) || keyNode.text;
          obj[key] = parseObjectToJson(valueNode);
        }
      }
    }
    return obj;
  } else if (node.type === 'array' || node.type === 'array_expression') {
    const arr: any[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type !== ',' && child.type !== '[' && child.type !== ']') {
        arr.push(parseObjectToJson(child));
      }
    }
    return arr;
  } else if (node.type === 'string' || node.type === 'template_string') {
    return extractStringValue(node, '');
  } else if (node.type === 'number') {
    return parseFloat(node.text);
  } else if (node.type === 'true') {
    return true;
  } else if (node.type === 'false') {
    return false;
  } else if (node.type === 'null') {
    return null;
  }
  return node.text;
}

export function extractObjectKeys(objectNode: Parser.SyntaxNode): string[] {
  const keys: string[] = [];

  for (let i = 0; i < objectNode.childCount; i++) {
    const child = objectNode.child(i);
    if (child && child.type === 'pair') {
      const keyNode = child.child(0);
      if (keyNode) {
        const key = extractStringLiteral(keyNode) || keyNode.text;
        keys.push(key);
      }
    } else if (child && child.type === 'shorthand_property_identifier') {
      keys.push(child.text);
    } else if (child && child.type === 'shorthand_property_identifier_pattern') {
      keys.push(child.text);
    }
  }

  return keys;
}

export function findPropertyInObject(objectNode: Parser.SyntaxNode, propertyName: string): string | null {
  for (let i = 0; i < objectNode.childCount; i++) {
    const child = objectNode.child(i);
    if (child && child.type === 'pair') {
      const keyNode = child.child(0);
      const key = extractStringLiteral(keyNode) || keyNode?.text;

      if (key === propertyName) {
        const valueNode = child.child(2);
        if (valueNode) {
          return extractStringLiteral(valueNode) || valueNode.text;
        }
      }
    }
  }
  return null;
}

export function findReturnValue(functionNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
  const traverse = (node: Parser.SyntaxNode): Parser.SyntaxNode | null => {
    if (node.type === 'return_statement') {
      const returnValue = node.child(1);
      if (returnValue && (returnValue.type === 'object' || returnValue.type === 'object_expression')) {
        return returnValue;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const result = traverse(child);
        if (result) {
          return result;
        }
      }
    }

    return null;
  };

  return traverse(functionNode);
}

export function normalizeTypeName(rawType: string): string | null {
  if (!rawType) {
    return null;
  }

  const cleaned = rawType.trim();

  // Filter out common non-state types
  const exclusions = [
    'void',
    'Promise',
    'any',
    'unknown',
    'never',
    'ComputedRef',
    'Ref',
    'WatchStopHandle',
    'EffectScope',
  ];

  if (exclusions.some(ex => cleaned.startsWith(ex))) {
    return null;
  }

  // Extract generic parameter if present (e.g., Ref<User> → User)
  const genericMatch = cleaned.match(/^[A-Za-z]+<(.+)>$/);
  if (genericMatch) {
    return genericMatch[1].trim();
  }

  return cleaned;
}
