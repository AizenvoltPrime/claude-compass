/**
 * Cross-Stack Error Handler and Monitoring
 *
 * Provides comprehensive error handling, graceful degradation, and monitoring
 * for Vue ↔ Laravel cross-stack dependency tracking operations.
 */

import { createComponentLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const logger = createComponentLogger('cross-stack-error-handler');

/**
 * Error severity levels for cross-stack operations
 */
export enum ErrorSeverity {
  LOW = 'low',           // Minor issues that don't affect functionality
  MEDIUM = 'medium',     // Issues that may affect accuracy but don't break functionality
  HIGH = 'high',         // Significant issues that affect functionality
  CRITICAL = 'critical'  // Critical failures that break core functionality
}

/**
 * Cross-stack error types
 */
export enum CrossStackErrorType {
  PATTERN_MATCH_FAILURE = 'pattern_match_failure',
  SCHEMA_COMPATIBILITY_ERROR = 'schema_compatibility_error',
  DATABASE_OPERATION_ERROR = 'database_operation_error',
  GRAPH_CONSTRUCTION_ERROR = 'graph_construction_error',
  MEMORY_PRESSURE = 'memory_pressure',
  PERFORMANCE_DEGRADATION = 'performance_degradation',
  SCHEMA_DRIFT_DETECTED = 'schema_drift_detected',
  RELATIONSHIP_ACCURACY_ALERT = 'relationship_accuracy_alert'
}

/**
 * Structured error information for cross-stack operations
 */
export interface CrossStackError {
  id: string;
  type: CrossStackErrorType;
  severity: ErrorSeverity;
  message: string;
  context: any;
  timestamp: Date;
  stackTrace?: string;
  recoveryStrategy?: string;
  fallbackApplied?: boolean;
  retryCount?: number;
}

/**
 * Monitoring metrics for cross-stack operations
 */
export interface CrossStackMetrics {
  operationType: string;
  executionTimeMs: number;
  memoryUsedMB: number;
  cacheHitRate: number;
  errorCount: number;
  timestamp: Date;
}

/**
 * Schema drift detection result
 */
export interface SchemaDriftResult {
  interfaceName: string;
  frontendSchema: any;
  backendSchema: any;
  driftDetected: boolean;
  driftSeverity: ErrorSeverity;
  changes: Array<{
    type: 'added' | 'removed' | 'modified';
    field: string;
    oldValue?: any;
    newValue?: any;
  }>;
  recommendedAction: string;
}

/**
 * Comprehensive cross-stack error handler and monitoring system
 */
export class CrossStackErrorHandler extends EventEmitter {
  private errors: Map<string, CrossStackError>;
  private metrics: CrossStackMetrics[];
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private readonly MAX_ERRORS = 1000;
  private readonly MAX_METRICS = 5000;
  private readonly PERFORMANCE_THRESHOLD_MS = 5000;
  private readonly MEMORY_THRESHOLD_MB = 100;

  constructor() {
    super();
    this.errors = new Map();
    this.metrics = [];
    this.setMaxListeners(50);

    // Set up periodic cleanup (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      this.cleanupIntervalId = setInterval(() => this.cleanup(), 300000); // 5 minutes
    }
  }

  /**
   * Handle and log cross-stack errors with recovery strategies
   */
  handleError(
    type: CrossStackErrorType,
    severity: ErrorSeverity,
    message: string,
    context: any = {},
    error?: Error
  ): CrossStackError {
    const errorId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const crossStackError: CrossStackError = {
      id: errorId,
      type,
      severity,
      message,
      context,
      timestamp: new Date(),
      stackTrace: error?.stack,
      recoveryStrategy: this.getRecoveryStrategy(type, severity),
      fallbackApplied: false,
      retryCount: 0
    };

    // Store error
    this.errors.set(errorId, crossStackError);

    // Log with appropriate level
    const logMessage = `Cross-stack error: ${message}`;
    const logContext = { errorId, type, severity, context };

    switch (severity) {
      case ErrorSeverity.CRITICAL:
        logger.error(logMessage, logContext);
        break;
      case ErrorSeverity.HIGH:
        logger.error(logMessage, logContext);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn(logMessage, logContext);
        break;
      case ErrorSeverity.LOW:
        logger.debug(logMessage, logContext);
        break;
    }

    // Emit event for monitoring systems (only if there are listeners)
    if (this.listenerCount('error') > 0) {
      this.emit('error', crossStackError);
    }

    // Apply recovery strategy if available
    this.applyRecoveryStrategy(crossStackError);

    // Cleanup old errors if necessary
    if (this.errors.size > this.MAX_ERRORS) {
      this.cleanupOldErrors();
    }

    return crossStackError;
  }

  /**
   * Record performance and operational metrics
   */
  recordMetrics(
    operationType: string,
    executionTimeMs: number,
    memoryUsedMB: number,
    cacheHitRate: number = 0,
    errorCount: number = 0
  ): void {
    const metrics: CrossStackMetrics = {
      operationType,
      executionTimeMs,
      memoryUsedMB,
      cacheHitRate,
      errorCount,
      timestamp: new Date()
    };

    this.metrics.push(metrics);

    // Check for performance degradation
    if (executionTimeMs > this.PERFORMANCE_THRESHOLD_MS) {
      this.handleError(
        CrossStackErrorType.PERFORMANCE_DEGRADATION,
        ErrorSeverity.MEDIUM,
        `Operation ${operationType} took ${executionTimeMs}ms, exceeding threshold`,
        { metrics }
      );
    }

    // Check for memory pressure
    if (memoryUsedMB > this.MEMORY_THRESHOLD_MB) {
      this.handleError(
        CrossStackErrorType.MEMORY_PRESSURE,
        ErrorSeverity.MEDIUM,
        `Operation ${operationType} used ${memoryUsedMB}MB, exceeding threshold`,
        { metrics }
      );
    }


    // Emit metrics event
    this.emit('metrics', metrics);

    // Cleanup old metrics if necessary
    if (this.metrics.length > this.MAX_METRICS) {
      this.cleanupOldMetrics();
    }
  }

  /**
   * Detect schema drift between frontend and backend schemas
   */
  detectSchemaDrift(
    interfaceName: string,
    frontendSchema: any,
    backendSchema: any
  ): SchemaDriftResult {
    const changes: SchemaDriftResult['changes'] = [];
    let driftSeverity = ErrorSeverity.LOW;

    try {
      // Compare property structures
      const frontendProps = this.extractSchemaProperties(frontendSchema);
      const backendProps = this.extractSchemaProperties(backendSchema);

      // Check for removed properties
      for (const [propName, propValue] of Object.entries(frontendProps)) {
        if (!(propName in backendProps)) {
          changes.push({
            type: 'removed',
            field: propName,
            oldValue: propValue
          });
          driftSeverity = ErrorSeverity.MEDIUM;
        }
      }

      // Check for added properties
      for (const [propName, propValue] of Object.entries(backendProps)) {
        if (!(propName in frontendProps)) {
          changes.push({
            type: 'added',
            field: propName,
            newValue: propValue
          });
          if (this.isRequiredProperty(propValue)) {
            driftSeverity = ErrorSeverity.HIGH;
          }
        }
      }

      // Check for modified properties
      for (const [propName, frontendValue] of Object.entries(frontendProps)) {
        if (propName in backendProps) {
          const backendValue = backendProps[propName];
          if (JSON.stringify(frontendValue) !== JSON.stringify(backendValue)) {
            changes.push({
              type: 'modified',
              field: propName,
              oldValue: frontendValue,
              newValue: backendValue
            });
            if (this.isTypeChange(frontendValue, backendValue)) {
              driftSeverity = ErrorSeverity.HIGH;
            }
          }
        }
      }

      const driftResult: SchemaDriftResult = {
        interfaceName,
        frontendSchema,
        backendSchema,
        driftDetected: changes.length > 0,
        driftSeverity,
        changes,
        recommendedAction: this.getRecommendedAction(changes, driftSeverity)
      };

      // Log schema drift if detected
      if (driftResult.driftDetected) {
        this.handleError(
          CrossStackErrorType.SCHEMA_DRIFT_DETECTED,
          driftSeverity,
          `Schema drift detected in ${interfaceName}`,
          { driftResult }
        );
      }

      return driftResult;
    } catch (error) {
      // Fallback to safe result if drift detection fails
      logger.warn('Failed to detect schema drift', { interfaceName, error });
      return {
        interfaceName,
        frontendSchema,
        backendSchema,
        driftDetected: false,
        driftSeverity: ErrorSeverity.LOW,
        changes: [],
        recommendedAction: 'Manual review required - drift detection failed'
      };
    }
  }

  /**
   * Apply graceful degradation strategy for cross-stack operations
   */
  applyGracefulDegradation<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return operation().catch(async (error) => {
      this.handleError(
        CrossStackErrorType.DATABASE_OPERATION_ERROR,
        ErrorSeverity.MEDIUM,
        `Operation ${operationName} failed, applying fallback`,
        { operationName },
        error
      );

      try {
        const result = await fallback();
        logger.info(`Fallback successful for ${operationName}`);
        return result;
      } catch (fallbackError) {
        this.handleError(
          CrossStackErrorType.DATABASE_OPERATION_ERROR,
          ErrorSeverity.HIGH,
          `Both operation and fallback failed for ${operationName}`,
          { operationName, originalError: error.message },
          fallbackError
        );
        throw fallbackError;
      }
    });
  }

  /**
   * Get performance and error statistics
   */
  getStatistics(): any {
    const recentMetrics = this.metrics.filter(m =>
      Date.now() - m.timestamp.getTime() < 3600000 // Last hour
    );

    const recentErrors = Array.from(this.errors.values()).filter(e =>
      Date.now() - e.timestamp.getTime() < 3600000 // Last hour
    );

    return {
      errors: {
        total: this.errors.size,
        recent: recentErrors.length,
        bySeverity: this.groupErrorsBySeverity(recentErrors),
        byType: this.groupErrorsByType(recentErrors)
      },
      performance: {
        avgExecutionTime: recentMetrics.reduce((sum, m) => sum + m.executionTimeMs, 0) / Math.max(recentMetrics.length, 1),
        avgMemoryUsage: recentMetrics.reduce((sum, m) => sum + m.memoryUsedMB, 0) / Math.max(recentMetrics.length, 1),
        avgCacheHitRate: recentMetrics.reduce((sum, m) => sum + m.cacheHitRate, 0) / Math.max(recentMetrics.length, 1)
      },
      health: {
        overallStatus: this.calculateHealthStatus(recentErrors, recentMetrics),
        lastUpdated: new Date()
      }
    };
  }

  /**
   * Clear all stored errors and metrics (for testing)
   */
  clear(): void {
    this.errors.clear();
    this.metrics.length = 0;
    logger.info('Cross-stack error handler cleared');
  }

  // Private helper methods

  private getRecoveryStrategy(type: CrossStackErrorType, severity: ErrorSeverity): string {
    const strategies: Record<CrossStackErrorType, string> = {
      [CrossStackErrorType.PATTERN_MATCH_FAILURE]: 'Retry with relaxed matching criteria',
      [CrossStackErrorType.SCHEMA_COMPATIBILITY_ERROR]: 'Use partial schema matching',
      [CrossStackErrorType.DATABASE_OPERATION_ERROR]: 'Retry with exponential backoff',
      [CrossStackErrorType.GRAPH_CONSTRUCTION_ERROR]: 'Build graph with available data only',
      [CrossStackErrorType.MEMORY_PRESSURE]: 'Enable streaming mode',
      [CrossStackErrorType.PERFORMANCE_DEGRADATION]: 'Increase batch size and caching',
      [CrossStackErrorType.SCHEMA_DRIFT_DETECTED]: 'Flag for manual review',
      [CrossStackErrorType.RELATIONSHIP_ACCURACY_ALERT]: 'Review relationship detection rules'
    };

    return strategies[type] || 'Manual intervention required';
  }

  private applyRecoveryStrategy(error: CrossStackError): void {
    // Apply automatic recovery strategies where possible
    switch (error.type) {
      case CrossStackErrorType.MEMORY_PRESSURE:
        if (global.gc) {
          global.gc();
          error.fallbackApplied = true;
        }
        break;

      case CrossStackErrorType.PERFORMANCE_DEGRADATION:
        // Could trigger cache warming or other optimizations
        error.fallbackApplied = true;
        break;

      default:
        // Most recovery strategies require manual intervention or caller handling
        break;
    }
  }

  private extractSchemaProperties(schema: any): Record<string, any> {
    if (!schema || typeof schema !== 'object') {
      return {};
    }

    // Handle different schema formats
    if (schema.properties) {
      return schema.properties;
    }

    if (Array.isArray(schema)) {
      return schema.reduce((acc, item, index) => {
        acc[index.toString()] = item;
        return acc;
      }, {});
    }

    return schema;
  }

  private isRequiredProperty(propValue: any): boolean {
    return propValue?.required === true || propValue?.nullable === false;
  }

  private isTypeChange(oldValue: any, newValue: any): boolean {
    const oldType = typeof oldValue === 'object' ? oldValue?.type : typeof oldValue;
    const newType = typeof newValue === 'object' ? newValue?.type : typeof newValue;
    return oldType !== newType;
  }

  private getRecommendedAction(changes: SchemaDriftResult['changes'], severity: ErrorSeverity): string {
    if (changes.length === 0) {
      return 'No action required';
    }

    if (severity === ErrorSeverity.HIGH || severity === ErrorSeverity.CRITICAL) {
      return 'Immediate synchronization required - breaking changes detected';
    }

    if (severity === ErrorSeverity.MEDIUM) {
      return 'Review and update schemas within next deployment cycle';
    }

    return 'Monitor for additional changes - low impact modifications detected';
  }

  private groupErrorsBySeverity(errors: CrossStackError[]): Record<string, number> {
    return errors.reduce((acc, error) => {
      acc[error.severity] = (acc[error.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private groupErrorsByType(errors: CrossStackError[]): Record<string, number> {
    return errors.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private calculateHealthStatus(errors: CrossStackError[], metrics: CrossStackMetrics[]): string {
    const criticalErrors = errors.filter(e => e.severity === ErrorSeverity.CRITICAL).length;
    const highErrors = errors.filter(e => e.severity === ErrorSeverity.HIGH).length;

    if (criticalErrors > 0) {
      return 'critical';
    }

    if (highErrors > 5) {
      return 'degraded';
    }

    const avgPerformance = metrics.reduce((sum, m) => sum + m.executionTimeMs, 0) / Math.max(metrics.length, 1);
    if (avgPerformance > this.PERFORMANCE_THRESHOLD_MS * 2) {
      return 'degraded';
    }

    return 'healthy';
  }

  private cleanup(): void {
    this.cleanupOldErrors();
    this.cleanupOldMetrics();
  }

  private cleanupOldErrors(): void {
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    for (const [id, error] of this.errors) {
      if (error.timestamp.getTime() < cutoffTime) {
        this.errors.delete(id);
      }
    }
  }

  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - 6 * 60 * 60 * 1000; // 6 hours
    this.metrics = this.metrics.filter(m => m.timestamp.getTime() >= cutoffTime);
  }

  /**
   * Destroy the error handler and clean up resources
   */
  destroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.errors.clear();
    this.metrics = [];
    this.removeAllListeners();
  }
}

// Export singleton instance
export const crossStackErrorHandler = new CrossStackErrorHandler();