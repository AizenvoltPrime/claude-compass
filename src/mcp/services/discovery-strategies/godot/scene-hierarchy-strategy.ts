/**
 * Godot Scene Hierarchy Strategy
 *
 * Discovers Godot scenes and nodes based on scene tree structure.
 * Links node scripts to scenes that instantiate them.
 */

import type { Knex } from 'knex';
import {
  DiscoveryStrategy,
  DiscoveryContext,
  DiscoveryResult,
} from '../common/types';

interface SceneInfo {
  id: number;
  scene_id: number;
  scene_path: string;
  symbol_id: number | null;
}

export class SceneHierarchyStrategy implements DiscoveryStrategy {
  readonly name = 'godot-scene-hierarchy';
  readonly description = 'Discovers Godot scenes and nodes via scene tree relationships';
  readonly priority = 8;

  constructor(private db: Knex) {}

  async discover(context: DiscoveryContext): Promise<DiscoveryResult> {
    const discovered = new Map<number, number>();
    const { currentSymbols, repoId, options, iteration } = context;
    const maxDepth = options.maxDepth;
    const relevance = 1.0 - (iteration + 1) / (maxDepth + 1);

    try {
      // Collect all scenes first to batch query child/parent scenes
      const allScenes: SceneInfo[] = [];
      for (const symbolId of currentSymbols) {
        const scenesUsingSymbol = await this.findScenesUsingNodeScript(symbolId, repoId);
        allScenes.push(...scenesUsingSymbol);

        // Add scenes to discovered set
        scenesUsingSymbol.forEach(scene => {
          if (scene.symbol_id) {
            discovered.set(scene.symbol_id, relevance);
          }
        });
      }

      // Batch query: get all scene IDs and query child/parent scenes once
      const sceneIds = [...new Set(allScenes.map(s => s.scene_id))];
      if (sceneIds.length === 0) {
        return discovered;
      }

      // Batch query child scenes for all collected scene IDs
      const allChildScenes = await this.findChildScenesForMultiple(sceneIds, repoId);
      allChildScenes.forEach(child => {
        if (child.symbol_id) {
          // Scene hierarchy: 0.95x relevance (direct structural relationship in scene tree)
          discovered.set(child.symbol_id, relevance * 0.95);
        }
      });

      // Batch query parent scenes for all collected scene IDs
      const allParentScenes = await this.findParentScenesForMultiple(sceneIds, repoId);
      allParentScenes.forEach(parent => {
        if (parent.symbol_id) {
          // Scene hierarchy: 0.95x relevance (direct structural relationship in scene tree)
          discovered.set(parent.symbol_id, relevance * 0.95);
        }
      });
    } catch (error) {
      console.error('[godot-scene-hierarchy] Error discovering scene hierarchy:', error);
    }

    return discovered;
  }

  private async findScenesUsingNodeScript(
    scriptSymbolId: number,
    repoId: number
  ): Promise<SceneInfo[]> {
    const results = await this.db('godot_nodes as gn')
      .join('godot_scenes as gs', 'gn.scene_id', 'gs.id')
      .select(
        'gn.id',
        'gn.scene_id',
        'gs.scene_path',
        'gs.symbol_id'
      )
      .where('gn.script_symbol_id', scriptSymbolId)
      .where('gn.repo_id', repoId);

    return results;
  }

  private async findChildScenesForMultiple(
    sceneIds: number[],
    repoId: number
  ): Promise<SceneInfo[]> {
    if (sceneIds.length === 0) return [];

    const results = await this.db('godot_scene_instances as gsi')
      .join('godot_scenes as gs', 'gsi.child_scene_id', 'gs.id')
      .select(
        'gs.id as scene_id',
        'gs.scene_path',
        'gs.symbol_id'
      )
      .whereIn('gsi.parent_scene_id', sceneIds)
      .where('gsi.repo_id', repoId);

    return results.map(r => ({
      id: r.scene_id,
      scene_id: r.scene_id,
      scene_path: r.scene_path,
      symbol_id: r.symbol_id,
    }));
  }

  private async findParentScenesForMultiple(
    sceneIds: number[],
    repoId: number
  ): Promise<SceneInfo[]> {
    if (sceneIds.length === 0) return [];

    const results = await this.db('godot_scene_instances as gsi')
      .join('godot_scenes as gs', 'gsi.parent_scene_id', 'gs.id')
      .select(
        'gs.id as scene_id',
        'gs.scene_path',
        'gs.symbol_id'
      )
      .whereIn('gsi.child_scene_id', sceneIds)
      .where('gsi.repo_id', repoId);

    return results.map(r => ({
      id: r.scene_id,
      scene_id: r.scene_id,
      scene_path: r.scene_path,
      symbol_id: r.symbol_id,
    }));
  }
}
