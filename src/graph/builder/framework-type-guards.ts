import {
  VueComponent,
  ReactComponent,
  VueComposable,
  ReactHook,
  NextJSRoute,
  ExpressRoute,
  FastifyRoute,
  VueRoute,
} from '../../parsers/base';
import { LaravelRoute, LaravelController, EloquentModel } from '../../parsers/laravel';

/**
 * Type guards for framework entities
 * Pure functions for detecting framework-specific entity types
 */

export function isRouteEntity(
  entity: any
): entity is NextJSRoute | ExpressRoute | FastifyRoute | VueRoute {
  return (
    entity.type === 'route' ||
    entity.type === 'nextjs-page-route' ||
    entity.type === 'nextjs-api-route' ||
    entity.type === 'express-route' ||
    entity.type === 'fastify-route' ||
    'path' in entity
  );
}

export function isVueComponent(entity: any): entity is VueComponent {
  // Vue components are identified by type 'component' and being in a .vue file
  return entity.type === 'component' && entity.filePath && entity.filePath.endsWith('.vue');
}

export function isReactComponent(entity: any): entity is ReactComponent {
  return (
    entity.type === 'component' &&
    'componentType' in entity &&
    'hooks' in entity &&
    'jsxDependencies' in entity
  );
}

export function isVueComposable(entity: any): entity is VueComposable {
  return entity.type === 'composable' && 'reactive_refs' in entity;
}

export function isReactHook(entity: any): entity is ReactHook {
  return entity.type === 'hook' && 'returns' in entity && 'dependencies' in entity;
}

export function isLaravelRoute(entity: any): entity is LaravelRoute {
  return entity.type === 'route' && entity.framework === 'laravel';
}

export function isLaravelController(entity: any): entity is LaravelController {
  return entity.type === 'controller' && entity.framework === 'laravel';
}

export function isEloquentModel(entity: any): entity is EloquentModel {
  return entity.type === 'model' && entity.framework === 'laravel';
}

export function isJobSystemEntity(entity: any): boolean {
  return entity.type === 'job_system';
}

export function isORMSystemEntity(entity: any): boolean {
  return entity.type === 'orm_system';
}

export function isGodotScene(entity: any): boolean {
  return (
    entity != null &&
    typeof entity === 'object' &&
    entity.type === 'godot_scene' &&
    entity.framework === 'godot'
  );
}

export function isGodotNode(entity: any): boolean {
  return (
    entity != null &&
    typeof entity === 'object' &&
    entity.type === 'godot_node' &&
    entity.framework === 'godot'
  );
}

export function isClosureRouteLinkedDuringPersistence(route: { controller_class?: string | null; action?: string | null }): boolean {
  return route.controller_class === 'Closure' || route.action === 'Closure';
}

/**
 * Extract controller method from Laravel action string
 * Examples: "App\\Http\\Controllers\\UserController@index" -> "index"
 *           "UserController@show" -> "show"
 */
export function extractControllerMethod(action?: string): string | undefined {
  if (!action) return undefined;

  const atIndex = action.lastIndexOf('@');
  if (atIndex === -1) return undefined;

  return action.substring(atIndex + 1);
}
