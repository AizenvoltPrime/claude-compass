import Parser from 'tree-sitter';
import { VueRoute } from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { createComponentLogger } from '../../utils/logger';
import { extractStringLiteral, parseObjectToJson } from './vue-utils';

const logger = createComponentLogger('vue-router');

export async function parseVueRouterRoutes(
  tree: Parser.Tree | null,
  content: string,
  filePath: string,
  options: FrameworkParseOptions
): Promise<VueRoute[]> {
  const routes: VueRoute[] = [];

  try {
    if (content.length > 28000) {
      return routes;
    }

    if (!tree?.rootNode) return routes;

    findRouteDefinitions(tree.rootNode, routes, filePath);
  } catch (error) {
    logger.error(`Failed to parse Vue Router routes in ${filePath}`, { error });
  }

  return routes;
}

export function findRouteDefinitions(
  node: Parser.SyntaxNode,
  routes: VueRoute[],
  filePath: string
): void {
  const traverse = (node: Parser.SyntaxNode) => {
    // Pattern 1: createRouter({ routes: [...] })
    if (node.type === 'call_expression') {
      const functionNode = node.child(0);
      if (functionNode?.text === 'createRouter') {
        const argsNode = node.child(1);
        if (argsNode) {
          const routesArray = findRoutesArrayInObject(argsNode);
          if (routesArray) {
            parseRoutesArray(routesArray, routes, filePath);
          }
        }
      }
    }

    // Pattern 2: const routes = [...]
    if (node.type === 'variable_declarator') {
      const nameNode = node.child(0);
      const valueNode = node.child(2);

      if (nameNode?.text === 'routes' && valueNode?.type === 'array') {
        parseRoutesArray(valueNode, routes, filePath);
      }
    }

    // Pattern 3: export default [...] (route array export)
    if (node.type === 'export_default_declaration') {
      const valueNode = node.child(1);
      if (valueNode?.type === 'array') {
        parseRoutesArray(valueNode, routes, filePath);
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

export function findRoutesArrayInObject(objectNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
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

export function parseRoutesArray(
  arrayNode: Parser.SyntaxNode,
  routes: VueRoute[],
  filePath: string
): void {
  for (let i = 0; i < arrayNode.childCount; i++) {
    const routeNode = arrayNode.child(i);
    if (routeNode?.type === 'object') {
      const route = parseRouteObject(routeNode, filePath);
      if (route) {
        routes.push(route);
      }
    }
  }
}

export function parseRouteObject(routeNode: Parser.SyntaxNode, filePath: string): VueRoute | null {
  const route: any = {
    type: 'route',
    name: '',
    filePath,
    path: '',
    component: null,
    metadata: {},
  };

  let metaObject: any = {};

  // Parse route properties
  for (let i = 0; i < routeNode.childCount; i++) {
    const pairNode = routeNode.child(i);
    if (pairNode?.type === 'pair') {
      const keyNode = pairNode.child(0);
      const valueNode = pairNode.child(2);

      if (!keyNode || !valueNode) continue;

      const key = getVueNodeText(keyNode).replace(/['"]/g, '');

      switch (key) {
        case 'path':
          route.path = getVueNodeText(valueNode).replace(/['"]/g, '');
          route.metadata.path = route.path;
          break;
        case 'name':
          route.name = getVueNodeText(valueNode).replace(/['"]/g, '');
          route.metadata.name = route.name;
          break;
        case 'component':
          const componentValue = getVueNodeText(valueNode).replace(/['"]/g, '');
          route.component = componentValue;
          route.metadata.component = componentValue;

          if (
            valueNode.type === 'arrow_function' ||
            getVueNodeText(valueNode).includes('import(')
          ) {
            route.metadata.lazy = true;
          }
          break;
        case 'meta':
          metaObject = parseObjectToJson(valueNode);
          if (metaObject.requiresAuth !== undefined) {
            route.metadata.requiresAuth = metaObject.requiresAuth;
          }
          if (metaObject.role !== undefined) {
            route.metadata.role = metaObject.role;
          }
          break;
        case 'props':
          route.metadata.props = getVueNodeText(valueNode) === 'true';
          break;
        case 'children':
          if (valueNode.type === 'array') {
            route.metadata.children = [];
            for (let j = 0; j < valueNode.childCount; j++) {
              const childRouteNode = valueNode.child(j);
              if (childRouteNode?.type === 'object') {
                const childRoute = parseRouteObject(childRouteNode, filePath);
                if (childRoute) {
                  route.metadata.children.push(childRoute);
                }
              }
            }
          }
          break;
        case 'redirect':
          route.metadata.redirect = getVueNodeText(valueNode).replace(/['"]/g, '');
          break;
        case 'alias':
          route.metadata.alias = getVueNodeText(valueNode).replace(/['"]/g, '');
          break;
      }
    }
  }

  if (!route.name && route.path) {
    route.name = route.path;
  }

  return route as VueRoute;
}

export function getVueNodeText(node: Parser.SyntaxNode): string {
  return node.text;
}
