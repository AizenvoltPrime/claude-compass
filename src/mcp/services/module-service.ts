import { DatabaseService } from '../../database/services';
import { IdentifyModulesArgs } from '../types';
import { validateIdentifyModulesArgs } from '../validators';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('module-service');

export class ModuleService {
  constructor(
    private dbService: DatabaseService,
    private getDefaultRepoId: () => number | undefined
  ) {}

  async identifyModules(args: any) {
    try {
      const validatedArgs = validateIdentifyModulesArgs(args);

      const repoId = validatedArgs.repo_id || this.getDefaultRepoId();
      if (!repoId) {
        throw new Error('repo_id is required when no default repository is set');
      }

      const minModuleSize = validatedArgs.min_module_size || 3;
      const resolution = validatedArgs.resolution || 1.0;

      const { communityDetector } = await import('../../graph/community-detector');
      const result = await communityDetector.detectModules(repoId, {
        minModuleSize,
        resolution,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                modules: result.modules.map(module => ({
                  id: module.id,
                  name: module.name,
                  symbol_count: module.symbols.length,
                  symbols: module.symbols,
                  cohesion: {
                    internal_edges: module.internalEdges,
                    external_edges: module.externalEdges,
                    modularity: module.modularity,
                  },
                  files: module.files,
                  frameworks: module.frameworks,
                })),
                summary: {
                  total_modules: result.modules.length,
                  total_modularity: result.totalModularity,
                  execution_time_ms: result.executionTimeMs,
                },
                usage_guidance:
                  'Use module IDs to focus analysis on specific architectural boundaries. ' +
                  'High modularity (>0.7) indicates well-separated concerns. ' +
                  'Low external_edges suggest good encapsulation.',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('identifyModules failed', {
        error: (error as Error).message,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: (error as Error).message,
                args,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
