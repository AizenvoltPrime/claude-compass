<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Carbon\Carbon;

/**
 * User Model
 *
 * Represents a user entity in the system with proper attribute casting
 * and relationships. Matches the TypeScript User interface structure
 * from the frontend.
 *
 * @property int $id
 * @property string $name
 * @property string $email
 * @property Carbon $created_at
 * @property Carbon $updated_at
 * @property Carbon|null $deleted_at
 */
class User extends Model
{
    use HasFactory, SoftDeletes;

    /**
     * The table associated with the model.
     *
     * @var string
     */
    protected $table = 'users';

    /**
     * The attributes that are mass assignable.
     *
     * These attributes match the CreateUserRequest and UpdateUserRequest
     * validation rules and TypeScript interfaces.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'name',
        'email',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'deleted_at', // Hide soft delete timestamp from API responses
    ];

    /**
     * The attributes that should be cast.
     *
     * These casts ensure proper data types when serializing to JSON
     * for API responses, matching TypeScript interface expectations.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'id' => 'integer',
        'name' => 'string',
        'email' => 'string',
        'created_at' => 'datetime:Y-m-d\TH:i:s.u\Z', // ISO 8601 format
        'updated_at' => 'datetime:Y-m-d\TH:i:s.u\Z', // ISO 8601 format
        'deleted_at' => 'datetime:Y-m-d\TH:i:s.u\Z', // ISO 8601 format
    ];

    /**
     * The attributes that should be mutated to dates.
     *
     * @var array<int, string>
     */
    protected $dates = [
        'created_at',
        'updated_at',
        'deleted_at',
    ];

    /**
     * Get the route key for the model.
     *
     * @return string
     */
    public function getRouteKeyName(): string
    {
        return 'id';
    }

    /**
     * Scope a query to search users by name or email.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param string $search
     * @return \Illuminate\Database\Eloquent\Builder
     */
    public function scopeSearch($query, string $search)
    {
        return $query->where(function ($q) use ($search) {
            $q->where('name', 'like', "%{$search}%")
              ->orWhere('email', 'like', "%{$search}%");
        });
    }

    /**
     * Scope a query to get recently created users.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param int $days
     * @return \Illuminate\Database\Eloquent\Builder
     */
    public function scopeRecentlyCreated($query, int $days = 7)
    {
        return $query->where('created_at', '>=', now()->subDays($days));
    }

    /**
     * Scope a query to order users by name alphabetically.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     * @param string $direction
     * @return \Illuminate\Database\Eloquent\Builder
     */
    public function scopeOrderByName($query, string $direction = 'asc')
    {
        return $query->orderBy('name', $direction);
    }

    /**
     * Get the user's display name.
     *
     * @return Attribute
     */
    protected function displayName(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->name ?: 'Unknown User',
        );
    }

    /**
     * Get the user's email domain.
     *
     * @return Attribute
     */
    protected function emailDomain(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->email ? substr(strrchr($this->email, '@'), 1) : null,
        );
    }

    /**
     * Get the user's initials.
     *
     * @return Attribute
     */
    protected function initials(): Attribute
    {
        return Attribute::make(
            get: function () {
                $words = explode(' ', trim($this->name));
                $initials = '';

                foreach ($words as $word) {
                    if (!empty($word)) {
                        $initials .= strtoupper(substr($word, 0, 1));
                    }
                }

                return $initials ?: 'U';
            }
        );
    }

    /**
     * Determine if the user was created recently.
     *
     * @param int $days
     * @return bool
     */
    public function isRecentlyCreated(int $days = 7): bool
    {
        return $this->created_at && $this->created_at->isAfter(now()->subDays($days));
    }

    /**
     * Get a formatted version of the created_at timestamp.
     *
     * @param string $format
     * @return string
     */
    public function getFormattedCreatedAt(string $format = 'M j, Y'): string
    {
        return $this->created_at ? $this->created_at->format($format) : '';
    }

    /**
     * Get a human-readable "time ago" for when the user was created.
     *
     * @return string
     */
    public function getCreatedAtForHumans(): string
    {
        return $this->created_at ? $this->created_at->diffForHumans() : '';
    }

    /**
     * Convert the model instance to an array.
     *
     * This ensures consistent JSON serialization that matches
     * the TypeScript User interface structure.
     *
     * @return array
     */
    public function toArray(): array
    {
        $array = parent::toArray();

        // Ensure consistent date formatting for API responses
        if (isset($array['created_at'])) {
            $array['created_at'] = $this->created_at->toISOString();
        }

        if (isset($array['updated_at'])) {
            $array['updated_at'] = $this->updated_at->toISOString();
        }

        return $array;
    }

    /**
     * The "booted" method of the model.
     *
     * @return void
     */
    protected static function booted(): void
    {
        // Automatically set email to lowercase when saving
        static::saving(function (User $user) {
            if ($user->email) {
                $user->email = strtolower(trim($user->email));
            }

            if ($user->name) {
                $user->name = trim($user->name);
            }
        });
    }
}