/**
 * Entity conversion utilities for cross-stack graph builder
 */

import { Route, Component } from '../../database/models';
import { FrameworkEntity } from '../../parsers/base';

/**
 * Convert Route objects to FrameworkEntity objects
 */
export function convertRoutesToFrameworkEntities(routes: Route[]): FrameworkEntity[] {
  return routes.map(route => ({
    type: 'route',
    name: `${route.method || 'ANY'} ${route.path}`,
    filePath: `route_${route.id}`,
    framework: route.framework_type || 'laravel',
    metadata: {
      id: route.id,
      path: route.path,
      method: route.method,
      handlerSymbolId: route.handler_symbol_id,
      middleware: route.middleware || [],
      dynamicSegments: route.dynamic_segments || [],
      authRequired: route.auth_required || false,
    },
    properties: {
      path: route.path,
      method: route.method,
      authRequired: route.auth_required,
    },
  }));
}

/**
 * Convert Component objects to FrameworkEntity objects
 */
export function convertComponentsToFrameworkEntities(components: Component[]): FrameworkEntity[] {
  return components.map(component => {
    const symbolName = (component as any).symbol_name;
    const filePath = (component as any).file_path;
    const extractedName = extractComponentNameFromFilePath(filePath);
    const finalName = symbolName || extractedName || `Component_${component.id}`;

    return {
      type: 'component',
      name: finalName,
      filePath: filePath || `component_${component.id}`,
      framework: component.component_type === 'vue' ? 'vue' : component.component_type,
      metadata: {
        id: component.id,
        symbolId: component.symbol_id,
        componentType: component.component_type,
        props: component.props || [],
        emits: component.emits || [],
        slots: component.slots || [],
        hooks: component.hooks || [],
        parentComponentId: component.parent_component_id,
        templateDependencies: component.template_dependencies || [],
      },
      properties: {
        componentType: component.component_type,
        props: component.props,
        emits: component.emits,
      },
    };
  });
}

/**
 * Extract component name from file path (e.g., UserList.vue -> UserList)
 */
export function extractComponentNameFromFilePath(filePath: string): string | null {
  if (!filePath) return null;

  const filename = filePath.split('/').pop() || filePath.split('\\\\').pop();
  if (!filename) return null;

  const nameWithoutExt = filename.split('.')[0];

  return nameWithoutExt || null;
}
