/**
 * Pagination support framework for database queries
 * Phase 1: Performance Infrastructure Implementation
 */

export interface PaginationParams {
  page_size?: number; // Default: 1000, max: 5000
  cursor?: string; // For cursor-based pagination
  offset?: number; // For offset-based pagination (simple cases)
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total_count: number;
    page_size: number;
    has_more: boolean;
    cursor?: string;
    next_cursor?: string;
    current_page?: number;
    total_pages?: number;
  };
  query_info?: {
    query_time_ms: number;
    filters_applied?: any;
    optimization_notes?: string[];
  };
}

export interface PaginationConfig {
  defaultPageSize: number;
  maxPageSize: number;
  enableCursorPagination: boolean;
  enableOffsetPagination: boolean;
}

export const DEFAULT_PAGINATION_CONFIG: PaginationConfig = {
  defaultPageSize: 1000,
  maxPageSize: 5000,
  enableCursorPagination: true,
  enableOffsetPagination: true,
};

/**
 * Validates and normalizes pagination parameters
 */
export function validatePaginationParams(
  params: PaginationParams,
  config: PaginationConfig = DEFAULT_PAGINATION_CONFIG
): Required<PaginationParams> {
  const pageSize = Math.min(
    Math.max(params.page_size || config.defaultPageSize, 1),
    config.maxPageSize
  );

  return {
    page_size: pageSize,
    cursor: params.cursor || '',
    offset: Math.max(params.offset || 0, 0),
  };
}

/**
 * Encodes pagination cursor from database ID and query parameters
 */
export function encodePaginationCursor(lastId: number, additionalData?: any): string {
  const cursorData = {
    lastId,
    timestamp: Date.now(),
    ...additionalData,
  };

  return Buffer.from(JSON.stringify(cursorData)).toString('base64');
}

/**
 * Decodes pagination cursor to extract database ID and query parameters
 */
export function decodePaginationCursor(cursor: string): { lastId: number; timestamp: number; [key: string]: any } | null {
  try {
    if (!cursor) return null;

    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
    return {
      lastId: decoded.lastId || 0,
      timestamp: decoded.timestamp || 0,
      ...decoded,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Applies pagination to a Knex query builder
 */
export function applyPagination<T>(
  queryBuilder: any, // Knex query builder
  params: PaginationParams,
  primaryKey: string = 'id'
): any {
  const validatedParams = validatePaginationParams(params);

  // Apply cursor-based pagination if cursor is provided
  if (validatedParams.cursor) {
    const cursorData = decodePaginationCursor(validatedParams.cursor);
    if (cursorData) {
      queryBuilder = queryBuilder.where(primaryKey, '>', cursorData.lastId);
    }
  } else if (validatedParams.offset > 0) {
    // Apply offset-based pagination
    queryBuilder = queryBuilder.offset(validatedParams.offset);
  }

  // Apply limit with buffer to check for more results
  return queryBuilder.limit(validatedParams.page_size + 1);
}

/**
 * Processes paginated query results and creates response metadata
 */
export function processPaginatedResults<T extends { id?: number }>(
  results: T[],
  params: PaginationParams,
  totalCount?: number
): PaginatedResponse<T> {
  const validatedParams = validatePaginationParams(params);
  const hasMore = results.length > validatedParams.page_size;

  // Remove the extra item used to check for more results
  const data = hasMore ? results.slice(0, -1) : results;

  // Generate next cursor from last item's ID
  let nextCursor: string | undefined;
  if (hasMore && data.length > 0) {
    const lastItem = data[data.length - 1];
    if (lastItem.id) {
      nextCursor = encodePaginationCursor(lastItem.id);
    }
  }

  // Calculate pagination metadata
  const currentPage = validatedParams.offset
    ? Math.floor(validatedParams.offset / validatedParams.page_size) + 1
    : 1;

  const totalPages = totalCount
    ? Math.ceil(totalCount / validatedParams.page_size)
    : undefined;

  return {
    data,
    pagination: {
      total_count: totalCount || data.length,
      page_size: validatedParams.page_size,
      has_more: hasMore,
      cursor: validatedParams.cursor,
      next_cursor: nextCursor,
      current_page: currentPage,
      total_pages: totalPages,
    },
  };
}

/**
 * Helper for creating paginated database service methods
 */
export async function createPaginatedQuery<T extends { id?: number }>(
  queryBuilder: any,
  params: PaginationParams,
  countQuery?: any,
  primaryKey: string = 'id'
): Promise<PaginatedResponse<T>> {
  const startTime = Date.now();

  // Get total count if count query is provided
  let totalCount: number | undefined;
  if (countQuery) {
    const countResult = await countQuery;
    totalCount = Array.isArray(countResult) ? countResult[0]?.count : countResult?.count;
    totalCount = totalCount ? parseInt(String(totalCount), 10) : 0;
  }

  // Apply pagination and execute query
  const paginatedQuery = applyPagination(queryBuilder, params, primaryKey);
  const results = await paginatedQuery;

  const response = processPaginatedResults<T>(results, params, totalCount);

  // Add query performance metadata
  response.query_info = {
    query_time_ms: Date.now() - startTime,
    optimization_notes: totalCount
      ? [`Query executed with total count: ${totalCount}`]
      : ['Query executed without total count for performance'],
  };

  return response;
}