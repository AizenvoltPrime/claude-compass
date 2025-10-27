import type { Knex } from 'knex';
import * as RepositoryService from '../database/services/repository-service';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('mcp-resources');

export class McpResources {
  private db: Knex;
  private logger: any;
  private sessionId?: string;

  constructor(db: Knex, sessionId?: string) {
    this.db = db;
    this.sessionId = sessionId;
    this.logger = logger;
  }

  async readResource(uri: string) {

    const [protocol, resource] = uri.split('://');

    switch (protocol) {
      case 'repo':
        return await this.handleRepoResource(resource);

      case 'graph':
        return await this.handleGraphResource(resource);

      default:
        throw new Error(`Unknown protocol: ${protocol}`);
    }
  }

  private async handleRepoResource(resource: string) {
    switch (resource) {
      case 'repositories':
        return await this.getRepositoriesList();

      default:
        throw new Error(`Unknown repo resource: ${resource}`);
    }
  }

  private async handleGraphResource(resource: string): Promise<never> {
    throw new Error(`Graph resources are no longer exposed via MCP. Use specific tools instead (search_code, who_calls, etc.)`);
  }

  private async getRepositoriesList() {
    try {
      // Get all repositories from the database
      const repositories = await RepositoryService.getAllRepositories(this.db);


      return {
        contents: [
          {
            type: 'text',
            uri: 'repo://repositories',
            text: JSON.stringify({
              repositories: repositories.map(repo => ({
                id: repo.id,
                name: repo.name,
                path: repo.path,
                language_primary: repo.language_primary,
                framework_stack: repo.framework_stack,
                last_indexed: repo.last_indexed,
                git_hash: repo.git_hash,
                created_at: repo.created_at,
                updated_at: repo.updated_at,
              })),
              total_count: repositories.length,
              generated_at: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Failed to get repositories list', { error: (error as Error).message });

      return {
        contents: [
          {
            type: 'text',
            uri: 'repo://repositories',
            text: JSON.stringify({
              error: 'Failed to retrieve repositories',
              message: (error as Error).message,
              repositories: [],
              total_count: 0,
            }, null, 2),
          },
        ],
      };
    }
  }

}