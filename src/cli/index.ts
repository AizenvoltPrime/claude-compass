#!/usr/bin/env node
import process from 'process';
import path from 'path';

import { Command } from 'commander';
import { GraphBuilder } from '../graph';
import { DatabaseService, databaseService } from '../database';
import { ClaudeCompassMCPServer } from '../mcp';
import { logger, config } from '../utils';
import { FileSizeUtils, DEFAULT_POLICY } from '../config/file-size-policy';
import chalk from 'chalk';
import ora from 'ora';

// Helper function for CLI commands that need to exit cleanly
async function cleanExit(code: number = 0): Promise<never> {
  // Force cleanup of any remaining handles after a short delay
  setTimeout(() => {
    process.exit(code);
  }, 100);

  // This return never actually happens, but TypeScript needs it
  return process.exit(code) as never;
}

// Set UTF-8 encoding for stdout and stderr
if (process.stdout.setEncoding) {
  process.stdout.setEncoding('utf8');
}
if (process.stderr.setEncoding) {
  process.stderr.setEncoding('utf8');
}

// Check for Unicode support and provide fallbacks
const getEmoji = (emoji: string, fallback: string): string => {
  // Check if we're in a Unicode-capable environment
  const supportsUnicode = process.env.TERM !== 'dumb' &&
                         (!process.env.CI || process.env.CI === 'false') &&
                         process.platform !== 'win32';

  return supportsUnicode ? emoji : fallback;
};

const program = new Command();

program
  .name('claude-compass')
  .description('AI-native development environment - analyze codebases and build contextual graphs')
  .version('0.1.0');

