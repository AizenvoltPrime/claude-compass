import { z } from 'zod';
import { DeadCodeDetector } from './dead-code/detector.js';
import { DetectDeadCodeParams } from './dead-code/types.js';
import { databaseService } from '../../database/index.js';

/// <summary>
/// MCP tool for detecting dead code, interface bloat, and unused symbols
/// </summary>

export const DetectDeadCodeSchema = z.object({
  confidence_threshold: z
    .enum(['high', 'medium', 'low'])
    .optional()
    .describe(
      'Minimum confidence level to include in results (default: medium)'
    ),
  include_exports: z
    .boolean()
    .optional()
    .describe(
      'Include exported symbols in results (default: false - excludes exports)'
    ),
  include_tests: z
    .boolean()
    .optional()
    .describe('Include test files in analysis (default: false)'),
  max_results: z
    .number()
    .optional()
    .describe('Maximum number of results to return (default: 200)'),
  file_pattern: z
    .string()
    .optional()
    .describe('Glob pattern to filter files (e.g., "src/**/*.cs")'),
});

export type DetectDeadCodeInput = z.infer<typeof DetectDeadCodeSchema>;

export async function detectDeadCode(input: DetectDeadCodeInput, repoId?: number) {
  const params: DetectDeadCodeParams = {
    confidence_threshold: input.confidence_threshold,
    include_exports: input.include_exports,
    include_tests: input.include_tests,
    max_results: input.max_results ?? 200,
    file_pattern: input.file_pattern,
  };

  const detector = new DeadCodeDetector(databaseService.knex);
  const result = await detector.detect(params, repoId);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
