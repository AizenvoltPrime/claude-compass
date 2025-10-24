import { SyntaxNode } from 'tree-sitter';
import { ValidationRule } from './types';
import {
  findMethodByName,
  findReturnStatement,
  findChildByType,
  extractLaravelStringLiteral,
} from './ast-helpers';

export function parseFormRequestValidation(
  content: string,
  filePath: string,
  rootNode: SyntaxNode,
  logger: any
): ValidationRule[] {
  const validationRules: ValidationRule[] = [];

  try {
    const rulesMethod = findMethodByName(rootNode, 'rules');
    if (!rulesMethod) return validationRules;

    const returnStatement = findReturnStatement(rulesMethod);
    if (!returnStatement) return validationRules;

    const arrayNode = findChildByType(returnStatement, 'array_creation_expression');
    if (!arrayNode) return validationRules;

    const rules = parseValidationArray(arrayNode, content);
    validationRules.push(...rules);
  } catch (error) {
    logger.warn(`Failed to parse FormRequest validation from ${filePath}`, { error });
  }

  return validationRules;
}

export function parseValidationArray(arrayNode: SyntaxNode, content: string): ValidationRule[] {
  const rules: ValidationRule[] = [];

  const elements = arrayNode.children.filter(n => n.type === 'array_element_initializer');

  for (const element of elements) {
    const key = extractArrayKey(element, content);
    if (!key) continue;

    const valueNode = extractArrayValueNode(element);
    if (!valueNode) continue;

    const rulesList = parseRuleValue(valueNode, content);

    rules.push({
      field: key,
      rules: rulesList,
      typeScriptEquivalent: inferTypeScriptType(rulesList),
      required: rulesList.includes('required'),
      nullable: rulesList.includes('nullable'),
    });
  }

  return rules;
}

export function extractArrayKey(elementNode: SyntaxNode, content: string): string | null {
  for (const child of elementNode.children) {
    if (child.type === 'string') {
      return extractLaravelStringLiteral(child, content);
    }
  }
  return null;
}

export function extractArrayValueNode(elementNode: SyntaxNode): SyntaxNode | null {
  let foundArrow = false;
  for (const child of elementNode.children) {
    if (child.type === '=>') {
      foundArrow = true;
      continue;
    }
    if (foundArrow && (child.type === 'string' || child.type === 'array_creation_expression')) {
      return child;
    }
  }
  return null;
}

export function parseRuleValue(valueNode: SyntaxNode, content: string): string[] {
  if (valueNode.type === 'string') {
    const ruleString = extractLaravelStringLiteral(valueNode, content);
    return ruleString.split('|').map(r => r.trim()).filter(r => r.length > 0);
  }

  if (valueNode.type === 'array_creation_expression') {
    return extractRulesFromArray(valueNode, content);
  }

  return [];
}

export function extractRulesFromArray(arrayNode: SyntaxNode, content: string): string[] {
  const rules: string[] = [];

  const elements = arrayNode.children.filter(n => n.type === 'array_element_initializer');

  for (const element of elements) {
    for (const child of element.children) {
      if (child.type === 'string') {
        rules.push(extractLaravelStringLiteral(child, content));
      } else if (child.type === 'scoped_call_expression') {
        const ruleName = extractRuleFacadeCall(child, content);
        rules.push(ruleName);
      } else if (child.type === 'object_creation_expression') {
        const className = extractClassNameFromCreation(child, content);
        if (className) rules.push(className);
      }
    }
  }

  return rules;
}

export function extractRuleFacadeCall(node: SyntaxNode, content: string): string {
  const methodNode = node.childForFieldName('name');
  return methodNode?.text || 'custom';
}

export function extractClassNameFromCreation(node: SyntaxNode, content: string): string | null {
  for (const child of node.children) {
    if (child.type === 'name' || child.type === 'qualified_name') {
      return child.text;
    }
  }
  return null;
}

export function inferTypeScriptType(rules: string[]): string {
  if (rules.some(r => r.startsWith('numeric') || r.startsWith('integer'))) {
    return 'number';
  }
  if (rules.some(r => r.startsWith('boolean'))) {
    return 'boolean';
  }
  if (rules.some(r => r.startsWith('array'))) {
    return 'any[]';
  }
  return 'string';
}

export function findValidationCalls(methodNode: SyntaxNode): SyntaxNode[] {
  const calls: SyntaxNode[] = [];
  const validationMethods = ['validate', 'validateWithBag', 'validateNested', 'safe', 'validated'];

  const traverse = (node: SyntaxNode): void => {
    if (node.type === 'member_call_expression') {
      const methodName = node.childForFieldName('name');
      if (methodName && validationMethods.includes(methodName.text)) {
        calls.push(node);
      }
    }

    for (const child of node.children) {
      traverse(child);
    }
  };

  const body = methodNode.childForFieldName('body');
  if (body) traverse(body);

  return calls;
}

export function extractRequestValidation(
  methodNode: SyntaxNode,
  content: string,
  logger: any
): ValidationRule[] {
  const validationRules: ValidationRule[] = [];
  const methodText = content.substring(methodNode.startIndex, methodNode.endIndex);

  try {
    const formRequestPattern = /(\w+Request)\s+\$\w+/g;
    let match;

    while ((match = formRequestPattern.exec(methodText)) !== null) {
      const requestClass = match[1];
      validationRules.push({
        field: 'placeholder',
        rules: ['required'],
        typeScriptEquivalent: 'string',
        required: true,
        nullable: false,
      });
    }

    const validateCalls = findValidationCalls(methodNode);
    for (const callNode of validateCalls) {
      const args = callNode.childForFieldName('arguments');
      if (!args) continue;

      const arrayArg = findChildByType(args, 'array_creation_expression');
      if (arrayArg) {
        const rules = parseValidationArray(arrayArg, content);
        validationRules.push(...rules);
      }
    }
  } catch (error) {
    logger.warn(`Failed to extract request validation`, { error });
  }

  return validationRules;
}

export function mapLaravelRulesToTypeScript(rules: string[]): string {
  if (rules.includes('nullable')) {
    const baseType = getBaseTypeFromRules(rules.filter(r => r !== 'nullable'));
    return `${baseType} | null`;
  }

  return getBaseTypeFromRules(rules);
}

export function getBaseTypeFromRules(rules: string[]): string {
  for (const rule of rules) {
    if (rule === 'string' || rule.startsWith('max:') || rule.startsWith('min:')) {
      return 'string';
    }
    if (rule === 'integer' || rule === 'numeric') {
      return 'number';
    }
    if (rule === 'boolean') {
      return 'boolean';
    }
    if (rule === 'array') {
      return 'array';
    }
    if (rule === 'email') {
      return 'string';
    }
    if (rule === 'date' || rule === 'datetime') {
      return 'string';
    }
  }

  return 'any';
}
