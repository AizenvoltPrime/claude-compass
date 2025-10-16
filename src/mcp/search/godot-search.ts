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
            scene.scene_name.toLowerCase().includes(query.toLowerCase()) ||
            scene.scene_path.toLowerCase().includes(query.toLowerCase())
        );

        results.push(
          ...filteredScenes.map(scene => ({
            id: scene.id,
            name: scene.scene_name,
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
      logger.error('Failed to search Godot scenes', { error: error.message });
      return [];
    }
  }

  async searchNodes(query: string, repoIds: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds) {
        const scenes = await this.dbService.getGodotScenesByRepository(repoId);
        for (const scene of scenes) {
          const nodes = await this.dbService.getGodotNodesByScene(scene.id);
          const filteredNodes = nodes.filter(
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
      }
      return results;
    } catch (error) {
      logger.error('Failed to search Godot nodes', { error: error.message });
      return [];
    }
  }

  async searchScripts(query: string, repoIds: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds) {
        const scripts = await this.dbService.getGodotScriptsByRepository(repoId);
        const filteredScripts = scripts.filter(
          script =>
            script.class_name.toLowerCase().includes(query.toLowerCase()) ||
            script.script_path.toLowerCase().includes(query.toLowerCase()) ||
            (script.base_class && script.base_class.toLowerCase().includes(query.toLowerCase()))
        );

        results.push(
          ...filteredScripts.map(script => ({
            id: script.id,
            name: script.class_name,
            file: { path: script.script_path },
            framework: 'godot',
            entity_type: 'script',
            symbol_type: 'class',
            metadata: {
              base_class: script.base_class,
              is_autoload: script.is_autoload,
              signals: script.signals,
              exports: script.exports,
              ...script.metadata,
            },
          }))
        );
      }
      return results;
    } catch (error) {
      logger.error('Failed to search Godot scripts', { error: error.message });
      return [];
    }
  }

  async searchAutoloads(query: string, repoIds: number[]): Promise<any[]> {
    try {
      const results = [];
      for (const repoId of repoIds) {
        const autoloads = await this.dbService.getGodotAutoloadsByRepository(repoId);
        const filteredAutoloads = autoloads.filter(
          autoload =>
            autoload.autoload_name.toLowerCase().includes(query.toLowerCase()) ||
            autoload.script_path.toLowerCase().includes(query.toLowerCase())
        );

        results.push(
          ...filteredAutoloads.map(autoload => ({
            id: autoload.id,
            name: autoload.autoload_name,
            file: { path: autoload.script_path },
            framework: 'godot',
            entity_type: 'autoload',
            symbol_type: 'autoload',
            metadata: {
              script_path: autoload.script_path,
              script_id: autoload.script_id,
              ...autoload.metadata,
            },
          }))
        );
      }
      return results;
    } catch (error) {
      logger.error('Failed to search Godot autoloads', { error: error.message });
      return [];
    }
  }
}
