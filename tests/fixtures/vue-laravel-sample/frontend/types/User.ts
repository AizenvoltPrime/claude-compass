/**
 * User entity interface - matches Laravel User model structure
 */
export interface User {
  /** Unique identifier for the user */
  id: number;

  /** User's full name */
  name: string;

  /** User's email address (unique) */
  email: string;

  /** Timestamp when the user was created */
  created_at: string;

  /** Timestamp when the user was last updated */
  updated_at: string;
}

/**
 * Request interface for creating a new user
 * Maps to Laravel CreateUserRequest validation rules
 */
export interface CreateUserRequest {
  /** User's full name (required, max 255 characters) */
  name: string;

  /** User's email address (required, unique, valid email format) */
  email: string;
}

/**
 * Request interface for updating an existing user
 * Maps to Laravel UpdateUserRequest validation rules
 */
export interface UpdateUserRequest {
  /** User's full name (required, max 255 characters) */
  name: string;

  /** User's email address (required, unique except for current user, valid email format) */
  email: string;
}

/**
 * Response interface for user list endpoint
 * Includes pagination metadata
 */
export interface UserListResponse {
  /** Array of user objects */
  data: User[];

  /** Pagination metadata */
  meta: {
    /** Total number of users */
    total: number;

    /** Number of users per page */
    per_page: number;

    /** Current page number */
    current_page: number;

    /** Total number of pages */
    last_page?: number;

    /** URL for first page */
    first_page_url?: string;

    /** URL for last page */
    last_page_url?: string;

    /** URL for next page */
    next_page_url?: string | null;

    /** URL for previous page */
    prev_page_url?: string | null;

    /** Starting index for current page */
    from?: number;

    /** Ending index for current page */
    to?: number;
  };

  /** Links for pagination navigation */
  links?: Array<{
    url: string | null;
    label: string;
    active: boolean;
  }>;
}

/**
 * Error response interface for API calls
 */
export interface ApiErrorResponse {
  /** Error message */
  message: string;

  /** Validation errors (for 422 responses) */
  errors?: Record<string, string[]>;

  /** HTTP status code */
  status?: number;
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T = any> {
  /** Response data */
  data?: T;

  /** Success message */
  message?: string;

  /** Success indicator */
  success?: boolean;

  /** Error information */
  error?: string;
}

/**
 * User profile extended interface (for future features)
 */
export interface UserProfile extends User {
  /** User's avatar URL */
  avatar?: string;

  /** User's bio/description */
  bio?: string;

  /** User's timezone */
  timezone?: string;

  /** User's preferred language */
  language?: string;

  /** Whether user is active */
  is_active?: boolean;

  /** Last login timestamp */
  last_login_at?: string | null;
}

/**
 * User search/filter parameters
 */
export interface UserSearchParams {
  /** Search query for name or email */
  query?: string;

  /** Filter by active status */
  is_active?: boolean;

  /** Order by field */
  order_by?: 'name' | 'email' | 'created_at' | 'updated_at';

  /** Sort direction */
  order_direction?: 'asc' | 'desc';

  /** Page number for pagination */
  page?: number;

  /** Number of items per page */
  per_page?: number;
}

/**
 * Validation rules interface (for form validation)
 */
export interface UserValidationRules {
  name: {
    required: boolean;
    minLength: number;
    maxLength: number;
  };
  email: {
    required: boolean;
    pattern: RegExp;
    unique?: boolean;
  };
}

/**
 * Default validation rules
 */
export const USER_VALIDATION_RULES: UserValidationRules = {
  name: {
    required: true,
    minLength: 1,
    maxLength: 255
  },
  email: {
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    unique: true
  }
};

/**
 * Type guard to check if object is a User
 */
export function isUser(obj: any): obj is User {
  return obj &&
    typeof obj.id === 'number' &&
    typeof obj.name === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.created_at === 'string' &&
    typeof obj.updated_at === 'string';
}

/**
 * Type guard to check if object is a CreateUserRequest
 */
export function isCreateUserRequest(obj: any): obj is CreateUserRequest {
  return obj &&
    typeof obj.name === 'string' &&
    typeof obj.email === 'string' &&
    obj.name.length > 0 &&
    obj.email.length > 0;
}

/**
 * Type guard to check if object is an UpdateUserRequest
 */
export function isUpdateUserRequest(obj: any): obj is UpdateUserRequest {
  return obj &&
    typeof obj.name === 'string' &&
    typeof obj.email === 'string' &&
    obj.name.length > 0 &&
    obj.email.length > 0;
}