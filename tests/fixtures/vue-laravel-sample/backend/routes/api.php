<?php

use App\Http\Controllers\UserController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
| These routes match the API calls made from the Vue.js frontend components
| and provide clear examples for cross-stack dependency tracking.
|
*/

// Authentication route (example)
Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

/*
|--------------------------------------------------------------------------
| User Management Routes
|--------------------------------------------------------------------------
|
| These routes provide a complete RESTful API for user management.
| They correspond to the API calls in the Vue.js components:
| - UserList.vue: fetchUsers(), createUser(), deleteUser()
| - UserProfile.vue: fetchUser(), updateUser(), deleteUser()
|
*/

// User statistics endpoint
Route::get('/users/stats', [UserController::class, 'stats'])
    ->name('users.stats');

// Bulk operations
Route::delete('/users/bulk', [UserController::class, 'bulkDestroy'])
    ->name('users.bulk-destroy');

// Standard RESTful user routes
Route::apiResource('users', UserController::class);

/*
|--------------------------------------------------------------------------
| Explicit Route Definitions for Cross-Stack Analysis
|--------------------------------------------------------------------------
|
| These explicit route definitions provide clear mappings for cross-stack
| dependency tracking tools to analyze. Each route maps to specific
| Vue.js component methods.
|
*/

// GET /api/users - List users with pagination
// Maps to: UserList.vue -> fetchUsers()
// Response: UserListResponse (data: User[], meta: pagination)
Route::get('/users', [UserController::class, 'index'])
    ->name('users.index');

// GET /api/users/{id} - Get specific user
// Maps to: UserProfile.vue -> fetchUser(id)
// Response: User
Route::get('/users/{id}', [UserController::class, 'show'])
    ->name('users.show')
    ->where('id', '[0-9]+');

// POST /api/users - Create new user
// Maps to: UserList.vue -> createUser()
// Request: CreateUserRequest (name, email)
// Response: User (201 Created)
Route::post('/users', [UserController::class, 'store'])
    ->name('users.store');

// PUT /api/users/{id} - Update existing user
// Maps to: UserProfile.vue -> updateUser()
// Request: UpdateUserRequest (name, email)
// Response: User
Route::put('/users/{id}', [UserController::class, 'update'])
    ->name('users.update')
    ->where('id', '[0-9]+');

// DELETE /api/users/{id} - Delete user
// Maps to: UserProfile.vue -> deleteUser()
// Maps to: UserList.vue -> deleteUser()
// Response: 204 No Content
Route::delete('/users/{id}', [UserController::class, 'destroy'])
    ->name('users.destroy')
    ->where('id', '[0-9]+');

/*
|--------------------------------------------------------------------------
| Additional API Routes for Extended Testing
|--------------------------------------------------------------------------
|
| These routes provide additional patterns for cross-stack analysis testing,
| including nested resources, query parameters, and different response formats.
|
*/

// User search with query parameters
// Maps to potential Vue search functionality
Route::get('/users/search', function (Request $request) {
    $query = $request->input('q');
    $users = \App\Models\User::search($query)->paginate(15);

    return response()->json([
        'data' => $users->items(),
        'meta' => [
            'total' => $users->total(),
            'query' => $query,
        ]
    ]);
})->name('users.search');

// User validation endpoint (for real-time validation)
Route::post('/users/validate', function (Request $request) {
    $field = $request->input('field');
    $value = $request->input('value');
    $userId = $request->input('user_id'); // For updates

    $rules = [];
    switch ($field) {
        case 'email':
            $rules['value'] = 'required|email|unique:users,email' . ($userId ? ",{$userId}" : '');
            break;
        case 'name':
            $rules['value'] = 'required|string|max:255';
            break;
        default:
            return response()->json(['error' => 'Invalid field'], 400);
    }

    $validator = validator(['value' => $value], $rules);

    return response()->json([
        'valid' => !$validator->fails(),
        'errors' => $validator->errors()->toArray()
    ]);
})->name('users.validate');

/*
|--------------------------------------------------------------------------
| Middleware Examples for Cross-Stack Analysis
|--------------------------------------------------------------------------
|
| These routes demonstrate different middleware patterns that cross-stack
| analysis should be able to detect and understand.
|
*/

// Protected routes requiring authentication
Route::middleware(['auth:sanctum'])->group(function () {
    // Admin-only user management
    Route::prefix('admin')->group(function () {
        Route::get('/users/export', function () {
            // Export users functionality
            return response()->json(['message' => 'Export feature']);
        })->name('admin.users.export');

        Route::post('/users/{id}/suspend', function ($id) {
            // Suspend user functionality
            return response()->json(['message' => 'User suspended']);
        })->name('admin.users.suspend');
    });
});

// Rate-limited routes
Route::middleware(['throttle:api'])->group(function () {
    Route::post('/users/forgot-password', function (Request $request) {
        // Password reset functionality
        return response()->json(['message' => 'Password reset email sent']);
    })->name('users.forgot-password');
});

/*
|--------------------------------------------------------------------------
| CORS and Content-Type Examples
|--------------------------------------------------------------------------
|
| These routes help test cross-stack analysis of different HTTP patterns
| and content types that Vue.js applications commonly use.
|
*/

// JSON-only endpoint
Route::middleware(['api'])->group(function () {
    Route::get('/users/{id}/profile', function ($id) {
        $user = \App\Models\User::findOrFail($id);
        return response()->json([
            'user' => $user,
            'meta' => [
                'profile_complete' => true,
                'last_activity' => now()->toISOString()
            ]
        ]);
    })->name('users.profile');
});

// File upload endpoint (for avatar uploads)
Route::post('/users/{id}/avatar', function (Request $request, $id) {
    $request->validate([
        'avatar' => 'required|image|max:2048'
    ]);

    // In a real app, this would handle file upload
    return response()->json([
        'message' => 'Avatar uploaded successfully',
        'avatar_url' => '/storage/avatars/user-' . $id . '.jpg'
    ]);
})->name('users.avatar.upload');

/*
|--------------------------------------------------------------------------
| API Versioning Example
|--------------------------------------------------------------------------
|
| These routes demonstrate API versioning patterns that cross-stack
| analysis tools should be able to detect and map correctly.
|
*/

// API v2 routes (different namespace)
Route::prefix('v2')->group(function () {
    Route::get('/users', function () {
        return response()->json([
            'version' => '2.0',
            'message' => 'API v2 users endpoint'
        ]);
    })->name('v2.users.index');
});

/*
|--------------------------------------------------------------------------
| WebSocket/Real-time Examples
|--------------------------------------------------------------------------
|
| These routes provide endpoints that might be used with WebSocket
| connections or Server-Sent Events for real-time functionality.
|
*/

// Real-time user status
Route::get('/users/{id}/status', function ($id) {
    return response()->json([
        'user_id' => $id,
        'online' => true,
        'last_seen' => now()->toISOString()
    ]);
})->name('users.status');

// Webhook endpoint (for external integrations)
Route::post('/webhooks/user-created', function (Request $request) {
    // Handle webhook for user creation
    return response()->json(['received' => true]);
})->name('webhooks.user-created');