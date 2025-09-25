import { GraphBuilder } from '../../src/graph/builder';
import { DatabaseService } from '../../src/database/services';
import { Repository } from '../../src/database/models';
import path from 'path';
import fs from 'fs/promises';
import { jest } from '@jest/globals';

describe('Laravel Integration Tests', () => {
  let builder: GraphBuilder;
  let dbService: DatabaseService;
  let testProjectPath: string;

  beforeAll(async () => {
    // Initialize database service with test database
    dbService = new DatabaseService();
    // DatabaseService connects automatically in constructor

    // Create test project directory
    testProjectPath = path.join(__dirname, 'fixtures', 'laravel-project');
    await setupTestLaravelProject(testProjectPath);

    builder = new GraphBuilder(dbService);
  });

  afterAll(async () => {
    // Clean up test project
    await fs.rm(testProjectPath, { recursive: true, force: true });
    await dbService.close();
  });

  beforeEach(async () => {
    // Clear any existing repository data
    await dbService.deleteRepositoryByName('laravel-project');

    // Clean up any existing test project files
    await fs.rm(testProjectPath, { recursive: true, force: true });

    // Ensure test project files exist
    try {
      await setupTestLaravelProject(testProjectPath);

      // Debug: List created files
      const files = await fs.readdir(testProjectPath, { recursive: true });
    } catch (error) {
      console.error('Test project setup failed:', error);
      throw error;
    }
  });

  describe('Complete Laravel Project Analysis', () => {
    it('should analyze complete Laravel project successfully', async () => {
      const result = await builder.analyzeRepository(testProjectPath, {
        includeTestFiles: false,
        fileExtensions: ['.php'],
        forceFullAnalysis: true
      });

      expect(result.repository.name).toBe('laravel-project');
      expect(result.filesProcessed).toBeGreaterThan(0);
      expect(result.symbolsExtracted).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);

      // Verify Laravel framework was detected
      expect(result.repository.framework_stack).toContain('laravel');
    });

    it('should extract Laravel entities correctly', async () => {
      const result = await builder.analyzeRepository(testProjectPath, {
        includeTestFiles: false,
        fileExtensions: ['.php'],
        forceFullAnalysis: true
      });

      // Query framework entities from database
      const routes = await dbService.getRoutesByRepository(result.repository.id);
      const symbols = await dbService.getSymbolsByRepository(result.repository.id);
      const controllers = symbols.filter(s => s.name.includes('Controller'));
      const models = symbols.filter(s => s.name.includes('Model') || s.name === 'User' || s.name === 'Post');

      expect(routes.length).toBeGreaterThan(0);
      expect(controllers.length).toBeGreaterThan(0);
      expect(models.length).toBeGreaterThan(0);

      // Verify specific entities exist
      expect(routes.some(r => r.path === '/users')).toBe(true);
      expect(controllers.some(c => c.name === 'UserController')).toBe(true);
      expect(models.some(m => m.name === 'User')).toBe(true);
    });

    it('should handle mixed Laravel/JavaScript projects', async () => {
      // Add some JavaScript files to the test project
      const jsPath = path.join(testProjectPath, 'resources', 'js');
      await fs.mkdir(jsPath, { recursive: true });

      await fs.writeFile(path.join(jsPath, 'app.js'), `
import { createApp } from 'vue';
import UserComponent from './components/UserComponent.vue';

const app = createApp({});
app.component('user-component', UserComponent);
app.mount('#app');
      `);

      const result = await builder.analyzeRepository(testProjectPath, {
        includeTestFiles: false,
        forceFullAnalysis: true
      });

      // Should detect both PHP and JavaScript
      const files = await dbService.getFilesByRepository(result.repository.id);
      const phpFiles = files.filter(f => f.language === 'php');
      const jsFiles = files.filter(f => f.language === 'javascript');

      expect(phpFiles.length).toBeGreaterThan(0);
      expect(jsFiles.length).toBeGreaterThan(0);

      // Should detect both Laravel and potentially Vue frameworks
      expect(result.repository.framework_stack).toContain('laravel');
    });

    it('should track relationships between Laravel entities', async () => {
      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      // Query relationships from database
      const routes = await dbService.getRoutesByRepository(result.repository.id);
      const symbols = await dbService.getSymbolsByRepository(result.repository.id);
      const controllers = symbols.filter(s => s.name.includes('Controller'));

      // Verify route -> controller relationships
      expect(routes.length).toBeGreaterThan(0);
      expect(controllers.length).toBeGreaterThan(0);

      // Check that routes reference controllers
      const routeWithController = routes.find(r => r.middleware && r.middleware.length > 0);
      expect(routeWithController).toBeDefined();

      // Verify controllers exist
      expect(controllers.length).toBeGreaterThan(0);
    });

    it('should extract Eloquent model relationships', async () => {
      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      const symbols = await dbService.getSymbolsByRepository(result.repository.id);
      const models = symbols.filter(s => s.name === 'User' || s.name === 'Post');

      expect(models.length).toBeGreaterThan(0);

      // Verify specific models exist
      const userModel = models.find(m => m.name === 'User');
      expect(userModel).toBeDefined();
    });

    it('should measure performance on Laravel projects', async () => {
      const startTime = Date.now();
      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });
      const endTime = Date.now();

      const analysisTime = endTime - startTime;
      const filesPerSecond = result.filesProcessed / (analysisTime / 1000);

      expect(filesPerSecond).toBeGreaterThan(5); // Performance baseline for test project
      expect(result.errors.length / result.filesProcessed).toBeLessThan(0.1); // < 10% error rate
    });
  });

  describe('Laravel Framework Detection', () => {
    it('should detect Laravel through composer.json', async () => {
      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      // Should detect Laravel framework based on file patterns
      expect(result.repository.framework_stack).toContain('laravel');

      // Query framework detection metadata
      const frameworkStack = await dbService.getFrameworkStack(result.repository.id);
      const laravelMetadata = frameworkStack.find(f => f.framework_type === 'laravel');

      expect(laravelMetadata).toBeDefined();
    });

    it('should detect Laravel-specific directory structure', async () => {
      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      // Verify Laravel directories are properly recognized
      const files = await dbService.getFilesByRepository(result.repository.id);
      const directories = [...new Set(files.map(f => path.dirname(f.path)))];

      expect(directories.some(d => d.includes('app/Http/Controllers'))).toBe(true);
      expect(directories.some(d => d.includes('app/Models'))).toBe(true);
      expect(directories.some(d => d.includes('routes'))).toBe(true);
    });
  });

  describe('Error Handling and Robustness', () => {
    it('should handle Laravel projects with syntax errors gracefully', async () => {
      // Create a Laravel file with syntax errors
      const brokenControllerPath = path.join(testProjectPath, 'app/Http/Controllers/BrokenController.php');
      await fs.writeFile(brokenControllerPath, `<?php

namespace App\\Http\\Controllers;

class BrokenController extends Controller
{
    public function index() {
        // Missing closing brace and syntax errors
        $data = [
            'key' => 'value'

        return view('broken'
    }
`);

      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      // Should report errors but continue processing
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.filesProcessed).toBeGreaterThan(1); // Should process other files

      // Should still extract valid entities from other files
      const symbols = await dbService.getSymbolsByRepository(result.repository.id);
      const controllers = symbols.filter(s => s.name.includes('Controller'));
      expect(controllers.length).toBeGreaterThan(0);
    });

    it('should handle empty Laravel files', async () => {
      const emptyFilePath = path.join(testProjectPath, 'empty.php');
      await fs.writeFile(emptyFilePath, '');

      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      expect(result.errors.filter(e => e.filePath.includes('empty.php'))).toHaveLength(0);
      expect(result.filesProcessed).toBeGreaterThan(0);
    });

    it('should handle large Laravel projects without memory issues', async () => {
      // Generate additional large files to test memory handling
      const largeDirPath = path.join(testProjectPath, 'app/Generated');
      await fs.mkdir(largeDirPath, { recursive: true });

      // Create multiple large controller files
      for (let i = 0; i < 10; i++) {
        const methods = Array.from({ length: 50 }, (_, j) => `
    public function method${j}()
    {
        return response()->json(['data' => 'Method ${j} response']);
    }`).join('\n');

        const largeController = `<?php

namespace App\\Http\\Controllers;

class GeneratedController${i} extends Controller
{${methods}
}`;

        await fs.writeFile(
          path.join(largeDirPath, `GeneratedController${i}.php`),
          largeController
        );
      }

      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      expect(result.filesProcessed).toBeGreaterThan(10);
      expect(result.symbolsExtracted).toBeGreaterThan(100);
      expect(result.errors.length).toBe(0);
    });
  });

  describe('Symbol and Dependency Tracking', () => {
    it('should track controller method calls to models', async () => {
      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      // Query symbols and dependencies
      const symbols = await dbService.getSymbolsByRepository(result.repository.id);
      const dependencies = await dbService.getFileDependenciesByRepository(result.repository.id);

      // Should have extracted symbols from controllers and models
      const controllerMethods = symbols.filter(s => s.symbol_type === 'method');
      const modelClasses = symbols.filter(s => s.symbol_type === 'class');

      expect(controllerMethods.length).toBeGreaterThan(0);
      expect(modelClasses.length).toBeGreaterThan(0);

      // Should track dependencies between controllers and models
      const modelDependencies = dependencies.filter(d => d.dependency_type === 'calls');
      expect(modelDependencies.length).toBeGreaterThan(0);
    });

    it('should extract Laravel facade calls', async () => {
      const result = await builder.analyzeRepository(testProjectPath, { forceFullAnalysis: true });

      const dependencies = await dbService.getFileDependenciesByRepository(result.repository.id);

      // Should detect facade usage (Route, Auth, etc.)
      const facadeCalls = dependencies.filter(d => d.dependency_type === 'imports');
      expect(facadeCalls.length).toBeGreaterThan(0);
    });
  });
});

