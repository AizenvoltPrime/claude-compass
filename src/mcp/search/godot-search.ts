import path from 'path';
import { DatabaseService } from '../../database/services';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('godot-search');

export class GodotSearch {
  constructor(private dbService: DatabaseService) {}

  async searchScenes(query: string, repoIds: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds) {
        const scenes = await this.dbService.getGodotScenesByRepository(repoId);
        const filteredScenes = scenes.filter(
          scene =>
            scene.scene_name?.toLowerCase().includes(query.toLowerCase()) ||
            scene.scene_path.toLowerCase().includes(query.toLowerCase())
        );

        results.push(
          ...filteredScenes.map(scene => ({
            id: scene.id,
            name: scene.scene_name || path.basename(scene.scene_path, '.tscn'),
            file: { path: scene.scene_path },
            framework: 'godot',
            entity_type: 'scene',
            symbol_type: 'scene',
            metadata: {
              node_count: scene.node_count,
              has_script: scene.has_script,
              ...scene.metadata,
            },
          }))
        );
      }
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to search Godot scenes', {
        error: errorMessage,
        repoIds,
        query,
      });
      throw new Error(`Godot scene search failed: ${errorMessage}`);
    }
  }

  async searchNodes(query: string, repoIds: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds) {
        const scenes = await this.dbService.getGodotScenesByRepository(repoId);

        if (scenes.length === 0) {
          continue;
        }

        const sceneIds = scenes.map(s => s.id);
        const allNodes = await this.dbService.getGodotNodesByScenes(sceneIds);

        const filteredNodes = allNodes.filter(
          node =>
            node.node_name.toLowerCase().includes(query.toLowerCase()) ||
            node.node_type.toLowerCase().includes(query.toLowerCase())
        );

        results.push(
          ...filteredNodes.map(node => ({
            id: node.id,
            name: node.node_name,
            file: { path: `scene:${node.scene_id}` },
            framework: 'godot',
            entity_type: 'node',
            symbol_type: 'node',
            metadata: {
              node_type: node.node_type,
              script_path: node.script_path,
              properties: node.properties,
            },
          }))
        );
      }
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to search Godot nodes', {
        error: errorMessage,
        repoIds,
        query,
      });
      throw new Error(`Godot node search failed: ${errorMessage}`);
    }
  }


}