// Analyze command
program
  .command('analyze')
  .description('Analyze a repository and build graphs')
  .argument('<path>', 'Path to the repository to analyze')
  .option('--no-test-files', 'Exclude test files from analysis')
  .option('--include-node-modules', 'Include node_modules in analysis (not recommended)')
  .option('--max-file-size <size>', 'Maximum file size to process in bytes', '20971520') // 20MB
  .option('--chunking-threshold <size>', 'File size to start chunking', '51200') // 50KB
  .option('--warn-threshold <size>', 'File size to warn about', '2097152') // 2MB
  .option('--max-files <count>', 'Maximum number of files to process', '10000')
  .option('--extensions <list>', 'File extensions to analyze (comma-separated)', '.js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.php')
  .option('--compassignore <path>', 'Path to .compassignore file', '.compassignore')
  .option('--chunk-overlap <lines>', 'Overlap lines between chunks', '100')
  .option('--encoding-fallback <encoding>', 'Fallback encoding for problematic files', 'iso-8859-1')
  .option('--parallel-parsing', 'Enable parallel file parsing', false)
  .option('--cross-stack', 'Enable cross-stack analysis for Vue ↔ Laravel projects', false)
  .option('--vue-laravel', 'Specifically analyze Vue.js and Laravel cross-stack relationships', false)
  .option('--confidence-threshold <threshold>', 'Cross-stack relationship confidence threshold (0.0-1.0)', '0.7')
  .option('--force-full', 'Force full analysis instead of incremental analysis', false)
  .option('--verbose', 'Enable verbose logging')
  .action(async (repositoryPath, options) => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    // Resolve relative paths to absolute paths
    const absolutePath = path.resolve(repositoryPath);

    const spinner = ora('Initializing analysis...').start();

    try {
      // Initialize database connection
      spinner.text = 'Connecting to database...';
      spinner.succeed('Database connection established');

      // Create graph builder
      const graphBuilder = new GraphBuilder(databaseService);

      // Parse options
      const buildOptions = {
        includeTestFiles: options.testFiles !== false,
        includeNodeModules: options.includeNodeModules === true,
        maxFiles: parseInt(options.maxFiles),
        fileExtensions: options.extensions.split(','),

        chunkOverlapLines: parseInt(options.chunkOverlap),
        encodingFallback: options.encodingFallback,
        compassignorePath: options.compassignore,
        enableParallelParsing: options.parallelParsing === true,
        forceFullAnalysis: options.forceFull === true,

        // Cross-stack analysis options
        enableCrossStack: options.crossStack === true || options.vueLaravel === true,
        crossStackFrameworks: options.vueLaravel === true ? ['vue', 'laravel'] : undefined,
        crossStackConfidenceThreshold: parseFloat(options.confidenceThreshold),

        // File size policy options (using aggressive preset)
        fileSizePolicy: {
          ...DEFAULT_POLICY,
          ...(options.maxFileSize ? { maxFileSize: parseInt(options.maxFileSize) } : {}),
          ...(options.chunkingThreshold ? { chunkingThreshold: parseInt(options.chunkingThreshold) } : {}),
          ...(options.warnThreshold ? { warnThreshold: parseInt(options.warnThreshold) } : {})
        }
      };

      console.log(chalk.blue('\nStarting repository analysis...'));
      console.log(chalk.gray(`Repository: ${absolutePath}`));

      // Run analysis (GraphBuilder will automatically detect if incremental is possible)
      spinner.start('Analyzing repository...');

      const startTime = Date.now();
      const result = await graphBuilder.analyzeRepository(absolutePath, buildOptions);
      const duration = Date.now() - startTime;

      spinner.succeed('Analysis completed');

      // Display results
      console.log(chalk.green(`\n${getEmoji('✅', '[OK]')} Analysis completed successfully!`));
      console.log(chalk.blue(`${getEmoji('⏱️', 'Time:')}  Duration: ${(duration / 1000).toFixed(2)}s`));
      console.log(chalk.blue(`${getEmoji('📁', 'Files:')} Files processed: ${result.filesProcessed}`));
      console.log(chalk.blue(`${getEmoji('🔍', 'Symbols:')} Symbols extracted: ${result.symbolsExtracted}`));
      console.log(chalk.blue(`${getEmoji('🔗', 'Deps:')} Dependencies created: ${result.dependenciesCreated}`));
      console.log(chalk.blue(`${getEmoji('📊', 'Graph:')} File graph nodes: ${result.fileGraph.nodes.length}`));
      console.log(chalk.blue(`${getEmoji('📊', 'Graph:')} File graph edges: ${result.fileGraph.edges.length}`));
      console.log(chalk.blue(`${getEmoji('🎯', 'Graph:')} Symbol graph nodes: ${result.symbolGraph.nodes.length}`));
      console.log(chalk.blue(`${getEmoji('🎯', 'Graph:')} Symbol graph edges: ${result.symbolGraph.edges.length}`));

      // Display cross-stack results if enabled
      if (buildOptions.enableCrossStack && result.crossStackGraph) {
        console.log(chalk.magenta(`\n${getEmoji('🔀', 'Cross:')} Cross-Stack Analysis Results:`));
        console.log(chalk.magenta(`${getEmoji('🌐', 'API:')} API calls detected: ${result.crossStackGraph.apiCallGraph?.edges.length || 0}`));
        console.log(chalk.magenta(`${getEmoji('📋', 'Schema:')} Data contracts: ${result.crossStackGraph.dataContractGraph?.edges.length || 0}`));
        console.log(chalk.magenta(`${getEmoji('🎛️', 'Features:')} Feature clusters: ${result.crossStackGraph.features?.length || 0}`));
        if (result.crossStackGraph.metadata?.averageConfidence !== undefined) {
          console.log(chalk.magenta(`${getEmoji('💯', 'Confidence:')} Average confidence: ${(result.crossStackGraph.metadata.averageConfidence * 100).toFixed(1)}%`));
        }
      }

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n${getEmoji('⚠️', '[WARN]')}  ${result.errors.length} errors occurred during analysis:`));
        result.errors.slice(0, 10).forEach((error, index) => {
          console.log(chalk.gray(`  ${index + 1}. ${error.filePath}: ${error.message}`));
        });

        if (result.errors.length > 10) {
          console.log(chalk.gray(`  ... and ${result.errors.length - 10} more errors`));
        }
      }

      console.log(chalk.green('\nRepository analysis complete! You can now:'));
      console.log(chalk.white('• Start the MCP server: claude-compass mcp-server'));
      console.log(chalk.white('• Search for symbols: claude-compass search <query>'));
      console.log(chalk.white('• Show repository stats: claude-compass stats'));
      console.log(chalk.blue(`\n${getEmoji('⏱️', 'Time:')} Total analysis time: ${(duration / 1000).toFixed(2)}s`));

      // Close database connection
      await databaseService.close();

      // Exit cleanly
      await cleanExit(0);

    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`\n${getEmoji('❌', '[ERROR]')} Error during analysis:`));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// MCP Server command
program
  .command('mcp-server')
  .description('Start the MCP server for AI integration')
  .option('--port <port>', 'Port to listen on', config.mcpServer.port.toString())
  .option('--host <host>', 'Host to bind to', config.mcpServer.host)
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    const spinner = ora('Starting MCP server...').start();

    try {
      // Initialize database connection
      await databaseService.runMigrations();
      spinner.succeed('Database connection established');

      console.log(chalk.blue('\n🚀 Starting Claude Compass MCP Server...'));
      console.log(chalk.gray(`Host: ${options.host}`));
      console.log(chalk.gray(`Port: ${options.port}`));

      const server = new ClaudeCompassMCPServer();
      await server.start();

      console.log(chalk.green('\n✅ MCP Server started successfully!'));
      console.log(chalk.blue('The server is now listening for connections.'));
      console.log(chalk.gray('Press Ctrl+C to stop the server.'));

    } catch (error) {
      spinner.fail('Failed to start MCP server');
      console.error(chalk.red('\n❌ Error starting server:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// Search command
program
  .command('search')
  .description('Search for symbols in the analyzed repositories')
  .argument('<query>', 'Search query (symbol name or pattern)')
  .option('--repo-id <id>', 'Limit search to specific repository ID')
  .option('--type <type>', 'Filter by symbol type (function, class, interface, etc.)')
  .option('--exported-only', 'Show only exported symbols')
  .option('--limit <count>', 'Maximum number of results', '20')
  .action(async (query, options) => {
    const spinner = ora('Searching symbols...').start();

    try {
      await databaseService.runMigrations();

      const repoId = options.repoId ? parseInt(options.repoId) : undefined;
      const symbols = await databaseService.searchSymbols(query, repoId);

      let filteredSymbols = symbols;

      if (options.type) {
        filteredSymbols = filteredSymbols.filter(s => s.symbol_type === options.type);
      }

      if (options.exportedOnly) {
        filteredSymbols = filteredSymbols.filter(s => s.is_exported);
      }

      const limit = parseInt(options.limit);
      filteredSymbols = filteredSymbols.slice(0, limit);

      spinner.succeed(`Found ${filteredSymbols.length} symbols`);

      console.log(chalk.blue(`\n🔍 Search results for: "${query}"`));

      if (filteredSymbols.length === 0) {
        console.log(chalk.yellow('No symbols found matching your query.'));
        return;
      }

      filteredSymbols.forEach((symbol, index) => {
        console.log(chalk.white(`\n${index + 1}. ${symbol.name}`));
        console.log(chalk.gray(`   Type: ${symbol.symbol_type}`));
        console.log(chalk.gray(`   File: ${symbol.file?.path || 'unknown'}`));
        console.log(chalk.gray(`   Line: ${symbol.start_line}-${symbol.end_line}`));
        console.log(chalk.gray(`   Exported: ${symbol.is_exported ? 'Yes' : 'No'}`));
        if (symbol.visibility) {
          console.log(chalk.gray(`   Visibility: ${symbol.visibility}`));
        }
      });

      console.log(chalk.blue(`\nShowing ${filteredSymbols.length} of ${symbols.length} total results`));

      // Close database connection
      await databaseService.close();

    } catch (error) {
      spinner.fail('Search failed');
      console.error(chalk.red('\n❌ Error during search:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show statistics about analyzed repositories')
  .option('--repo-id <id>', 'Show stats for specific repository')
  .action(async (options) => {
    const spinner = ora('Loading statistics...').start();

    try {
      await databaseService.runMigrations();

      // This would need additional database methods to get statistics
      spinner.succeed('Statistics loaded');

      console.log(chalk.blue(`\n${getEmoji('📊', 'Stats:')} Repository Statistics`));
      console.log(chalk.yellow('Statistics feature not yet fully implemented.'));
      console.log(chalk.gray('This requires additional database methods to aggregate data.'));

      // Close database connection
      await databaseService.close();

    } catch (error) {
      spinner.fail('Failed to load statistics');
      console.error(chalk.red('\n❌ Error loading statistics:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// Migration commands
program
  .command('migrate')
  .description('Run database migrations')
  .action(async () => {
    const spinner = ora('Running migrations...').start();

    try {
      await databaseService.runMigrations();
      spinner.succeed('Migrations completed successfully');

      console.log(chalk.green('\n✅ Database migrations completed!'));

      // Close database connection
      await databaseService.close();

    } catch (error) {
      spinner.fail('Migration failed');
      console.error(chalk.red('\n❌ Migration error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

program
  .command('migrate:rollback')
  .description('Rollback the last database migration')
  .action(async () => {
    const spinner = ora('Rolling back migrations...').start();

    try {
      await databaseService.rollbackMigrations();
      spinner.succeed('Migration rollback completed');

      console.log(chalk.green('\n✅ Database migration rollback completed!'));

      // Close database connection
      await databaseService.close();

    } catch (error) {
      spinner.fail('Rollback failed');
      console.error(chalk.red('\n❌ Rollback error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// Clear repository data command
program
  .command('clear')
  .description('Clear all data for a repository by name, or all repositories')
  .argument('<name>', 'Repository name to clear (use "all" to clear everything)')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (repositoryName, options) => {
    const spinner = ora('Initializing...').start();

    try {
      spinner.text = 'Connecting to database...';

      // Test database connection
      const { testDatabaseConnection } = await import('../database/connection');
      await testDatabaseConnection();

      // Handle "all" case
      if (repositoryName.toLowerCase() === 'all') {
        const allRepos = await databaseService.getAllRepositories();

        if (allRepos.length === 0) {
          spinner.succeed('No repositories to clear');
          console.log(chalk.gray('\nNo repositories found in database'));
          await databaseService.close();
          await cleanExit(0);
        }

        spinner.stop();

        // Show all repositories that will be cleared
        console.log(chalk.blue(`\nFound ${allRepos.length} repositories to clear:`));
        allRepos.forEach(repo => {
          console.log(chalk.gray(`  - ${repo.name} (${repo.path})`));
        });

        // Confirmation prompt (unless --yes flag is used)
        if (!options.yes) {
          const readline = require('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow(`\n${getEmoji('⚠️', '[WARN]')}  This will permanently delete ALL ${allRepos.length} repositories and their data. Continue? (y/N): `), resolve);
          });

          rl.close();

          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log(chalk.gray('\nOperation cancelled.'));
            await databaseService.close();
            await cleanExit(0);
          }
        }

        // Clear all repositories
        const clearSpinner = ora('Clearing all repositories...').start();

        for (const repo of allRepos) {
          clearSpinner.text = `Deleting ${repo.name}...`;
          await databaseService.deleteRepositoryCompletely(repo.id);
        }

        clearSpinner.succeed(`Successfully deleted ${allRepos.length} repositories`);
        console.log(chalk.green(`\n${getEmoji('✅', '[OK]')} All repositories have been deleted from the database.`));

        await databaseService.close();
        await cleanExit(0);
      }

      // Check if specific repository exists
      const repository = await databaseService.getRepositoryByName(repositoryName);

      if (!repository) {
        spinner.fail('Repository not found');
        console.error(chalk.red(`\n${getEmoji('❌', '[ERROR]')} Repository "${repositoryName}" not found in database`));

        // Show available repositories
        const allRepos = await databaseService.getAllRepositories();
        if (allRepos.length > 0) {
          console.log(chalk.gray('\nAvailable repositories:'));
          allRepos.forEach(repo => {
            console.log(chalk.gray(`  - ${repo.name} (${repo.path})`));
          });
        } else {
          console.log(chalk.gray('\nNo repositories found in database'));
        }

        await databaseService.close();
        process.exit(1);
      }

      spinner.stop();

      // Show repository info
      console.log(chalk.blue('\nRepository found:'));
      console.log(chalk.gray(`  Name: ${repository.name}`));
      console.log(chalk.gray(`  Path: ${repository.path}`));
      console.log(chalk.gray(`  ID: ${repository.id}`));
      if (repository.last_indexed) {
        console.log(chalk.gray(`  Last analyzed: ${repository.last_indexed.toISOString()}`));
      }

      // Confirmation prompt (unless --yes flag is used)
      if (!options.yes) {
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow('\n⚠️  This will permanently delete all data for this repository. Continue? (y/N): '), resolve);
        });

        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log(chalk.gray('\nOperation cancelled'));
          await databaseService.close();
          await cleanExit(0);
        }
      }

      // Perform deletion
      const deleteSpinner = ora('Deleting repository data...').start();

      const success = await databaseService.deleteRepositoryByName(repositoryName);

      if (success) {
        deleteSpinner.succeed('Repository data cleared successfully');
        console.log(chalk.green(`\n✅ All data for repository "${repositoryName}" has been cleared!`));
      } else {
        deleteSpinner.fail('Failed to clear repository data');
        console.error(chalk.red(`\n❌ Failed to clear data for repository "${repositoryName}"`));
        process.exit(1);
      }

      // Close database connection
      await databaseService.close();
      await cleanExit(0);

    } catch (error) {
      spinner.fail('Clear operation failed');
      console.error(chalk.red('\n❌ Clear operation error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// Cross-stack impact analysis command
program
  .command('cross-stack-impact')
  .description('Analyze cross-stack impact for a specific symbol')
  .argument('<symbol-id>', 'Symbol ID to analyze impact for')
  .option('--include-transitive', 'Include transitive dependencies in analysis', false)
  .option('--max-depth <depth>', 'Maximum depth for transitive analysis', '10')
  .option('--confidence-threshold <threshold>', 'Minimum confidence threshold (0.0-1.0)', '0.7')
  .action(async (symbolId, options) => {
    const spinner = ora('Analyzing cross-stack impact...').start();

    try {
      await databaseService.runMigrations();

      const { McpTools } = await import('../mcp/tools');
      const mcpTools = new McpTools(databaseService);

      const result = await mcpTools.impactOf({
        symbol_id: parseInt(symbolId),
        max_depth: parseInt(options.maxDepth),
        confidence_threshold: 0.7
      });

      spinner.succeed('Cross-stack impact analysis completed');

      const impact = JSON.parse(result.content[0].text);

      console.log(chalk.blue(`\n🔀 Cross-Stack Impact Analysis for Symbol ${symbolId}`));
      console.log(chalk.white(`Frontend Impact: ${impact.frontendImpact?.length || 0} components`));
      console.log(chalk.white(`Backend Impact: ${impact.backendImpact?.length || 0} routes/controllers`));
      console.log(chalk.white(`Cross-Stack Relationships: ${impact.crossStackRelationships?.length || 0}`));
      console.log(chalk.white(`Total Impacted Symbols: ${impact.totalImpactedSymbols || 0}`));

      if (impact.frontendImpact?.length > 0) {
        console.log(chalk.cyan('\n📱 Frontend Components Affected:'));
        impact.frontendImpact.slice(0, 10).forEach((component: any, index: number) => {
          console.log(chalk.gray(`  ${index + 1}. ${component.name} (${component.type})`));
        });
        if (impact.frontendImpact.length > 10) {
          console.log(chalk.gray(`  ... and ${impact.frontendImpact.length - 10} more`));
        }
      }

      if (impact.backendImpact?.length > 0) {
        console.log(chalk.cyan('\n🗄️ Backend Routes/Controllers Affected:'));
        impact.backendImpact.slice(0, 10).forEach((backend: any, index: number) => {
          console.log(chalk.gray(`  ${index + 1}. ${backend.name} (${backend.type})`));
        });
        if (impact.backendImpact.length > 10) {
          console.log(chalk.gray(`  ... and ${impact.backendImpact.length - 10} more`));
        }
      }

      console.log(chalk.blue(`\n⚡ Analysis completed in ${impact.executionTimeMs || 0}ms`));

      await databaseService.close();

    } catch (error) {
      spinner.fail('Cross-stack impact analysis failed');
      console.error(chalk.red('\n❌ Error during impact analysis:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// API calls analysis command
program
  .command('api-calls')
  .description('Analyze API calls between Vue components and Laravel routes')
  .argument('<repository-name>', 'Repository name to analyze')
  .option('--component <name>', 'Filter by specific component name')
  .option('--route <pattern>', 'Filter by specific route pattern')
  .option('--method <method>', 'Filter by HTTP method (GET, POST, PUT, DELETE)')
  .option('--confidence-threshold <threshold>', 'Minimum confidence threshold (0.0-1.0)', '0.5')
  .action(async (repositoryName, options) => {
    const spinner = ora('Analyzing API calls...').start();

    try {
      await databaseService.runMigrations();

      // Get repository by name
      const repository = await databaseService.getRepositoryByName(repositoryName);
      if (!repository) {
        spinner.fail('Repository not found');
        console.error(chalk.red(`❌ Repository "${repositoryName}" not found`));
        process.exit(1);
      }

      // Get API calls for the repository
      const crossStackData = await databaseService.getCrossStackDependencies(repository.id);
      let apiCalls = crossStackData.apiCalls;

      // Apply filters
      if (options.method) {
        apiCalls = apiCalls.filter(call => call.method?.toLowerCase() === options.method.toLowerCase());
      }

      const confidenceThreshold = parseFloat(options.confidenceThreshold);
      apiCalls = apiCalls.filter(call => call.confidence >= confidenceThreshold);

      spinner.succeed(`Found ${apiCalls.length} API calls`);

      console.log(chalk.blue(`\n🌐 API Calls Analysis for Repository: ${repositoryName}`));

      if (apiCalls.length === 0) {
        console.log(chalk.yellow('No API calls found matching your criteria.'));
        return;
      }

      apiCalls.slice(0, 20).forEach((call, index) => {
        console.log(chalk.white(`\n${index + 1}. ${call.method?.toUpperCase()} ${call.url_pattern}`));
        console.log(chalk.gray(`   Confidence: ${(call.confidence * 100).toFixed(1)}%`));
        if (call.request_schema) {
          console.log(chalk.gray(`   Request Schema: Available`));
        }
        if (call.response_schema) {
          console.log(chalk.gray(`   Response Schema: Available`));
        }
      });

      if (apiCalls.length > 20) {
        console.log(chalk.blue(`\nShowing 20 of ${apiCalls.length} total API calls`));
      }

      // Summary statistics
      const methodStats = apiCalls.reduce((acc: any, call) => {
        const method = call.method?.toUpperCase() || 'UNKNOWN';
        acc[method] = (acc[method] || 0) + 1;
        return acc;
      }, {});

      console.log(chalk.cyan('\n📊 Method Distribution:'));
      Object.entries(methodStats).forEach(([method, count]) => {
        console.log(chalk.gray(`   ${method}: ${count} calls`));
      });

      const avgConfidence = apiCalls.reduce((sum, call) => sum + call.confidence, 0) / apiCalls.length;
      console.log(chalk.cyan(`\n💯 Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`));

      await databaseService.close();

    } catch (error) {
      spinner.fail('API calls analysis failed');
      console.error(chalk.red('\n❌ Error during API calls analysis:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// Data contracts analysis command
program
  .command('data-contracts')
  .description('Analyze data contracts between TypeScript interfaces and PHP DTOs')
  .argument('<repository-name>', 'Repository name to analyze')
  .option('--schema <name>', 'Filter by specific schema/interface name')
  .option('--drift-only', 'Show only schemas with detected drift', false)
  .option('--include-drift-analysis', 'Include detailed drift analysis', false)
  .action(async (repositoryName, options) => {
    const spinner = ora('Analyzing data contracts...').start();

    try {
      await databaseService.runMigrations();

      // Get repository by name
      const repository = await databaseService.getRepositoryByName(repositoryName);
      if (!repository) {
        spinner.fail('Repository not found');
        console.error(chalk.red(`❌ Repository "${repositoryName}" not found`));
        process.exit(1);
      }

      // Get data contracts for the repository
      const crossStackData = await databaseService.getCrossStackDependencies(repository.id);
      let dataContracts = crossStackData.dataContracts;

      // Apply filters
      if (options.schema) {
        dataContracts = dataContracts.filter(contract =>
          contract.name.toLowerCase().includes(options.schema.toLowerCase())
        );
      }

      if (options.driftOnly) {
        dataContracts = dataContracts.filter(contract => contract.drift_detected);
      }

      spinner.succeed(`Found ${dataContracts.length} data contracts`);

      console.log(chalk.blue(`\n📋 Data Contracts Analysis for Repository: ${repositoryName}`));

      if (dataContracts.length === 0) {
        console.log(chalk.yellow('No data contracts found matching your criteria.'));
        return;
      }

      dataContracts.slice(0, 15).forEach((contract, index) => {
        console.log(chalk.white(`\n${index + 1}. ${contract.name}`));
        console.log(chalk.gray(`   Frontend Type ID: ${contract.frontend_type_id}`));
        console.log(chalk.gray(`   Backend Type ID: ${contract.backend_type_id}`));
        console.log(chalk.gray(`   Drift Detected: ${contract.drift_detected ? '⚠️ Yes' : '✅ No'}`));
        console.log(chalk.gray(`   Last Verified: ${new Date(contract.last_verified).toLocaleDateString()}`));

        if (contract.schema_definition && typeof contract.schema_definition === 'object') {
          const compatibility = contract.schema_definition.compatibility;
          if (compatibility !== undefined) {
            console.log(chalk.gray(`   Compatibility: ${(compatibility * 100).toFixed(1)}%`));
          }
        }
      });

      if (dataContracts.length > 15) {
        console.log(chalk.blue(`\nShowing 15 of ${dataContracts.length} total data contracts`));
      }

      // Summary statistics
      const driftCount = dataContracts.filter(c => c.drift_detected).length;
      const recentlyVerified = dataContracts.filter(c =>
        Date.now() - new Date(c.last_verified).getTime() < 7 * 24 * 60 * 60 * 1000 // 7 days
      ).length;

      console.log(chalk.cyan('\n📊 Contract Statistics:'));
      console.log(chalk.gray(`   Total Contracts: ${dataContracts.length}`));
      console.log(chalk.gray(`   With Drift: ${driftCount} (${((driftCount / dataContracts.length) * 100).toFixed(1)}%)`));
      console.log(chalk.gray(`   Recently Verified: ${recentlyVerified} (last 7 days)`));

      if (driftCount > 0) {
        console.log(chalk.yellow(`\n⚠️ ${driftCount} contracts have detected schema drift and may need attention`));
      }

      await databaseService.close();

    } catch (error) {
      spinner.fail('Data contracts analysis failed');
      console.error(chalk.red('\n❌ Error during data contracts analysis:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// Cross-stack statistics command
program
  .command('cross-stack-stats')
  .description('Display comprehensive cross-stack analysis statistics')
  .argument('<repository-name>', 'Repository name to analyze')
  .option('--confidence-threshold <threshold>', 'Minimum confidence threshold (0.0-1.0)', '0.8')
  .option('--health-check', 'Include system health check', false)
  .action(async (repositoryName, options) => {
    const spinner = ora('Gathering cross-stack statistics...').start();

    try {
      await databaseService.runMigrations();

      // Get repository by name
      const repository = await databaseService.getRepositoryByName(repositoryName);
      if (!repository) {
        spinner.fail('Repository not found');
        console.error(chalk.red(`❌ Repository "${repositoryName}" not found`));
        process.exit(1);
      }

      // Get cross-stack data
      const crossStackData = await databaseService.getCrossStackDependencies(repository.id);
      const { apiCalls, dataContracts } = crossStackData;

      // Get health information if requested
      let healthCheck;
      if (options.healthCheck) {
        healthCheck = await databaseService.performCrossStackHealthCheck(repository.id);
      }

      spinner.succeed('Cross-stack statistics gathered');

      console.log(chalk.blue(`\n📊 Cross-Stack Statistics for Repository: ${repositoryName}`));

      // API Calls Statistics
      console.log(chalk.cyan('\n🌐 API Calls:'));
      console.log(chalk.white(`   Total API Calls: ${apiCalls.length}`));

      if (apiCalls.length > 0) {
        const confidenceThreshold = parseFloat(options.confidenceThreshold);
        const highConfidenceCalls = apiCalls.filter(call => call.confidence >= confidenceThreshold);

        console.log(chalk.white(`   High Confidence (≥${(confidenceThreshold * 100).toFixed(0)}%): ${highConfidenceCalls.length}`));

        const avgConfidence = apiCalls.reduce((sum, call) => sum + call.confidence, 0) / apiCalls.length;
        console.log(chalk.white(`   Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`));

        const methodStats = apiCalls.reduce((acc: any, call) => {
          const method = call.method?.toUpperCase() || 'UNKNOWN';
          acc[method] = (acc[method] || 0) + 1;
          return acc;
        }, {});

        console.log(chalk.gray('   Method Distribution:'));
        Object.entries(methodStats).forEach(([method, count]) => {
          console.log(chalk.gray(`     ${method}: ${count}`));
        });
      }

      // Data Contracts Statistics
      console.log(chalk.cyan('\n📋 Data Contracts:'));
      console.log(chalk.white(`   Total Data Contracts: ${dataContracts.length}`));

      if (dataContracts.length > 0) {
        const driftCount = dataContracts.filter(c => c.drift_detected).length;
        console.log(chalk.white(`   With Schema Drift: ${driftCount} (${((driftCount / dataContracts.length) * 100).toFixed(1)}%)`));

        const recentlyVerified = dataContracts.filter(c =>
          Date.now() - new Date(c.last_verified).getTime() < 7 * 24 * 60 * 60 * 1000
        ).length;
        console.log(chalk.white(`   Recently Verified: ${recentlyVerified} (last 7 days)`));
      }

      // Health Check Results
      if (healthCheck) {
        console.log(chalk.cyan('\n🏥 System Health Check:'));
        console.log(chalk.white(`   Overall Status: ${healthCheck.status.toUpperCase()}`));

        const passedChecks = healthCheck.checks.filter(c => c.status === 'pass').length;
        console.log(chalk.white(`   Health Checks: ${passedChecks}/${healthCheck.checks.length} passed`));

        healthCheck.checks.forEach(check => {
          const icon = check.status === 'pass' ? '✅' : '❌';
          console.log(chalk.gray(`     ${icon} ${check.name}: ${check.message}`));
        });

        // Get additional health info
        const healthStats = await databaseService.getCrossStackHealth(repository.id);
        if (healthCheck && healthCheck.recommendations.length > 0) {
          console.log(chalk.cyan('\n💡 Recommendations:'));
          healthCheck.recommendations.forEach((rec: string) => {
            console.log(chalk.yellow(`   • ${rec}`));
          });
        }
      }

      // Overall Assessment
      const totalRelationships = apiCalls.length + dataContracts.length;
      console.log(chalk.cyan('\n📈 Overall Assessment:'));
      console.log(chalk.white(`   Total Cross-Stack Relationships: ${totalRelationships}`));

      if (totalRelationships > 0) {
        const healthyRelationships = apiCalls.filter(c => c.confidence >= 0.7).length +
                                   dataContracts.filter(c => !c.drift_detected).length;
        const healthPercentage = (healthyRelationships / totalRelationships) * 100;

        console.log(chalk.white(`   Healthy Relationships: ${healthyRelationships} (${healthPercentage.toFixed(1)}%)`));

        if (healthPercentage >= 90) {
          console.log(chalk.green('   🎉 Excellent cross-stack health!'));
        } else if (healthPercentage >= 70) {
          console.log(chalk.yellow('   ⚠️ Good cross-stack health with room for improvement'));
        } else {
          console.log(chalk.red('   🚨 Cross-stack health needs attention'));
        }
      }

      await databaseService.close();

    } catch (error) {
      spinner.fail('Cross-stack statistics failed');
      console.error(chalk.red('\n❌ Error gathering statistics:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      try {
        await databaseService.close();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// Help and error handling
program.configureHelp({
  sortSubcommands: true,
});

program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log(chalk.blue('See --help for a list of available commands.'));
  process.exit(1);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  console.error(chalk.red('\n💥 Uncaught exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  console.error(chalk.red('\n💥 Unhandled promise rejection:'), reason);
  process.exit(1);
});

// Parse arguments and run
program.parse();