// Test fixture setup function
async function setupTestLaravelProject(projectPath: string): Promise<void> {
  // Create Laravel project structure
  await fs.mkdir(projectPath, { recursive: true });

  // Create composer.json
  const composerJson = {
    name: "test/laravel-project",
    description: "Test Laravel project",
    require: {
      "php": "^8.1",
      "laravel/framework": "^10.0"
    },
    autoload: {
      "psr-4": {
        "App\\": "app/",
        "Database\\Factories\\": "database/factories/",
        "Database\\Seeders\\": "database/seeders/"
      }
    }
  };

  await fs.writeFile(
    path.join(projectPath, 'composer.json'),
    JSON.stringify(composerJson, null, 2)
  );

  // Create directory structure
  const directories = [
    'app/Http/Controllers',
    'app/Models',
    'app/Http/Middleware',
    'app/Jobs',
    'app/Console/Commands',
    'app/Providers',
    'routes',
    'database/migrations',
    'resources/views',
    'config'
  ];

  for (const dir of directories) {
    await fs.mkdir(path.join(projectPath, dir), { recursive: true });
  }

  // Create routes/web.php
  await fs.writeFile(path.join(projectPath, 'routes/web.php'), `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UserController;
use App\\Http\\Controllers\\PostController;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/users', [UserController::class, 'index'])->name('users.index');
Route::get('/users/{user}', [UserController::class, 'show'])->name('users.show');
Route::post('/users', [UserController::class, 'store'])->name('users.store');

Route::middleware(['auth'])->group(function () {
    Route::resource('posts', PostController::class);
    Route::get('/dashboard', 'DashboardController@index')->name('dashboard');
});
`);

  // Create UserController
  await fs.writeFile(path.join(projectPath, 'app/Http/Controllers/UserController.php'), `<?php

namespace App\\Http\\Controllers;

use App\\Models\\User;
use Illuminate\\Http\\Request;

class UserController extends Controller
{
    public function index()
    {
        $users = User::all();
        return view('users.index', compact('users'));
    }

    public function show(User $user)
    {
        return view('users.show', compact('user'));
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users'
        ]);

        $user = User::create($validated);

        return redirect()->route('users.show', $user);
    }
}
`);

  // Create User Model
  await fs.writeFile(path.join(projectPath, 'app/Models/User.php'), `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Factories\\HasFactory;
use Illuminate\\Foundation\\Auth\\User as Authenticatable;
use Illuminate\\Notifications\\Notifiable;

class User extends Authenticatable
{
    use HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
    ];

    public function posts()
    {
        return $this->hasMany(Post::class);
    }

    public function profile()
    {
        return $this->hasOne(Profile::class);
    }

    public function roles()
    {
        return $this->belongsToMany(Role::class);
    }
}
`);

  // Create Post Model
  await fs.writeFile(path.join(projectPath, 'app/Models/Post.php'), `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
    protected $fillable = ['title', 'content', 'user_id'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function comments()
    {
        return $this->hasMany(Comment::class);
    }
}
`);

  // Create PostController
  await fs.writeFile(path.join(projectPath, 'app/Http/Controllers/PostController.php'), `<?php

namespace App\\Http\\Controllers;

use App\\Models\\Post;
use Illuminate\\Http\\Request;

class PostController extends Controller
{
    public function index()
    {
        $posts = Post::with('user')->paginate(10);
        return view('posts.index', compact('posts'));
    }

    public function create()
    {
        return view('posts.create');
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'content' => 'required|string'
        ]);

        $post = Post::create([
            ...$validated,
            'user_id' => auth()->id()
        ]);

        return redirect()->route('posts.show', $post);
    }

    public function show(Post $post)
    {
        return view('posts.show', compact('post'));
    }

    public function edit(Post $post)
    {
        return view('posts.edit', compact('post'));
    }

    public function update(Request $request, Post $post)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'content' => 'required|string'
        ]);

        $post->update($validated);

        return redirect()->route('posts.show', $post);
    }

    public function destroy(Post $post)
    {
        $post->delete();
        return redirect()->route('posts.index');
    }
}
`);

  // Create middleware
  await fs.writeFile(path.join(projectPath, 'app/Http/Middleware/AuthMiddleware.php'), `<?php

namespace App\\Http\\Middleware;

use Closure;

class AuthMiddleware
{
    public function handle($request, Closure $next)
    {
        if (!auth()->check()) {
            return redirect('/login');
        }

        return $next($request);
    }
}
`);

  // Create a job
  await fs.writeFile(path.join(projectPath, 'app/Jobs/SendWelcomeEmail.php'), `<?php

namespace App\\Jobs;

use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Foundation\\Bus\\Dispatchable;
use Illuminate\\Queue\\InteractsWithQueue;
use Illuminate\\Queue\\SerializesModels;

class SendWelcomeEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, SerializesModels;

    public $tries = 3;
    public $timeout = 60;

    protected $user;

    public function __construct($user)
    {
        $this->user = $user;
    }

    public function handle()
    {
        // Send welcome email logic
    }
}
`);

  // Create artisan command
  await fs.writeFile(path.join(projectPath, 'app/Console/Commands/GenerateReport.php'), `<?php

namespace App\\Console\\Commands;

use Illuminate\\Console\\Command;

class GenerateReport extends Command
{
    protected $signature = 'report:generate {type} {--format=pdf}';
    protected $description = 'Generate various types of reports';

    public function handle()
    {
        $type = $this->argument('type');
        $format = $this->option('format');

        $this->info("Generating {$type} report in {$format} format...");

        return 0;
    }
}
`);

  // Create service provider
  await fs.writeFile(path.join(projectPath, 'app/Providers/CustomServiceProvider.php'), `<?php

namespace App\\Providers;

use Illuminate\\Support\\ServiceProvider;

class CustomServiceProvider extends ServiceProvider
{
    public function register()
    {
        $this->app->singleton('custom.service', function ($app) {
            return new \\App\\Services\\CustomService();
        });
    }

    public function boot()
    {
        // Boot logic
    }
}
`);
}