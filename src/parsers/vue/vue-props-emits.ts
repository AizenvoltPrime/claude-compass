import Parser from 'tree-sitter';
import { PropDefinition } from '../base';
import { createComponentLogger } from '../../utils/logger';
import { extractStringLiteral } from './vue-utils';

const logger = createComponentLogger('vue-props-emits');

export function extractPropsFromTypeDefinition(
  rootNode: Parser.SyntaxNode,
  typeName: string
): PropDefinition[] {
  const props: PropDefinition[] = [];

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.text === typeName) {
        const bodyNode = node.childForFieldName('body');
        if (bodyNode) {
          props.push(...parseInterfaceBody(bodyNode));
        }
      }
    }

    if (node.type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.text === typeName) {
        const valueNode = node.childForFieldName('value');
        if (valueNode?.type === 'object_type') {
          props.push(...parseInterfaceBody(valueNode));
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(rootNode);
  return props;
}

export function parseInterfaceBody(bodyNode: Parser.SyntaxNode): PropDefinition[] {
  const props: PropDefinition[] = [];

  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i);
    if (child && child.type === 'property_signature') {
      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');

      if (nameNode) {
        const propName = nameNode.text;

        // Check for optional marker by looking for '?' token in child nodes
        let isOptional = false;
        for (let j = 0; j < child.childCount; j++) {
          const token = child.child(j);
          if (token && token.type === '?') {
            isOptional = true;
            break;
          }
        }

        let propType = typeNode?.text || 'any';

        if (propType.startsWith(':')) {
          propType = propType.substring(1).trim();
        }

        props.push({
          name: propName,
          type: propType,
          required: !isOptional,
        });
      }
    }
  }

  return props;
}

export function extractVuePropsAndEmits(tree: Parser.Tree): { props: PropDefinition[]; emits: string[] } {
  const props: PropDefinition[] = [];
  const emits: string[] = [];

  if (!tree?.rootNode) return { props, emits };

  const traverse = (node: Parser.SyntaxNode) => {
    try {
      if (node.type === 'call_expression') {
        const functionNode = node.child(0);

        // Extract props from defineProps
        if (functionNode?.text === 'defineProps') {
          const secondChild = node.child(1);

          if (secondChild?.type === 'type_arguments') {
            const typeIdentifier = secondChild.child(1);
            if (typeIdentifier?.type === 'type_identifier') {
              const typeName = typeIdentifier.text;
              const interfaceProps = extractPropsFromTypeDefinition(tree.rootNode, typeName);
              props.push(...interfaceProps);
            }
          } else if (secondChild?.type === 'arguments') {
            const propsArg = secondChild.child(1);
            if (propsArg) {
              props.push(...parsePropsFromNode(propsArg));
            }
          }
        }

        // Extract emits from defineEmits
        if (functionNode?.text === 'defineEmits') {
          const secondChild = node.child(1);

          if (secondChild?.type === 'type_arguments') {
            const typeNode = secondChild.child(1);
            if (typeNode) {
              const typeEmits = extractEmitsFromTypeNode(typeNode, tree.rootNode);
              emits.push(...typeEmits);
            }
          } else if (secondChild?.type === 'arguments') {
            const emitsArg = secondChild.child(1);
            if (emitsArg?.type === 'array') {
              for (let i = 0; i < emitsArg.childCount; i++) {
                const child = emitsArg.child(i);
                if (child) {
                  const emitName = extractStringLiteral(child);
                  if (emitName) {
                    emits.push(emitName);
                  }
                }
              }
            }
          }
        }

        // Extract emit calls ($emit or emit)
        const caller = node.child(0);
        if (caller?.type === 'member_expression') {
          const object = caller.child(0)?.text;
          const property = caller.child(2)?.text;

          if (object === '$emit' || property === 'emit') {
            const argsNode = node.child(1);
            const firstArg = argsNode?.child(1);
            const emitName = extractStringLiteral(firstArg);
            if (emitName && !emits.includes(emitName)) {
              emits.push(emitName);
            }
          }
        }
      }

      if (node.type === 'pair') {
        const keyNode = node.child(0);

        // Extract props from object-based props definition
        if (keyNode?.text === 'props') {
          const propsValue = node.child(2);
          if (propsValue) {
            props.push(...parsePropsFromNode(propsValue));
          }
        }

        // Extract emits from array-based emits definition
        if (keyNode?.text === 'emits') {
          const emitsValue = node.child(2);
          if (emitsValue?.type === 'array') {
            for (let i = 0; i < emitsValue.childCount; i++) {
              const child = emitsValue.child(i);
              if (child) {
                const emitName = extractStringLiteral(child);
                if (emitName) {
                  emits.push(emitName);
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          traverse(child);
        }
      }
    } catch (error) {
      logger.warn('Error traversing AST node during props/emits extraction', {
        nodeType: node.type,
        error,
      });
    }
  };

  traverse(tree.rootNode);
  return { props, emits };
}

export function parsePropsFromNode(node: any): PropDefinition[] {
  const props: PropDefinition[] = [];

  if (!node) return props;

  // Handle array format: ['prop1', 'prop2']
  if (node.type === 'array') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const propName = extractStringLiteral(child);
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
        const propName = extractStringLiteral(propNameNode) || propNameNode?.text;

        if (propName) {
          const propValue = child.child(2); // After property name and ':'

          if (propValue) {
            props.push(parsePropDefinition(propName, propValue));
          }
        }
      }
    }
  }

  return props;
}

export function parsePropDefinition(name: string, valueNode: any): PropDefinition {
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
          prop.default = extractStringLiteral(value) || value?.text;
        }
      }
    }
  }

  return prop;
}

