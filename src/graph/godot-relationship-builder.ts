import { DatabaseService } from '../database/services';
import {
  GodotScene,
  GodotNode,
  GodotScript,
  GodotAutoload,
  GodotRelationship,
  GodotRelationshipType,
  GodotEntityType
} from '../database/models';
import { FrameworkEntity } from '../parsers/base';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('godot-relationship-builder');

/**
 * Godot-specific relationship builder for Solution 1: Enhanced Framework Relationships
 * Creates and manages framework-specific relationships between Godot entities
 */
export class GodotRelationshipBuilder {
  constructor(private dbService: DatabaseService) {}

  /**
   * Build relationships between Godot framework entities
   */
  async buildRelationships(
    repositoryId: number,
    entities: FrameworkEntity[]
  ): Promise<GodotRelationship[]> {
    const relationships: GodotRelationship[] = [];

    try {
      // Group entities by type
      const scenes = entities.filter(e => e.type === 'godot_scene') as any[];
      const nodes = entities.filter(e => e.type === 'godot_node') as any[];
      const scripts = entities.filter(e => e.type === 'godot_script') as any[];
      const autoloads = entities.filter(e => e.type === 'godot_autoload') as any[];

      logger.debug('Building Godot relationships', {
        repositoryId,
        scenesCount: scenes.length,
        nodesCount: nodes.length,
        scriptsCount: scripts.length,
        autoloadsCount: autoloads.length
      });

      // Build scene-script attachment relationships
      relationships.push(...await this.buildSceneScriptRelationships(repositoryId, scenes, scripts));

      // Build node hierarchy relationships
      relationships.push(...await this.buildNodeHierarchyRelationships(repositoryId, nodes));

      // Build scene-resource reference relationships
      relationships.push(...await this.buildSceneResourceRelationships(repositoryId, scenes));

      // Build autoload reference relationships
      relationships.push(...await this.buildAutoloadRelationships(repositoryId, autoloads, scripts));

      logger.info('Godot relationships built successfully', {
        repositoryId,
        relationshipCount: relationships.length,
        relationshipTypes: [...new Set(relationships.map(r => r.relationship_type))]
      });

      return relationships;
    } catch (error) {
      logger.error('Failed to build Godot relationships', {
        repositoryId,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Build scene-script attachment relationships
   */
  private async buildSceneScriptRelationships(
    repositoryId: number,
    scenes: any[],
    scripts: any[]
  ): Promise<GodotRelationship[]> {
    const relationships: GodotRelationship[] = [];

    for (const scene of scenes) {
      // Check if scene has nodes with script attachments
      if (scene.nodes) {
        for (const node of scene.nodes) {
          if (node.script) {
            // Find matching script entity
            const scriptEntity = scripts.find(s =>
              s.filePath === node.script ||
              s.filePath.endsWith(node.script)
            );

            if (scriptEntity) {
              try {
                const relationship = await this.dbService.createGodotRelationship({
                  repo_id: repositoryId,
                  relationship_type: GodotRelationshipType.SCENE_SCRIPT_ATTACHMENT,
                  from_entity_type: GodotEntityType.SCENE,
                  from_entity_id: scene.id,
                  to_entity_type: GodotEntityType.SCRIPT,
                  to_entity_id: scriptEntity.id,
                  confidence: 0.95,
                  metadata: {
                    nodeName: node.nodeName,
                    nodeType: node.nodeType,
                    scriptPath: node.script
                  }
                });

                relationships.push(relationship);

                logger.debug('Created scene-script relationship', {
                  scenePath: scene.scenePath,
                  scriptPath: scriptEntity.filePath,
                  nodeName: node.nodeName
                });
              } catch (error) {
                logger.warn('Failed to create scene-script relationship', {
                  sceneId: scene.id,
                  scriptId: scriptEntity.id,
                  error: (error as Error).message
                });
              }
            }
          }
        }
      }
    }

    return relationships;
  }

  /**
   * Build node hierarchy relationships (parent-child)
   */
  private async buildNodeHierarchyRelationships(
    repositoryId: number,
    nodes: any[]
  ): Promise<GodotRelationship[]> {
    const relationships: GodotRelationship[] = [];

    for (const node of nodes) {
      if (node.parent) {
        // Find parent node entity
        const parentNode = nodes.find(n => n.nodeName === node.parent);

        if (parentNode) {
          try {
            const relationship = await this.dbService.createGodotRelationship({
              repo_id: repositoryId,
              relationship_type: GodotRelationshipType.NODE_HIERARCHY,
              from_entity_type: GodotEntityType.NODE,
              from_entity_id: parentNode.id,
              to_entity_type: GodotEntityType.NODE,
              to_entity_id: node.id,
              confidence: 0.9,
              metadata: {
                parentName: parentNode.nodeName,
                childName: node.nodeName,
                parentType: parentNode.nodeType,
                childType: node.nodeType
              }
            });

            relationships.push(relationship);

            logger.debug('Created node hierarchy relationship', {
              parentNode: parentNode.nodeName,
              childNode: node.nodeName
            });
          } catch (error) {
            logger.warn('Failed to create node hierarchy relationship', {
              parentId: parentNode.id,
              childId: node.id,
              error: (error as Error).message
            });
          }
        }
      }
    }

    return relationships;
  }

  /**
   * Build scene-resource reference relationships
   */
  private async buildSceneResourceRelationships(
    repositoryId: number,
    scenes: any[]
  ): Promise<GodotRelationship[]> {
    const relationships: GodotRelationship[] = [];

    for (const scene of scenes) {
      if (scene.resources) {
        for (const resource of scene.resources) {
          try {
            const relationship = await this.dbService.createGodotRelationship({
              repo_id: repositoryId,
              relationship_type: GodotRelationshipType.SCENE_RESOURCE_REFERENCE,
              from_entity_type: GodotEntityType.SCENE,
              from_entity_id: scene.id,
              to_entity_type: GodotEntityType.SCENE, // Resource references are stored as metadata
              to_entity_id: scene.id, // Self-reference with metadata
              resource_id: resource.id,
              confidence: 0.85,
              metadata: {
                resourcePath: resource.path,
                resourceType: resource.type,
                resourceId: resource.id
              }
            });

            relationships.push(relationship);

            logger.debug('Created scene-resource relationship', {
              scenePath: scene.scenePath,
              resourcePath: resource.path,
              resourceType: resource.type
            });
          } catch (error) {
            logger.warn('Failed to create scene-resource relationship', {
              sceneId: scene.id,
              resourceId: resource.id,
              error: (error as Error).message
            });
          }
        }
      }
    }

    return relationships;
  }

  /**
   * Build autoload reference relationships
   */
  private async buildAutoloadRelationships(
    repositoryId: number,
    autoloads: any[],
    scripts: any[]
  ): Promise<GodotRelationship[]> {
    const relationships: GodotRelationship[] = [];

    for (const autoload of autoloads) {
      // Find the script that this autoload references
      const scriptEntity = scripts.find(s =>
        s.filePath === autoload.scriptPath ||
        s.filePath.endsWith(autoload.scriptPath)
      );

      if (scriptEntity) {
        try {
          const relationship = await this.dbService.createGodotRelationship({
            repo_id: repositoryId,
            relationship_type: GodotRelationshipType.AUTOLOAD_REFERENCE,
            from_entity_type: GodotEntityType.AUTOLOAD,
            from_entity_id: autoload.id,
            to_entity_type: GodotEntityType.SCRIPT,
            to_entity_id: scriptEntity.id,
            confidence: 0.98,
            metadata: {
              autoloadName: autoload.autoloadName,
              scriptPath: autoload.scriptPath,
              className: scriptEntity.className
            }
          });

          relationships.push(relationship);

          logger.debug('Created autoload-script relationship', {
            autoloadName: autoload.autoloadName,
            scriptPath: scriptEntity.filePath
          });
        } catch (error) {
          logger.warn('Failed to create autoload-script relationship', {
            autoloadId: autoload.id,
            scriptId: scriptEntity.id,
            error: (error as Error).message
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Query relationships by type and entity
   */
  async getRelationships(
    repositoryId: number,
    entityType: GodotEntityType,
    entityId: number,
    relationshipType?: GodotRelationshipType
  ): Promise<GodotRelationship[]> {
    try {
      let relationships = await this.dbService.getGodotRelationshipsByEntity(
        entityType,
        entityId,
        'both'
      );

      // Filter by repository and relationship type if specified
      relationships = relationships.filter(rel => rel.repo_id === repositoryId);

      if (relationshipType) {
        relationships = relationships.filter(rel => rel.relationship_type === relationshipType);
      }

      return relationships;
    } catch (error) {
      logger.error('Failed to get Godot relationships', {
        repositoryId,
        entityType,
        entityId,
        relationshipType,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Get all scenes that use a specific script
   */
  async getScenesUsingScript(repositoryId: number, scriptId: number): Promise<any[]> {
    try {
      const relationships = await this.dbService.getGodotRelationshipsByEntity(
        GodotEntityType.SCRIPT,
        scriptId,
        'to'
      );

      const sceneIds = relationships
        .filter(r =>
          r.repo_id === repositoryId &&
          r.relationship_type === GodotRelationshipType.SCENE_SCRIPT_ATTACHMENT &&
          r.from_entity_type === GodotEntityType.SCENE
        )
        .map(r => r.from_entity_id);

      const scenes = [];
      for (const sceneId of sceneIds) {
        const scene = await this.dbService.getGodotScene(sceneId);
        if (scene) scenes.push(scene);
      }

      return scenes;
    } catch (error) {
      logger.error('Failed to get scenes using script', {
        repositoryId,
        scriptId,
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * Get node hierarchy for a scene
   */
  async getNodeHierarchy(repositoryId: number, sceneId: number): Promise<any[]> {
    try {
      const relationships = await this.dbService.getGodotRelationshipsByType(
        repositoryId,
        GodotRelationshipType.NODE_HIERARCHY
      );

      return relationships.filter(r =>
        r.from_entity_type === GodotEntityType.NODE &&
        r.to_entity_type === GodotEntityType.NODE
      );
    } catch (error) {
      logger.error('Failed to get node hierarchy', {
        repositoryId,
        sceneId,
        error: (error as Error).message
      });
      return [];
    }
  }
}