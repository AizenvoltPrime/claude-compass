import { SyntaxNode } from 'tree-sitter';
import { EloquentModel } from './types';
import {
  traverseNode,
  getClassName,
  getMethodName,
} from './ast-helpers';

const logger = console; // TODO: Use proper logger

export async function extractEloquentModels(
  content: string,
  filePath: string,
  rootNode: SyntaxNode
): Promise<EloquentModel[]> {
  const models: EloquentModel[] = [];

  if (!isModelFile(filePath, content)) {
    return models;
  }

  try {
    traverseNode(rootNode, node => {
      if (node.type === 'class_declaration' && extendsModel(content, node)) {
        const model = parseModel(node, filePath, content);
        if (model) {
          models.push(model);
        }
      }
    });
  } catch (error) {
    logger.error(`Model extraction failed for ${filePath}`, { error: error.message });
  }

  return models;
}

export function isModelFile(filePath: string, content: string): boolean {
  return (
    filePath.includes('/app/Models/') ||
    (filePath.includes('/app/') &&
      (content.includes('extends Model') ||
        content.includes('extends Authenticatable') ||
        content.includes('extends Pivot') ||
        content.includes('extends User') ||
        content.includes('use Authenticatable') ||
        content.includes('use HasFactory')))
  );
}

export function extendsModel(content: string, node: SyntaxNode): boolean {
  const className = getClassName(node, content);
  if (!className) return false;

  // Laravel model base classes
  const modelBaseClasses = [
    'Model',
    'Authenticatable',
    'Pivot',
    'User', // Legacy Laravel user model pattern
  ];

  for (const baseClass of modelBaseClasses) {
    const modelPattern = new RegExp(`class\\s+${className}\\s+extends\\s+${baseClass}`);
    if (modelPattern.test(content)) {
      return true;
    }
  }

  // Check for traits that indicate a model
  if (
    content.includes(`class ${className}`) &&
    (content.includes('use Authenticatable') ||
      content.includes('use HasFactory') ||
      content.includes('use Notifiable') ||
      content.includes('protected $fillable') ||
      content.includes('protected $guarded'))
  ) {
    return true;
  }

  return false;
}

export function parseModel(node: SyntaxNode, filePath: string, content: string): EloquentModel | null {
  try {
    const className = getClassName(node, content);
    if (!className) return null;

    const tableName = getModelTableName(node, content);
    const fillable = getModelFillable(node, content);
    const relationships = getModelRelationships(node, content);

    return {
      type: 'model',
      name: className,
      filePath,
      framework: 'laravel',
      tableName,
      fillable,
      relationships,
      metadata: {
        timestamps: hasTimestamps(node, content),
        softDeletes: hasSoftDeletes(node, content),
        guarded: getModelGuarded(node, content),
        casts: getModelCasts(node, content),
        hidden: getModelHidden(node, content),
        scopes: getModelScopes(node, content),
        mutators: getModelMutators(node, content),
        accessors: getModelAccessors(node, content),
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      },
    };
  } catch (error) {
    logger.warn(`Failed to parse model`, { error: error.message });
    return null;
  }
}

export function getModelTableName(node: SyntaxNode, content: string): string | null {
  const tableMatch = content.match(/protected\s+\$table\s*=\s*['"]([^'"]+)['"]/);
  return tableMatch ? tableMatch[1] : null;
}

export function getModelFillable(node: SyntaxNode, content: string): string[] {
  const fillableMatch = content.match(/protected\s+\$fillable\s*=\s*\[(.*?)\]/s);
  if (!fillableMatch) return [];

  const fillableContent = fillableMatch[1];
  const attributes = fillableContent.match(/['"]([^'"]+)['"]/g);
  return attributes ? attributes.map(attr => attr.slice(1, -1)) : [];
}

export function getModelRelationships(
  node: SyntaxNode,
  content: string
): Array<{
  name: string;
  type: string;
  relatedModel: string;
  foreignKey?: string;
  localKey?: string;
}> {
  const relationships: Array<{
    name: string;
    type: string;
    relatedModel: string;
    foreignKey?: string;
    localKey?: string;
  }> = [];

  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName) {
        const relationship = parseRelationshipMethod(child, methodName, content);
        if (relationship) {
          relationships.push(relationship);
        }
      }
    }
  });

  return relationships;
}