export function extractEmitsFromTypeNode(
  typeNode: Parser.SyntaxNode,
  rootNode: Parser.SyntaxNode
): string[] {
  const emits: string[] = [];

  if (typeNode.type === 'tuple_type' || typeNode.type === 'array_type') {
    for (let i = 0; i < typeNode.childCount; i++) {
      const child = typeNode.child(i);
      if (child) {
        const emitName = extractStringLiteral(child);
        if (emitName) {
          emits.push(emitName);
        }
      }
    }
  } else if (typeNode.type === 'object_type') {
    for (let i = 0; i < typeNode.childCount; i++) {
      const child = typeNode.child(i);
      if (child?.type === 'call_signature' || child?.type === 'method_signature') {
        const params = child.childForFieldName('parameters');
        if (params) {
          const firstParam = params.child(1);
          if (firstParam) {
            const typeAnnotation = firstParam.childForFieldName('type');
            if (typeAnnotation) {
              const emitName = extractStringLiteral(typeAnnotation);
              if (emitName) {
                emits.push(emitName);
              }
            }
          }
        }
      }
    }
  } else if (typeNode.type === 'type_identifier') {
    const typeName = typeNode.text;
    const typeEmits = extractEmitsFromTypeDefinition(rootNode, typeName);
    emits.push(...typeEmits);
  }

  return emits;
}

export function extractEmitsFromTypeDefinition(rootNode: Parser.SyntaxNode, typeName: string): string[] {
  const emits: string[] = [];

  const traverse = (node: Parser.SyntaxNode) => {
    if (node.type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.text === typeName) {
        const valueNode = node.childForFieldName('value');
        if (valueNode) {
          emits.push(...extractEmitsFromTypeNode(valueNode, rootNode));
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        traverse(child);
      }
    }
  };

  traverse(rootNode);
  return emits;
}

export function parseEmitsArray(arrayNode: Parser.SyntaxNode): string[] {
  const emits: string[] = [];

  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i);
    if (child && child.type !== ',' && child.type !== '[' && child.type !== ']') {
      const emitName = extractStringLiteral(child);
      if (emitName) {
        emits.push(emitName);
      }
    }
  }

  return emits;
}
