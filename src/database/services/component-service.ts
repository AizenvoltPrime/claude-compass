import type { Knex } from 'knex';
import type {
  Component,
  CreateComponent,
  ComponentWithSymbol,
  ComponentTree,
  SymbolWithFile,
  Repository,
} from '../models';

function deserializeComponentJsonFields(component: any): Component {
  return {
    ...component,
    props: typeof component.props === 'string' ? JSON.parse(component.props) : component.props,
    emits:
      component.emits && typeof component.emits === 'string'
        ? JSON.parse(component.emits)
        : component.emits,
    slots:
      component.slots && typeof component.slots === 'string'
        ? JSON.parse(component.slots)
        : component.slots,
    hooks:
      component.hooks && typeof component.hooks === 'string'
        ? JSON.parse(component.hooks)
        : component.hooks,
    template_dependencies:
      typeof component.template_dependencies === 'string'
        ? JSON.parse(component.template_dependencies)
        : component.template_dependencies,
  } as Component;
}

export async function createComponent(db: Knex, data: CreateComponent): Promise<Component> {
  const dbData = {
    ...data,
    props: JSON.stringify(data.props || []),
    emits: JSON.stringify(data.emits || []),
    slots: JSON.stringify(data.slots || []),
    hooks: JSON.stringify(data.hooks || []),
    template_dependencies: JSON.stringify(data.template_dependencies || []),
  };

  const [component] = await db('components').insert(dbData).returning('*');

  return deserializeComponentJsonFields(component);
}

export async function getComponent(db: Knex, id: number): Promise<Component | null> {
  const component = await db('components').where({ id }).first();
  if (!component) return null;
  return deserializeComponentJsonFields(component);
}

export async function getComponentWithSymbol(
  db: Knex,
  id: number
): Promise<ComponentWithSymbol | null> {
  const result = await db('components')
    .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .leftJoin('repositories', 'components.repo_id', 'repositories.id')
    .select(
      'components.*',
      'symbols.id as symbol_id',
      'symbols.name as symbol_name',
      'symbols.signature as symbol_signature',
      'symbols.start_line as symbol_start_line',
      'files.path as file_path',
      'files.language as file_language',
      'repositories.name as repo_name',
      'repositories.path as repo_path'
    )
    .where('components.id', id)
    .first();

  if (!result) return null;

  const deserializedResult = deserializeComponentJsonFields(result);
  const component = { ...deserializedResult } as ComponentWithSymbol;

  if (result.symbol_id) {
    component.symbol = {
      id: result.symbol_id,
      name: result.symbol_name,
      signature: result.symbol_signature,
      start_line: result.symbol_start_line,
      file: {
        path: result.file_path,
        language: result.file_language,
      },
    } as SymbolWithFile;
  }

  if (result.repo_name) {
    component.repository = {
      id: result.repo_id,
      name: result.repo_name,
      path: result.repo_path,
    } as Repository;
  }

  return component;
}

export async function getComponentsByType(
  db: Knex,
  repoId: number,
  type: string
): Promise<Component[]> {
  const components = await db('components')
    .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .select('components.*', 'files.path as file_path', 'symbols.name as symbol_name')
    .where({ 'components.repo_id': repoId, 'components.component_type': type })
    .orderBy('components.id');
  return components.map(c => deserializeComponentJsonFields(c));
}

export async function getComponentsByRepository(
  db: Knex,
  repoId: number
): Promise<Component[]> {
  const components = await db('components')
    .where({ repo_id: repoId })
    .orderBy(['component_type', 'id']);
  return components.map(c => deserializeComponentJsonFields(c));
}

export async function getComponentHierarchy(
  db: Knex,
  componentId: number
): Promise<ComponentTree | null> {
  const component = await getComponent(db, componentId);
  if (!component) return null;

  const children = await db('components').where({ parent_component_id: componentId });

  let parent = null;
  if (component.parent_component_id) {
    parent = await getComponent(db, component.parent_component_id);
  }

  return {
    ...component,
    children: await Promise.all(children.map(child => getComponentHierarchy(db, child.id))),
    parent,
  } as ComponentTree;
}

export async function findComponentByName(
  db: Knex,
  repoId: number,
  name: string
): Promise<Component | null> {
  const component = await db('components')
    .leftJoin('symbols', 'components.symbol_id', 'symbols.id')
    .where({
      'components.repo_id': repoId,
      'symbols.name': name,
    })
    .select('components.*')
    .first();

  if (!component) return null;
  return deserializeComponentJsonFields(component);
}