export function parseRelationshipMethod(
  node: SyntaxNode,
  methodName: string,
  content: string
): {
  name: string;
  type: string;
  relatedModel: string;
  foreignKey?: string;
  localKey?: string;
} | null {
  const methodBody = content.slice(node.startIndex, node.endIndex);

  // Pattern matching for Laravel relationships
  const relationshipPatterns = [
    { type: 'hasOne', pattern: /\$this->hasOne\(([^,)]+)/ },
    { type: 'hasMany', pattern: /\$this->hasMany\(([^,)]+)/ },
    { type: 'belongsTo', pattern: /\$this->belongsTo\(([^,)]+)/ },
    { type: 'belongsToMany', pattern: /\$this->belongsToMany\(([^,)]+)/ },
    { type: 'hasOneThrough', pattern: /\$this->hasOneThrough\(([^,)]+)/ },
    { type: 'hasManyThrough', pattern: /\$this->hasManyThrough\(([^,)]+)/ },
  ];

  for (const { type, pattern } of relationshipPatterns) {
    const match = methodBody.match(pattern);
    if (match) {
      const relatedModel = match[1].replace(/['\"]/g, '').replace(/::class/, '');

      return {
        name: methodName,
        type,
        relatedModel,
        foreignKey: extractForeignKey(methodBody),
        localKey: extractLocalKey(methodBody),
      };
    }
  }

  return null;
}

export function extractForeignKey(methodBody: string): string | null {
  const foreignKeyMatch = methodBody.match(/,\s*['"]([^'"]+)['"][,)]/);
  return foreignKeyMatch ? foreignKeyMatch[1] : null;
}

export function extractLocalKey(methodBody: string): string | null {
  const localKeyMatch = methodBody.match(/,\s*['"][^'"]+['"],\s*['"]([^'"]+)['"][,)]/);
  return localKeyMatch ? localKeyMatch[1] : null;
}

export function hasTimestamps(node: SyntaxNode, content: string): boolean {
  return !content.includes('public $timestamps = false');
}

export function hasSoftDeletes(node: SyntaxNode, content: string): boolean {
  return content.includes('use SoftDeletes') || content.includes('SoftDeleting');
}

export function getModelGuarded(node: SyntaxNode, content: string): string[] {
  const guardedMatch = content.match(/protected\s+\$guarded\s*=\s*\[(.*?)\]/s);
  if (!guardedMatch) return [];

  const guardedContent = guardedMatch[1];
  const attributes = guardedContent.match(/['"]([^'"]+)['"]/g);
  return attributes ? attributes.map(attr => attr.slice(1, -1)) : [];
}

export function getModelCasts(node: SyntaxNode, content: string): Record<string, string> {
  const castsMatch = content.match(/protected\s+\$casts\s*=\s*\[(.*?)\]/s);
  if (!castsMatch) return {};

  const castsContent = castsMatch[1];
  const casts: Record<string, string> = {};

  // Parse key => value pairs
  const pairMatches = castsContent.match(/['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]/g);
  if (pairMatches) {
    for (const pair of pairMatches) {
      const match = pair.match(/['"]([^'"]+)['"]\s*=>\s*['"]([^'"]+)['"]/);
      if (match) {
        casts[match[1]] = match[2];
      }
    }
  }

  return casts;
}

export function getModelHidden(node: SyntaxNode, content: string): string[] {
  const hiddenMatch = content.match(/protected\s+\$hidden\s*=\s*\[(.*?)\]/s);
  if (!hiddenMatch) return [];

  const hiddenContent = hiddenMatch[1];
  const attributes = hiddenContent.match(/['"]([^'"]+)['"]/g);
  return attributes ? attributes.map(attr => attr.slice(1, -1)) : [];
}

export function getModelScopes(node: SyntaxNode, content: string): string[] {
  const scopes: string[] = [];

  // Find all scope methods in the class
  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName && methodName.startsWith('scope') && methodName.length > 5) {
        // Extract scope name: scopeActive -> active
        const scopeName = methodName.substring(5).toLowerCase();
        scopes.push(scopeName);
      }
    }
  });

  return scopes;
}

export function getModelMutators(node: SyntaxNode, content: string): string[] {
  const mutators: string[] = [];

  // Find all mutator methods in the class
  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName && methodName.startsWith('set') && methodName.endsWith('Attribute')) {
        // Extract attribute name: setPasswordAttribute -> password
        const attributeName = methodName.substring(3, methodName.length - 9);
        const snakeCaseName = camelToSnakeCase(attributeName);
        mutators.push(snakeCaseName);
      }
    }
  });

  return mutators;
}

export function getModelAccessors(node: SyntaxNode, content: string): string[] {
  const accessors: string[] = [];

  // Find all accessor methods in the class
  traverseNode(node, child => {
    if (child.type === 'method_declaration') {
      const methodName = getMethodName(child, content);
      if (methodName && methodName.startsWith('get') && methodName.endsWith('Attribute')) {
        // Extract attribute name: getFirstNameAttribute -> first_name
        const attributeName = methodName.substring(3, methodName.length - 9);
        const snakeCaseName = camelToSnakeCase(attributeName);
        accessors.push(snakeCaseName);
      }
    }
  });

  return accessors;
}

export function camelToSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

export function extractPolicyModel(classText: string): string {
  // Extract associated model from policy
  const modelMatch = classText.match(/\$([A-Z][a-zA-Z]*)/);
  return modelMatch ? modelMatch[1] : '';
}

export function extractFactoryModel(classText: string): string {
  const modelMatch = classText.match(/\$model\s*=\s*([A-Z][a-zA-Z]*)/);
  return modelMatch ? modelMatch[1] : '';
}

export function extractObserverModel(classText: string): string {
  // Extract associated model from observer filename or content
  const modelMatch = classText.match(/([A-Z][a-zA-Z]*)Observer/);
  return modelMatch ? modelMatch[1] : '';
}
