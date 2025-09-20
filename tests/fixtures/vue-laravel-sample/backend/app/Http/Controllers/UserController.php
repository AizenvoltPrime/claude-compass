<?php

namespace App\Http\Controllers;

use App\Http\Requests\CreateUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Validation\ValidationException;

/**
 * User Controller
 *
 * Handles CRUD operations for users with proper API responses
 * and error handling. Provides endpoints that match the Vue.js
 * frontend expectations.
 */
class UserController extends Controller
{
    /**
     * Display a listing of users with pagination
     *
     * GET /api/users
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function index(Request $request): JsonResponse
    {
        try {
            $perPage = $request->input('per_page', 15);
            $page = $request->input('page', 1);

            // Validate pagination parameters
            $perPage = max(1, min(100, intval($perPage))); // Limit between 1-100
            $page = max(1, intval($page));

            $query = User::query();

            // Add search functionality
            if ($search = $request->input('query')) {
                $query->where(function ($q) use ($search) {
                    $q->where('name', 'like', "%{$search}%")
                      ->orWhere('email', 'like', "%{$search}%");
                });
            }

            // Add ordering
            $orderBy = $request->input('order_by', 'created_at');
            $orderDirection = $request->input('order_direction', 'desc');

            if (in_array($orderBy, ['name', 'email', 'created_at', 'updated_at'])) {
                $query->orderBy($orderBy, $orderDirection === 'asc' ? 'asc' : 'desc');
            }

            $users = $query->paginate($perPage, ['*'], 'page', $page);

            return response()->json([
                'data' => $users->items(),
                'meta' => [
                    'total' => $users->total(),
                    'per_page' => $users->perPage(),
                    'current_page' => $users->currentPage(),
                    'last_page' => $users->lastPage(),
                    'first_page_url' => $users->url(1),
                    'last_page_url' => $users->url($users->lastPage()),
                    'next_page_url' => $users->nextPageUrl(),
                    'prev_page_url' => $users->previousPageUrl(),
                    'from' => $users->firstItem(),
                    'to' => $users->lastItem(),
                ],
                'links' => $users->linkCollection()->toArray()
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to retrieve users',
                'message' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }
    }

    /**
     * Display the specified user
     *
     * GET /api/users/{id}
     *
     * @param int $id
     * @return JsonResponse
     */
    public function show(int $id): JsonResponse
    {
        try {
            $user = User::findOrFail($id);

            return response()->json($user);

        } catch (ModelNotFoundException $e) {
            return response()->json([
                'error' => 'User not found',
                'message' => "User with ID {$id} does not exist"
            ], 404);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to retrieve user',
                'message' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }
    }

    /**
     * Store a newly created user
     *
     * POST /api/users
     *
     * @param CreateUserRequest $request
     * @return JsonResponse
     */
    public function store(CreateUserRequest $request): JsonResponse
    {
        try {
            $user = User::create($request->validated());

            return response()->json($user, 201);

        } catch (ValidationException $e) {
            return response()->json([
                'error' => 'Validation failed',
                'message' => 'The given data was invalid',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to create user',
                'message' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }
    }

    /**
     * Update the specified user
     *
     * PUT /api/users/{id}
     *
     * @param UpdateUserRequest $request
     * @param int $id
     * @return JsonResponse
     */
    public function update(UpdateUserRequest $request, int $id): JsonResponse
    {
        try {
            $user = User::findOrFail($id);
            $user->update($request->validated());

            // Refresh to get updated timestamps
            $user->refresh();

            return response()->json($user);

        } catch (ModelNotFoundException $e) {
            return response()->json([
                'error' => 'User not found',
                'message' => "User with ID {$id} does not exist"
            ], 404);
        } catch (ValidationException $e) {
            return response()->json([
                'error' => 'Validation failed',
                'message' => 'The given data was invalid',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to update user',
                'message' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }
    }

    /**
     * Remove the specified user
     *
     * DELETE /api/users/{id}
     *
     * @param int $id
     * @return JsonResponse
     */
    public function destroy(int $id): JsonResponse
    {
        try {
            $user = User::findOrFail($id);
            $user->delete();

            return response()->json(null, 204);

        } catch (ModelNotFoundException $e) {
            return response()->json([
                'error' => 'User not found',
                'message' => "User with ID {$id} does not exist"
            ], 404);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to delete user',
                'message' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }
    }

    /**
     * Get user statistics
     *
     * GET /api/users/stats
     *
     * @return JsonResponse
     */
    public function stats(): JsonResponse
    {
        try {
            $stats = [
                'total_users' => User::count(),
                'new_users_today' => User::whereDate('created_at', today())->count(),
                'new_users_this_week' => User::whereBetween('created_at', [
                    now()->startOfWeek(),
                    now()->endOfWeek()
                ])->count(),
                'new_users_this_month' => User::whereMonth('created_at', now()->month)
                    ->whereYear('created_at', now()->year)
                    ->count(),
            ];

            return response()->json([
                'data' => $stats,
                'generated_at' => now()->toISOString()
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to retrieve user statistics',
                'message' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }
    }

    /**
     * Bulk delete users
     *
     * DELETE /api/users/bulk
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function bulkDestroy(Request $request): JsonResponse
    {
        try {
            $request->validate([
                'user_ids' => 'required|array|min:1',
                'user_ids.*' => 'required|integer|exists:users,id'
            ]);

            $userIds = $request->input('user_ids');
            $deletedCount = User::whereIn('id', $userIds)->delete();

            return response()->json([
                'message' => "Successfully deleted {$deletedCount} users",
                'deleted_count' => $deletedCount
            ]);

        } catch (ValidationException $e) {
            return response()->json([
                'error' => 'Validation failed',
                'message' => 'Invalid user IDs provided',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to delete users',
                'message' => config('app.debug') ? $e->getMessage() : 'Internal server error'
            ], 500);
        }
    }
}