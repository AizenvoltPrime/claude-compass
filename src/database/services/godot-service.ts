import type { Knex } from 'knex';
import type {
  GodotScene,
  GodotNode,
  CreateGodotScene,
  CreateGodotNode,
  GodotSceneWithNodes,
  GodotNodeWithScript,
} from '../models';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('godot-service');

export async function storeGodotScene(db: Knex, data: CreateGodotScene): Promise<GodotScene> {
  try {
    const existingScene = await db('godot_scenes')
      .where({ repo_id: data.repo_id, scene_path: data.scene_path })
      .first();

    if (existingScene) {
      const [scene] = await db('godot_scenes')
        .where({ id: existingScene.id })
        .update({ ...data, updated_at: new Date() })
        .returning('*');
      return scene as GodotScene;
    } else {
      const [scene] = await db('godot_scenes').insert(data).returning('*');
      return scene as GodotScene;
    }
  } catch (error) {
    logger.error('Failed to store Godot scene', {
      scene_path: data.scene_path,
      error: (error as Error).message,
    });
    throw error;
  }
}

export async function getGodotScene(db: Knex, id: number): Promise<GodotScene | null> {
  const scene = await db('godot_scenes').where({ id }).first();
  return (scene as GodotScene) || null;
}

export async function getGodotSceneWithNodes(
  db: Knex,
  id: number
): Promise<GodotSceneWithNodes | null> {
  const scene = await getGodotScene(db, id);
  if (!scene) return null;

  const nodes = await db('godot_nodes').where({ scene_id: id }).orderBy('node_name');

  const rootNode = nodes.find(node => !node.parent_node_id);

  return {
    ...scene,
    nodes: nodes as GodotNode[],
    root_node: rootNode as GodotNode,
  };
}

export async function getGodotScenesByRepository(
  db: Knex,
  repoId: number
): Promise<GodotScene[]> {
  const scenes = await db('godot_scenes').where({ repo_id: repoId }).orderBy('scene_path');
  return scenes as GodotScene[];
}

export async function findGodotSceneByPath(
  db: Knex,
  repoId: number,
  scenePath: string
): Promise<GodotScene | null> {
  const scene = await db('godot_scenes')
    .where({ repo_id: repoId, scene_path: scenePath })
    .first();
  return (scene as GodotScene) || null;
}

export async function storeGodotNode(db: Knex, data: CreateGodotNode): Promise<GodotNode> {
  try {
    const [node] = await db('godot_nodes').insert(data).returning('*');
    return node as GodotNode;
  } catch (error) {
    logger.error('Failed to store Godot node', {
      node_name: data.node_name,
      error: (error as Error).message,
    });
    throw error;
  }
}

export async function getGodotNode(db: Knex, id: number): Promise<GodotNode | null> {
  const node = await db('godot_nodes').where({ id }).first();
  return (node as GodotNode) || null;
}

export async function getGodotNodeWithScript(
  db: Knex,
  id: number
): Promise<GodotNodeWithScript | null> {
  const node = await getGodotNode(db, id);
  if (!node) return null;

  const scene = await getGodotScene(db, node.scene_id);
  const parent = node.parent_node_id ? await getGodotNode(db, node.parent_node_id) : null;

  const children = await db('godot_nodes')
    .where({ parent_node_id: id })
    .orderBy('node_name');

  return {
    ...node,
    scene: scene || undefined,
    parent: parent || undefined,
    children: children as GodotNode[],
  };
}

export async function getGodotNodesByScene(db: Knex, sceneId: number): Promise<GodotNode[]> {
  const nodes = await db('godot_nodes').where({ scene_id: sceneId }).orderBy('node_name');
  return nodes as GodotNode[];
}

export async function getGodotNodesByScenes(db: Knex, sceneIds: number[]): Promise<GodotNode[]> {
  if (sceneIds.length === 0) {
    return [];
  }
  const nodes = await db('godot_nodes')
    .whereIn('scene_id', sceneIds)
    .orderBy('scene_id')
    .orderBy('node_name');
  return nodes as GodotNode[];
}
