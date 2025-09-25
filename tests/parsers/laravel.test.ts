import { LaravelParser } from '../../src/parsers/laravel';
import Parser from 'tree-sitter';
import { php as PHP } from 'tree-sitter-php';
import { jest } from '@jest/globals';
import type { LaravelRoute, LaravelController, EloquentModel, LaravelMiddleware, LaravelJob, LaravelServiceProvider, LaravelCommand } from '../../src/parsers/laravel';

describe('LaravelParser', () => {
  let parser: LaravelParser;
  let treeParser: Parser;

  beforeEach(() => {
    treeParser = new Parser();
    treeParser.setLanguage(PHP);
    parser = new LaravelParser(treeParser);
  });

  afterEach(() => {
    treeParser = null as any;
    parser = null as any;
  });

  describe('Route Extraction', () => {
    it('should extract simple routes from web.php', async () => {
      const code = `<?php

use Illuminate\\Support\\Facades\\Route;
use App\\Http\\Controllers\\UserController;

Route::get('/users', [UserController::class, 'index']);
Route::post('/users', 'UserController@store')->middleware('auth');
Route::group(['prefix' => 'admin'], function () {
    Route::resource('posts', PostController::class);
});`;

      const result = await parser.parseFile('/project/routes/web.php', code);
      const routes = result.frameworkEntities!.filter(e => e.type === 'route') as LaravelRoute[];

      expect(routes).toHaveLength(3);
      expect(routes[0]).toMatchObject({
        path: '/users',
        method: 'GET',
        controller: 'UserController',
        action: 'index'
      });
    });

    it('should extract route middleware', async () => {
      const code = `<?php

Route::get('/dashboard', 'DashboardController@index')
  ->middleware(['auth', 'verified'])
  ->name('dashboard');`;

      const result = await parser.parseFile('/project/routes/web.php', code);
      const route = result.frameworkEntities![0] as LaravelRoute;

      expect(route.middleware).toEqual(['auth', 'verified']);
      expect(route.routeName).toBe('dashboard');
    });

    it('should handle route groups with middleware', async () => {
      const code = `<?php

Route::middleware(['auth'])->group(function () {
    Route::get('/profile', 'ProfileController@show');
    Route::put('/profile', 'ProfileController@update');
});`;

      const result = await parser.parseFile('/project/routes/web.php', code);
      const routes = result.frameworkEntities!.filter(e => e.type === 'route') as LaravelRoute[];

      expect(routes).toHaveLength(2);
      routes.forEach(route => {
        expect(route.middleware).toContain('auth');
      });
    });

    it('should parse resource routes', async () => {
      const code = `<?php

Route::resource('users', UserController::class);
Route::apiResource('posts', PostController::class);`;

      const result = await parser.parseFile('/project/routes/web.php', code);
      const routes = result.frameworkEntities!.filter(e => e.type === 'route') as LaravelRoute[];

      expect(routes.length).toBeGreaterThan(0);
      expect(routes.some(r => r.metadata.isResource)).toBe(true);
    });

    it('should parse route parameters', async () => {
      const code = `<?php

Route::get('/users/{id}', 'UserController@show');
Route::get('/posts/{post}/comments/{comment}', 'CommentController@show');
Route::get('/categories/{category?}', 'CategoryController@show');`;

      const result = await parser.parseFile('/project/routes/web.php', code);
      const routes = result.frameworkEntities!.filter(e => e.type === 'route') as LaravelRoute[];

      expect(routes).toHaveLength(3);

      const userRoute = routes.find(r => r.path === '/users/{id}');
      expect(userRoute!.metadata.parameters).toContain('id');

      const commentRoute = routes.find(r => r.path === '/posts/{post}/comments/{comment}');
      expect(commentRoute!.metadata.parameters).toContain('post');
      expect(commentRoute!.metadata.parameters).toContain('comment');
    });
  });

  describe('Controller Extraction', () => {
    it('should extract controller classes with actions', async () => {
      const code = `<?php

namespace App\\Http\\Controllers;

use Illuminate\\Http\\Request;

class UserController extends Controller
{
    public function index()
    {
        return view('users.index');
    }

    public function store(Request $request)
    {
        return redirect()->route('users.index');
    }

    private function validateUser($data)
    {
        // private method
    }
}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/UserController.php', code);
      const controller = result.frameworkEntities!.find(e => e.type === 'controller') as LaravelController;

      expect(controller.name).toBe('UserController');
      expect(controller.actions).toEqual(['index', 'store']);
      expect(controller.actions).not.toContain('validateUser'); // private methods excluded
    });

    it('should detect resource controllers', async () => {
      const code = `<?php

class PostController extends Controller
{
    public function index() {}
    public function create() {}
    public function store() {}
    public function show() {}
    public function edit() {}
    public function update() {}
    public function destroy() {}
}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/PostController.php', code);
      const controller = result.frameworkEntities!.find(e => e.type === 'controller') as LaravelController;

      expect(controller.resourceController).toBe(true);
    });

    it('should extract controller middleware', async () => {
      const code = `<?php

class AdminController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth');
        $this->middleware('admin')->except(['index']);
    }

    public function index() {}
    public function dashboard() {}
}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/AdminController.php', code);
      const controller = result.frameworkEntities!.find(e => e.type === 'controller') as LaravelController;

      expect(controller.middleware).toContain('auth');
      expect(controller.middleware).toContain('admin');
    });

    it('should detect API controllers', async () => {
      const code = `<?php

namespace App\\Http\\Controllers\\Api;

use App\\Http\\Controllers\\Controller;

class ApiUserController extends Controller
{
    public function index()
    {
        return response()->json(['users' => []]);
    }

    public function show($id)
    {
        return response()->json(['user' => $user]);
    }
}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/Api/ApiUserController.php', code);
      const controller = result.frameworkEntities!.find(e => e.type === 'controller') as LaravelController;

      expect(controller.name).toBe('ApiUserController');
      expect(controller.metadata.isApiController).toBe(true);
    });
  });

  describe('Model Extraction', () => {
    it('should extract Eloquent models with relationships', async () => {
      const code = `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class User extends Model
{
    protected $fillable = ['name', 'email', 'password'];
    protected $hidden = ['password', 'remember_token'];

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
}`;

      const result = await parser.parseFile('/project/app/Models/User.php', code);
      const model = result.frameworkEntities!.find(e => e.type === 'model') as EloquentModel;

      expect(model.name).toBe('User');
      expect(model.fillable).toEqual(['name', 'email', 'password']);
      expect(model.relationships).toHaveLength(3);

      const postsRel = model.relationships.find(r => r.name === 'posts');
      expect(postsRel).toMatchObject({
        type: 'hasMany',
        relatedModel: 'Post'
      });
    });

    it('should extract model metadata', async () => {
      const code = `<?php

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Post extends Model
{
    use SoftDeletes;

    protected $table = 'blog_posts';
    public $timestamps = false;
    protected $guarded = ['id'];
    protected $casts = ['published_at' => 'datetime'];
}`;

      const result = await parser.parseFile('/project/app/Models/Post.php', code);
      const model = result.frameworkEntities!.find(e => e.type === 'model') as EloquentModel;

      expect(model.tableName).toBe('blog_posts');
      expect(model.metadata.timestamps).toBe(false);
      expect(model.metadata.softDeletes).toBe(true);
      expect(model.metadata.casts).toEqual({ published_at: 'datetime' });
    });

    it('should detect model scopes', async () => {
      const code = `<?php

class User extends Model
{
    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function scopeVerified($query)
    {
        return $query->whereNotNull('email_verified_at');
    }
}`;

      const result = await parser.parseFile('/project/app/Models/User.php', code);
      const model = result.frameworkEntities!.find(e => e.type === 'model') as EloquentModel;

      expect(model.metadata.scopes).toContain('active');
      expect(model.metadata.scopes).toContain('verified');
    });

    it('should detect model mutators and accessors', async () => {
      const code = `<?php

class User extends Model
{
    public function getFirstNameAttribute($value)
    {
        return ucfirst($value);
    }

    public function setPasswordAttribute($value)
    {
        $this->attributes['password'] = bcrypt($value);
    }
}`;

      const result = await parser.parseFile('/project/app/Models/User.php', code);
      const model = result.frameworkEntities!.find(e => e.type === 'model') as EloquentModel;

      expect(model.metadata.accessors).toContain('first_name');
      expect(model.metadata.mutators).toContain('password');
    });

    it('should extract complex relationships', async () => {
      const code = `<?php

class User extends Model
{
    public function posts()
    {
        return $this->hasMany(Post::class, 'author_id', 'id');
    }

    public function roles()
    {
        return $this->belongsToMany(Role::class, 'user_roles', 'user_id', 'role_id');
    }

    public function latestPost()
    {
        return $this->hasOne(Post::class)->latestOfMany();
    }

    public function comments()
    {
        return $this->hasManyThrough(Comment::class, Post::class);
    }
}`;

      const result = await parser.parseFile('/project/app/Models/User.php', code);
      const model = result.frameworkEntities!.find(e => e.type === 'model') as EloquentModel;

      expect(model.relationships).toHaveLength(4);

      const postsRel = model.relationships.find(r => r.name === 'posts');
      expect(postsRel!.foreignKey).toBe('author_id');
      expect(postsRel!.localKey).toBe('id');

      const rolesRel = model.relationships.find(r => r.name === 'roles');
      expect(rolesRel!.type).toBe('belongsToMany');
    });
  });

  describe('Middleware Extraction', () => {
    it('should extract middleware classes', async () => {
      const code = `<?php

namespace App\\Http\\Middleware;

use Closure;

class AuthenticateAdmin
{
    public function handle($request, Closure $next)
    {
        if (!auth()->user()->isAdmin()) {
            return redirect('/');
        }
        return $next($request);
    }
}`;

      const result = await parser.parseFile('/project/app/Http/Middleware/AuthenticateAdmin.php', code);
      const middleware = result.frameworkEntities!.find(e => e.type === 'middleware') as LaravelMiddleware;

      expect(middleware?.name).toBe('AuthenticateAdmin');
      expect(middleware?.handleMethod).toContain('handle');
    });

    it('should extract middleware with parameters', async () => {
      const code = `<?php

class RoleMiddleware
{
    public function handle($request, Closure $next, $role)
    {
        if (!auth()->user()->hasRole($role)) {
            abort(403);
        }
        return $next($request);
    }
}`;

      const result = await parser.parseFile('/project/app/Http/Middleware/RoleMiddleware.php', code);
      const middleware = result.frameworkEntities!.find(e => e.type === 'middleware') as LaravelMiddleware;

      expect(middleware?.parameters).toContain('role');
    });

    it('should detect terminable middleware', async () => {
      const code = `<?php

class LogRequests
{
    public function handle($request, Closure $next)
    {
        return $next($request);
    }

    public function terminate($request, $response)
    {
        Log::info('Request completed');
    }
}`;

      const result = await parser.parseFile('/project/app/Http/Middleware/LogRequests.php', code);
      const middleware = result.frameworkEntities!.find(e => e.type === 'middleware') as LaravelMiddleware;

      expect(middleware?.metadata.terminable).toBe(true);
    });
  });

  describe('Job Extraction', () => {
    it('should extract queueable job classes', async () => {
      const code = `<?php

namespace App\\Jobs;

use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Foundation\\Bus\\Dispatchable;

class ProcessPayment implements ShouldQueue
{
    use Dispatchable;

    public $tries = 3;
    public $timeout = 120;

    public function handle()
    {
        // Process payment logic
    }
}`;

      const result = await parser.parseFile('/project/app/Jobs/ProcessPayment.php', code);
      const job = result.frameworkEntities!.find(e => e.type === 'job') as LaravelJob;

      expect(job?.name).toBe('ProcessPayment');
      expect(job?.attempts).toBe(3);
      expect(job?.timeout).toBe(120);
    });

    it('should extract job with queue configuration', async () => {
      const code = `<?php

class SendEmailJob implements ShouldQueue
{
    public $queue = 'emails';
    public $connection = 'redis';
    public $delay = 60;

    public function handle()
    {
        // Send email
    }

    public function failed(Exception $exception)
    {
        // Handle failure
    }
}`;

      const result = await parser.parseFile('/project/app/Jobs/SendEmailJob.php', code);
      const job = result.frameworkEntities!.find(e => e.type === 'job') as LaravelJob;

      expect(job?.queueConnection).toBe('redis');
      expect(job?.metadata.queue).toBe('emails');
      expect(job?.metadata.delay).toBe(60);
      expect(job?.metadata.hasFailedMethod).toBe(true);
    });

    it('should detect batch jobs', async () => {
      const code = `<?php

use Illuminate\\Bus\\Batchable;

class ProcessUserData implements ShouldQueue
{
    use Dispatchable, Batchable;

    public function handle()
    {
        if ($this->batch()->cancelled()) {
            return;
        }
        // Process data
    }
}`;

      const result = await parser.parseFile('/project/app/Jobs/ProcessUserData.php', code);
      const job = result.frameworkEntities!.find(e => e.type === 'job') as LaravelJob;

      expect(job?.metadata.batchable).toBe(true);
    });
  });

  describe('Service Provider Extraction', () => {
    it('should extract service provider classes', async () => {
      const code = `<?php

namespace App\\Providers;

use Illuminate\\Support\\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register()
    {
        $this->app->singleton('service', function ($app) {
            return new Service();
        });
    }

    public function boot()
    {
        Schema::defaultStringLength(191);
    }
}`;

      const result = await parser.parseFile('/project/app/Providers/AppServiceProvider.php', code);
      const provider = result.frameworkEntities!.find(e => e.type === 'service_provider') as LaravelServiceProvider;

      expect(provider?.name).toBe('AppServiceProvider');
      expect(provider?.registerMethod).toContain('register');
      expect(provider?.bootMethod).toContain('boot');
    });

    it('should extract deferred service providers', async () => {
      const code = `<?php

class CustomServiceProvider extends ServiceProvider
{
    protected $defer = true;

    public function provides()
    {
        return ['custom.service', 'another.service'];
    }

    public function register()
    {
        $this->app->bind('custom.service', CustomService::class);
    }
}`;

      const result = await parser.parseFile('/project/app/Providers/CustomServiceProvider.php', code);
      const provider = result.frameworkEntities!.find(e => e.type === 'service_provider') as LaravelServiceProvider;

      expect(provider?.metadata.deferred).toBe(true);
      expect(provider?.metadata.provides).toContain('custom.service');
      expect(provider?.metadata.provides).toContain('another.service');
    });
  });

  describe('Artisan Command Extraction', () => {
    it('should extract artisan command classes', async () => {
      const code = `<?php

namespace App\\Console\\Commands;

use Illuminate\\Console\\Command;

class SendEmails extends Command
{
    protected $signature = 'email:send {user} {--queue}';
    protected $description = 'Send emails to users';

    public function handle()
    {
        $this->info('Sending emails...');
        return 0;
    }
}`;

      const result = await parser.parseFile('/project/app/Console/Commands/SendEmails.php', code);
      const command = result.frameworkEntities!.find(e => e.type === 'command') as LaravelCommand;

      expect(command?.name).toBe('SendEmails');
      expect(command?.signature).toBe('email:send {user} {--queue}');
      expect(command?.description).toBe('Send emails to users');
    });

    it('should parse command arguments and options', async () => {
      const code = `<?php

class ProcessData extends Command
{
    protected $signature = 'data:process
                            {file : The file to process}
                            {--format=csv : Output format}
                            {--force : Force processing}';

    public function handle()
    {
        $file = $this->argument('file');
        $format = $this->option('format');
        $force = $this->option('force');
    }
}`;

      const result = await parser.parseFile('/project/app/Console/Commands/ProcessData.php', code);
      const command = result.frameworkEntities!.find(e => e.type === 'command') as LaravelCommand;

      expect(command?.metadata.arguments).toContain('file');
      expect(command?.metadata.options).toContain('format');
      expect(command?.metadata.options).toContain('force');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed Laravel code gracefully', async () => {
      const code = `<?php
Route::get('/broken', function() {
    // Missing closing brace
`;

      const result = await parser.parseFile('/project/routes/web.php', code);
      expect(result.errors).toHaveLength(1);
      expect(result.frameworkEntities).toHaveLength(0);
    });

    it('should continue parsing after encountering errors', async () => {
      const code = `<?php
Route::get('/good', 'Controller@method');
Route::get('/broken' // Missing handler
Route::post('/also-good', 'AnotherController@method');`;

      const result = await parser.parseFile('/project/routes/web.php', code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.frameworkEntities!.length).toBeGreaterThan(0); // Should still extract valid routes
    });

    it('should handle incomplete class definitions', async () => {
      const code = `<?php
class IncompleteController extends Controller
{
    public function method1() {
        return 'complete';
    }

    public function method2() {
        // Missing closing brace
`;

      const result = await parser.parseFile('/project/app/Http/Controllers/IncompleteController.php', code);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.frameworkEntities!.length).toBeGreaterThan(0); // Should still extract what it can
    });

    it('should handle non-Laravel PHP files', async () => {
      const code = `<?php
function regularFunction() {
    return 'Not Laravel code';
}
$variable = 'some value';`;

      const result = await parser.parseFile('some/regular.php', code);
      expect(result.frameworkEntities).toHaveLength(0);
      expect(result.metadata.isFrameworkSpecific).toBe(false);
    });

    it('should handle empty Laravel files', async () => {
      const code = '';

      const result = await parser.parseFile('/project/routes/web.php', code);
      expect(result.frameworkEntities).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle syntax errors in specific sections', async () => {
      const code = `<?php

class User extends Model
{
    protected $fillable = ['name', 'email'];

    public function posts()
    {
        return $this->hasMany(Post::class;  // Missing closing parenthesis
    }

    public function profile()
    {
        return $this->hasOne(Profile::class);
    }
}`;

      const result = await parser.parseFile('/project/app/Models/User.php', code);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should still extract the model and what relationships it can parse
      const model = result.frameworkEntities!.find(e => e.type === 'model') as EloquentModel;
      expect(model).toBeDefined();
      expect(model.name).toBe('User');
    });
  });

  describe('Framework Applicability', () => {
    it('should apply to Laravel controller files', async () => {
      const laravelController = `<?php
namespace App\\Http\\Controllers;
class UserController extends Controller {}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/UserController.php', laravelController);
      expect(result.metadata?.isFrameworkSpecific).toBe(true);
      expect(result.frameworkEntities?.length).toBeGreaterThan(0);
    });

    it('should apply to Laravel model files', async () => {
      const laravelModel = `<?php
namespace App\\Models;
class User extends Model {}`;

      const result = await parser.parseFile('/project/app/Models/User.php', laravelModel);
      expect(result.metadata?.isFrameworkSpecific).toBe(true);
      expect(result.frameworkEntities?.length).toBeGreaterThan(0);
    });

    it('should apply to Laravel route files', async () => {
      const laravelRoutes = `<?php
use Illuminate\\Support\\Facades\\Route;
Route::get('/test', 'TestController@index');`;

      const result = await parser.parseFile('/project/routes/web.php', laravelRoutes);
      expect(result.metadata?.isFrameworkSpecific).toBe(true);
      expect(result.frameworkEntities?.length).toBeGreaterThan(0);
    });

    it('should not apply to non-Laravel PHP files', async () => {
      const regularPhp = `<?php
function regularFunction() {
    return 'hello world';
}`;

      const result = await parser.parseFile('/project/random/file.php', regularPhp);
      expect(result.metadata?.isFrameworkSpecific).toBe(false);
      expect(result.frameworkEntities?.length).toBe(0);
    });

    it('should not apply to config files', async () => {
      const configFile = `<?php
return [
    'app' => [
        'name' => 'Laravel'
    ]
];`;

      const result = await parser.parseFile('/project/config/app.php', configFile);
      expect(result.metadata?.isFrameworkSpecific).toBe(false);
      expect(result.frameworkEntities?.length).toBe(0);
    });
  });

  describe('Framework Patterns', () => {
    it('should return correct framework patterns', () => {
      const patterns = parser.getFrameworkPatterns();

      expect(patterns.some(p => p.name === 'laravel-controller')).toBe(true);
      expect(patterns.some(p => p.name === 'laravel-model')).toBe(true);
      expect(patterns.some(p => p.name === 'laravel-route')).toBe(true);
      expect(patterns.some(p => p.name === 'laravel-middleware')).toBe(true);
      expect(patterns.some(p => p.name === 'laravel-job')).toBe(true);
      expect(patterns.some(p => p.name === 'laravel-service-provider')).toBe(true);
      expect(patterns.some(p => p.name === 'laravel-command')).toBe(true);

      const controllerPattern = patterns.find(p => p.name === 'laravel-controller');
      expect(controllerPattern!.fileExtensions).toContain('.php');
      expect(controllerPattern!.description).toBe('Laravel controller classes extending base Controller');

      const modelPattern = patterns.find(p => p.name === 'laravel-model');
      expect(modelPattern!.description).toBe('Eloquent model classes extending Model');
    });
  });

  describe('Performance', () => {
    it('should parse large Laravel files efficiently', async () => {
      // Generate a large route file with many routes
      const routes = Array.from({ length: 100 }, (_, i) =>
        `Route::get('/route${i}', 'Controller${i}@method');`
      ).join('\n');

      const code = `<?php\n${routes}`;

      const startTime = Date.now();
      const result = await parser.parseFile('/project/routes/web.php', code);
      const endTime = Date.now();

      const parseTime = endTime - startTime;
      expect(parseTime).toBeLessThan(1000); // Should parse in under 1 second
      expect(result.frameworkEntities!.length).toBe(100);
    });

    it('should handle complex models with many relationships', async () => {
      const relationships = Array.from({ length: 20 }, (_, i) => `
    public function relation${i}()
    {
        return $this->hasMany(Model${i}::class);
    }`).join('\n');

      const code = `<?php
class ComplexModel extends Model
{
    protected $fillable = ['field1', 'field2', 'field3'];
    ${relationships}
}`;

      const startTime = Date.now();
      const result = await parser.parseFile('/project/app/Models/ComplexModel.php', code);
      const endTime = Date.now();

      const parseTime = endTime - startTime;
      expect(parseTime).toBeLessThan(500); // Should parse quickly

      const model = result.frameworkEntities!.find(e => e.type === 'model') as EloquentModel;
      expect(model.relationships).toHaveLength(20);
    });
  });

  describe('Integration with Base Parser', () => {
    it('should extract both symbols and framework entities', async () => {
      const code = `<?php

namespace App\\Http\\Controllers;

class UserController extends Controller
{
    private $service;

    public function __construct(UserService $service)
    {
        $this->service = $service;
    }

    public function index()
    {
        $users = $this->service->getAllUsers();
        return view('users.index', compact('users'));
    }
}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/UserController.php', code);

      // Should extract PHP symbols
      expect(result.symbols!.some(s => s.name === 'UserController' && s.symbol_type === 'class')).toBe(true);
      expect(result.symbols!.some(s => s.name === '__construct' && s.symbol_type === 'method')).toBe(true);
      expect(result.symbols!.some(s => s.name === 'index' && s.symbol_type === 'method')).toBe(true);

      // Should extract Laravel framework entities
      const controller = result.frameworkEntities!.find(e => e.type === 'controller') as LaravelController;
      expect(controller).toBeDefined();
      expect(controller.name).toBe('UserController');
      expect(controller.actions).toContain('index');
    });

    it('should extract dependencies correctly', async () => {
      const code = `<?php

class UserController extends Controller
{
    public function store(Request $request)
    {
        $user = User::create($request->validated());
        event(new UserCreated($user));
        return redirect()->route('users.show', $user);
    }
}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/UserController.php', code);

      // Should detect dependencies and method calls
      expect(result.dependencies!.length).toBeGreaterThan(0);
      expect(result.dependencies!.some(d => d.to_symbol.includes('User'))).toBe(true);
      expect(result.dependencies!.some(d => d.dependency_type === 'calls')).toBe(true);
    });

    it('should extract imports correctly', async () => {
      const code = `<?php

namespace App\\Http\\Controllers;

use App\\Models\\User;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Auth;

class UserController extends Controller
{
    // Controller implementation
}`;

      const result = await parser.parseFile('/project/app/Http/Controllers/UserController.php', code);

      expect(result.imports!.length).toBe(3);
      expect(result.imports!.some(i => i.source === 'App\\Models\\User')).toBe(true);
      expect(result.imports!.some(i => i.source === 'Illuminate\\Http\\Request')).toBe(true);
      expect(result.imports!.some(i => i.source === 'Illuminate\\Support\\Facades\\Auth')).toBe(true);
    });
  });
});