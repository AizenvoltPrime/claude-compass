import { DatabaseService } from '../../database/services';

export class LaravelSearch {
  constructor(private dbService: DatabaseService) {}

  async searchRoutes(query: string, repoIds: number[], framework?: string): Promise<any[]> {
    const routes = [];

    for (const repoId of repoIds) {
      const frameworkType = framework || 'laravel';
      const repoRoutes = await this.dbService.getRoutesByFramework(repoId, frameworkType);

      const matchingRoutes = repoRoutes.filter(
        route =>
          route.path?.toLowerCase().includes(query.toLowerCase()) ||
          route.method?.toLowerCase().includes(query.toLowerCase())
      );

      routes.push(
        ...matchingRoutes.map(route => ({
          id: route.id,
          name: route.path,
          entity_type: 'route',
          symbol_type: 'route',
          start_line: 0,
          end_line: 0,
          is_exported: true,
          visibility: 'public',
          signature: `${route.method} ${route.path}`,
          file: {
            id: route.repo_id,
            path: route.path,
            language: route.framework_type === 'laravel' ? 'php' : 'javascript',
          },
        }))
      );
    }

    return routes;
  }

  async searchModels(query: string, repoIds: number[]): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      const isClass = symbol.symbol_type === 'class';
      const path = symbol.file?.path || '';
      const signature = symbol.signature || '';
      const name = symbol.name || '';

      const isInModelsDirectory =
        path.includes('/Models/') ||
        path.includes('\\Models\\') ||
        path.includes('/models/') ||
        path.includes('\\models\\') ||
        /[\\/\\][Mm]odels[\\/\\]/.test(path) ||
        path.endsWith('/Models') ||
        path.endsWith('\\Models') ||
        path.endsWith('/models') ||
        path.endsWith('\\models') ||
        /\/app\/[^\/]*Models\//i.test(path);

      const hasModelSignature =
        signature.includes('extends Model') ||
        signature.includes('extends Authenticatable') ||
        signature.includes('extends Illuminate\\Database\\Eloquent\\Model') ||
        signature.includes('extends \\Illuminate\\Database\\Eloquent\\Model') ||
        signature.includes('use Illuminate\\Database\\Eloquent\\Model') ||
        signature.includes('use Authenticatable') ||
        signature.includes('use SoftDeletes');

      const hasModelName =
        name.endsWith('Model') || (isClass && /^[A-Z][a-zA-Z]*$/.test(name) && isInModelsDirectory);

      return isClass && (isInModelsDirectory || hasModelSignature || hasModelName);
    });
  }

  async searchControllers(query: string, repoIds: number[]): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      const isClass = symbol.symbol_type === 'class' || symbol.symbol_type === 'method';
      const path = symbol.file?.path || '';
      const signature = symbol.signature || '';
      const name = symbol.name || '';

      const isInControllersDirectory =
        path.includes('/Controllers/') ||
        path.includes('\\Controllers\\') ||
        path.includes('/controllers/') ||
        path.includes('\\controllers\\') ||
        /[\\/\\][Cc]ontrollers[\\/\\]/.test(path) ||
        path.includes('/Http/Controllers/') ||
        path.includes('\\Http\\Controllers\\') ||
        /\/app\/Http\/Controllers\//i.test(path) ||
        path.endsWith('/Controllers') ||
        path.endsWith('\\Controllers') ||
        path.endsWith('/controllers') ||
        path.endsWith('\\controllers');

      const hasControllerSignature =
        signature.includes('extends Controller') ||
        signature.includes('extends BaseController') ||
        signature.includes('extends Illuminate\\Routing\\Controller') ||
        signature.includes('extends \\Illuminate\\Routing\\Controller') ||
        signature.includes('use Illuminate\\Routing\\Controller') ||
        signature.includes('use Controller') ||
        signature.includes('use AuthorizesRequests') ||
        signature.includes('use DispatchesJobs') ||
        signature.includes('use ValidatesRequests');

      const hasControllerName =
        name.toLowerCase().includes('controller') ||
        name.endsWith('Controller') ||
        (isClass && /Controller$/.test(name));

      const isControllerMethod = symbol.symbol_type === 'method' && isInControllersDirectory;

      return (
        (isClass && (isInControllersDirectory || hasControllerSignature || hasControllerName)) ||
        isControllerMethod
      );
    });
  }

  async searchJobs(query: string, repoIds: number[]): Promise<any[]> {
    const symbols = await this.dbService.searchSymbols(query, repoIds?.[0]);

    return symbols.filter(symbol => {
      const isClass = symbol.symbol_type === 'class';
      const path = symbol.file?.path || '';
      const signature = symbol.signature || '';
      const name = symbol.name || '';

      const isInJobsDirectory =
        path.includes('/jobs/') ||
        path.includes('\\jobs\\') ||
        path.includes('/Jobs/') ||
        path.includes('\\Jobs\\') ||
        /[\\/\\][Jj]obs[\\/\\]/.test(path) ||
        /\/app\/Jobs\//i.test(path) ||
        path.endsWith('/Jobs') ||
        path.endsWith('\\Jobs') ||
        path.endsWith('/jobs') ||
        path.endsWith('\\jobs');

      const hasJobSignature =
        signature.includes('implements ShouldQueue') ||
        signature.includes('implements \\ShouldQueue') ||
        signature.includes('implements Illuminate\\Contracts\\Queue\\ShouldQueue') ||
        signature.includes('use ShouldQueue') ||
        signature.includes('use Illuminate\\Contracts\\Queue\\ShouldQueue') ||
        signature.includes('use Dispatchable') ||
        signature.includes('use InteractsWithQueue') ||
        signature.includes('use Queueable') ||
        signature.includes('use SerializesModels');

      const hasJobName =
        name.toLowerCase().includes('job') ||
        name.endsWith('Job') ||
        /Job$/.test(name) ||
        /Process[A-Z]/.test(name) ||
        /Send[A-Z]/.test(name) ||
        /Handle[A-Z]/.test(name) ||
        /Execute[A-Z]/.test(name);

      return isClass && (isInJobsDirectory || hasJobSignature || hasJobName);
    });
  }
}
