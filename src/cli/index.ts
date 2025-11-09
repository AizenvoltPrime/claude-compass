#!/usr/bin/env node
import process from 'process';
import path from 'path';

import { Command } from 'commander';
import { GraphBuilder } from '../graph';
import { getDatabaseConnection, closeDatabaseConnection } from '../database';
import * as AdminService from '../database/services/admin-service';
import * as SearchService from '../database/services/search-service';
import * as RepositoryService from '../database/services/repository-service';
import * as CleanupService from '../database/services/cleanup-service';
import { ClaudeCompassMCPServer } from '../mcp';
import { logger, config, flushLogs } from '../utils';
import { FileSizeUtils, DEFAULT_POLICY } from '../config/file-size-policy';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import { CSharpParser } from '../parsers/csharp';

// Framework detection helper using recursive search
async function detectFrameworksEarly(repositoryPath: string): Promise<string[]> {
  const { readPackageJson, readComposerJson, detectJsFrameworks, detectPhpFrameworks } =
    await import('../parsers/framework-detector/file-io-utils');

  const frameworks: string[] = [];

  const packageJson = await readPackageJson(repositoryPath);
  frameworks.push(...detectJsFrameworks(packageJson));

  const composerJson = await readComposerJson(repositoryPath);
  frameworks.push(...detectPhpFrameworks(composerJson));

  try {
    const projectGodotPath = path.join(repositoryPath, 'project.godot');
    await fs.access(projectGodotPath);
    frameworks.push('godot');
  } catch {
    // Ignore errors
  }

  return frameworks;
}

// Check if project uses external API configuration
async function hasExternalApiConfig(repositoryPath: string): Promise<boolean> {
  try {
    const envPath = path.join(repositoryPath, '.env');
    const envContent = await fs.readFile(envPath, 'utf-8');

    // Check for common external API URL patterns
    const externalApiPatterns = [
      /API_URL=.*:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
      /VUE_APP_API_URL=.*:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
      /VITE_API_URL=.*:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
      /NEXT_PUBLIC_API_URL=.*:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
      /BACKEND_URL=.*:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
    ];

    return externalApiPatterns.some(pattern => pattern.test(envContent));
  } catch {
    // If .env doesn't exist or can't be read, assume no external API
    return false;
  }
}

// Determine if cross-stack analysis should be auto-enabled
async function shouldEnableCrossStack(
  repositoryPath: string,
  detectedFrameworks: string[],
  explicitFlag: boolean | undefined
): Promise<{ enabled: boolean; reason: string }> {
  // If user explicitly set the flag, respect it
  if (explicitFlag !== undefined) {
    return {
      enabled: explicitFlag,
      reason: explicitFlag ? 'explicitly enabled via --cross-stack' : 'explicitly disabled via --no-cross-stack'
    };
  }

  // Check for Vue + Laravel combination
  const hasVue = detectedFrameworks.some(f => ['vue', 'nuxt'].includes(f));
  const hasLaravel = detectedFrameworks.includes('laravel');

  if (!hasVue || !hasLaravel) {
    return { enabled: false, reason: 'Vue + Laravel not both detected' };
  }

  // Check for external API configuration
  const hasExternalApi = await hasExternalApiConfig(repositoryPath);

  if (hasExternalApi) {
    return {
      enabled: false,
      reason: 'external API configuration detected in .env (use --cross-stack to override)'
    };
  }

  return {
    enabled: true,
    reason: 'Vue + Laravel detected in same repository'
  };
}

// Debug file mode handler
async function handleDebugFileMode(repositoryPath: string, debugFile: string, options: any): Promise<void> {
  console.log(chalk.blue(`🔍 Debug Mode: Analyzing single file`));
  console.log(chalk.gray(`Repository: ${repositoryPath}`));
  console.log(chalk.gray(`Debug File: ${debugFile}`));

  try {
    // Resolve file path (can be relative to repository or absolute)
    let filePath: string;
    if (path.isAbsolute(debugFile)) {
      filePath = debugFile;
    } else {
      filePath = path.resolve(repositoryPath, debugFile);
    }

    // Read file content
    const content = await fs.readFile(filePath, 'utf-8');
    console.log(chalk.green(`✓ Read file (${content.length} bytes)`));

    // Optionally enable debug logging (disabled by default to prevent hanging)
    if (options.verbose) {
      logger.level = 'debug';
      process.env.CLAUDE_COMPASS_DEBUG = 'true';
    }

    // Create parser based on file extension
    const ext = path.extname(filePath).toLowerCase();
    let parser: any;

    switch (ext) {
      case '.cs':
        parser = new CSharpParser();
        break;
      default:
        throw new Error(`Unsupported file extension: ${ext}`);
    }

    // Parse the file with timeout
    console.log(chalk.blue(`🔧 Parsing with ${parser.constructor.name}...`));

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Parsing timeout after 30 seconds')), 30000);
    });

    // Race between parsing and timeout
    const result = await Promise.race([
      parser.parseFile(filePath, content),
      timeoutPromise
    ]).catch(error => {
      throw error;
    });

    // Display results
    console.log(chalk.green(`✓ Parsing completed`));
    console.log(chalk.blue(`📊 Results:`));
    console.log(`  - Symbols: ${result.symbols.length}`);
    console.log(`  - Dependencies: ${result.dependencies.length}`);
    console.log(`  - Imports: ${result.imports.length}`);
    console.log(`  - Exports: ${result.exports.length}`);

    // Show some sample dependencies
    if (result.dependencies.length > 0) {
      console.log(chalk.blue(`\n🔗 Sample Dependencies:`));
      // Show HandManager dependencies first if they exist
      const handManagerDeps = result.dependencies.filter((dep: any) =>
        dep.to_symbol?.includes('HandManager') || dep.from_symbol?.includes('HandManager')
      );

      if (handManagerDeps.length > 0) {
        console.log(chalk.green(`\n✅ HandManager Qualified Dependencies:`));
        handManagerDeps.slice(0, 20).forEach((dep: any, i: number) => {
          console.log(`  ${i + 1}. ${dep.from_symbol} → ${dep.to_symbol} (${dep.dependency_type})`);
        });
      }

      result.dependencies.slice(0, 10).forEach((dep: any, i: number) => {
        console.log(`  ${i + 1}. ${dep.from_symbol} → ${dep.to_symbol} (${dep.dependency_type})`);
      });

      if (result.dependencies.length > 10) {
        console.log(`  ... and ${result.dependencies.length - 10} more`);
      }
    }

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    process.exit(1);
  }
}

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
  const supportsUnicode =
    process.env.TERM !== 'dumb' &&
    (!process.env.CI || process.env.CI === 'false') &&
    process.platform !== 'win32';

  return supportsUnicode ? emoji : fallback;
};

const program = new Command();

program
  .name('claude-compass')
  .description('AI-native development environment - analyze codebases and build contextual graphs\nSupports: JavaScript, TypeScript, Vue.js, React, Next.js, Node.js, PHP, Laravel, C#, and Godot')
  .version('0.1.0');

// Analyze command
program
  .command('analyze')
  .description('Analyze a repository and build comprehensive graphs for AI assistants\nAutomatically detects: JavaScript/TypeScript, Vue.js, React, Next.js, Node.js, PHP/Laravel, C#/Godot projects')
  .argument('<path>', 'Path to the repository to analyze')
  .option('--no-test-files', 'Exclude test files from analysis')
  .option('--include-node-modules', 'Include node_modules in analysis (not recommended)')
  .option('--max-file-size <size>', 'Maximum file size to process in bytes', '20971520') // 20MB
  .option('--chunking-threshold <size>', 'File size to start chunking', '51200') // 50KB
  .option('--warn-threshold <size>', 'File size to warn about', '2097152') // 2MB
  .option('--debug-file <file>', 'Debug mode: analyze only the specified file (for debugging parser issues)')
  .option('--max-files <count>', 'Maximum number of files to process', '10000')
  .option(
    '--extensions <list>',
    'File extensions to analyze (comma-separated)',
    '.js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.php,.cs,.tscn,.godot'
  )
  .option('--compassignore <path>', 'Path to .compassignore file', '.compassignore')
  .option('--chunk-overlap <lines>', 'Overlap lines between chunks', '100')
  .option('--encoding-fallback <encoding>', 'Fallback encoding for problematic files', 'iso-8859-1')
  .option('--parallel-parsing', 'Enable parallel file parsing', true)
  .option('--max-concurrency <number>', 'Maximum concurrent file parsing operations (default: 10)', '10')
  .option('--skip-embeddings', 'Skip embedding generation (faster analysis, vector search disabled)', false)
  .option('--cross-stack', 'Enable cross-stack analysis for Vue ↔ Laravel projects (auto-enabled when both frameworks detected)')
  .option('--no-cross-stack', 'Disable cross-stack analysis even when frameworks detected')
  .option(
    '--vue-laravel',
    'Specifically analyze Vue.js and Laravel cross-stack relationships',
    false
  )
  .option('--force-full', 'Force full analysis instead of incremental analysis', false)
  .option('--verbose', 'Enable verbose logging')
  .action(async (repositoryPath, options) => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    // Handle debug file mode
    if (options.debugFile) {
      return handleDebugFileMode(repositoryPath, options.debugFile, options);
    }

    // Resolve relative paths to absolute paths
    const absolutePath = path.resolve(repositoryPath);

    const spinner = ora('Initializing analysis...').start();

    try {
      // Detect frameworks early for smart defaults
      spinner.text = 'Detecting frameworks...';
      const detectedFrameworks = await detectFrameworksEarly(absolutePath);

      // Determine cross-stack flag value (undefined if not explicitly set)
      let crossStackFlag: boolean | undefined = undefined;
      if (options.crossStack === true) {
        crossStackFlag = true;
      } else if (options.crossStack === false) {
        crossStackFlag = false;
      }

      // Auto-enable cross-stack if appropriate
      const crossStackDecision = await shouldEnableCrossStack(
        absolutePath,
        detectedFrameworks,
        crossStackFlag
      );

      const enableCrossStack = crossStackDecision.enabled || options.vueLaravel === true;

      // Log framework detection and cross-stack decision
      if (detectedFrameworks.length > 0) {
        spinner.succeed(`Detected frameworks: ${detectedFrameworks.join(', ')}`);
        if (enableCrossStack) {
          console.log(chalk.cyan(`${getEmoji('🔀', '[CS]')} Cross-stack analysis: enabled (${crossStackDecision.reason})`));
        }
      } else {
        spinner.succeed('Framework detection complete');
      }

      // Initialize database connection
      spinner.text = 'Connecting to database...';
      spinner.succeed('Database connection established');

      // Create graph builder
      const graphBuilder = new GraphBuilder(getDatabaseConnection());

      // Parse options
      const buildOptions = {
        includeTestFiles: options.testFiles !== false,
        includeNodeModules: options.includeNodeModules === true,
        maxFiles: parseInt(options.maxFiles),
        fileExtensions: options.extensions.split(','),

        chunkOverlapLines: parseInt(options.chunkOverlap),
        encodingFallback: options.encodingFallback,
        compassignorePath: options.compassignore,
        enableParallelParsing: options.parallelParsing !== false,
        maxConcurrency: options.maxConcurrency ? parseInt(options.maxConcurrency) : 10,
        skipEmbeddings: options.skipEmbeddings === true,
        forceFullAnalysis: options.forceFull === true,

        // Cross-stack analysis options (smart defaults applied)
        enableCrossStackAnalysis: enableCrossStack,
        crossStackFrameworks: options.vueLaravel === true ? ['vue', 'laravel'] : undefined,

        // File size policy options (using aggressive preset)
        fileSizePolicy: {
          ...DEFAULT_POLICY,
          ...(options.maxFileSize ? { maxFileSize: parseInt(options.maxFileSize) } : {}),
          ...(options.chunkingThreshold
            ? { chunkingThreshold: parseInt(options.chunkingThreshold) }
            : {}),
          ...(options.warnThreshold ? { warnThreshold: parseInt(options.warnThreshold) } : {}),
        },
      };

      console.log(chalk.blue('\nStarting repository analysis...'));
      console.log(chalk.gray(`Repository: ${absolutePath}`));

      // Run analysis (GraphBuilder will automatically detect if incremental is possible)
      spinner.start('Analyzing repository...');

      const startTime = Date.now();
      const result = await graphBuilder.analyzeRepository(absolutePath, buildOptions);
      const duration = Date.now() - startTime;

      spinner.succeed('Analysis completed');

      await flushLogs();

      // Display results
      console.log(chalk.green(`\n${getEmoji('✅', '[OK]')} Analysis completed successfully!`));
      console.log(
        chalk.blue(`${getEmoji('⏱️', 'Time:')}  Duration: ${(duration / 1000).toFixed(2)}s`)
      );
      console.log(
        chalk.blue(`${getEmoji('📁', 'Files:')} Files processed: ${result.filesProcessed}`)
      );
      console.log(
        chalk.blue(`${getEmoji('🔍', 'Symbols:')} Symbols extracted: ${result.symbolsExtracted}`)
      );
      console.log(
        chalk.blue(`${getEmoji('🔗', 'Deps:')} Dependencies created: ${result.dependenciesCreated}`)
      );
      console.log(
        chalk.blue(`${getEmoji('📊', 'Graph:')} File graph nodes: ${result.fileGraph.nodes.length}`)
      );
      console.log(
        chalk.blue(`${getEmoji('📊', 'Graph:')} File graph edges: ${result.fileGraph.edges.length}`)
      );
      console.log(
        chalk.blue(
          `${getEmoji('🎯', 'Graph:')} Symbol graph nodes: ${result.symbolGraph.nodes.length}`
        )
      );
      console.log(
        chalk.blue(
          `${getEmoji('🎯', 'Graph:')} Symbol graph edges: ${result.symbolGraph.edges.length}`
        )
      );

      // Display cross-stack results if enabled
      if (buildOptions.enableCrossStackAnalysis && result.crossStackGraph) {
        console.log(chalk.magenta(`\n${getEmoji('🔀', 'Cross:')} Cross-Stack Analysis Results:`));
        console.log(
          chalk.magenta(
            `${getEmoji('🌐', 'API:')} API calls detected: ${result.crossStackGraph.apiCallGraph?.metadata.apiCalls || 0}`
          )
        );

        // Show breakdown of API calls by source
        const vueApiCalls = result.crossStackGraph.apiCallGraph?.metadata.vueApiCalls;
        const tsApiCalls = result.crossStackGraph.apiCallGraph?.metadata.typescriptApiCalls;
        if (vueApiCalls !== undefined || tsApiCalls !== undefined) {
          console.log(
            chalk.gray(`  ├─ Vue components: ${vueApiCalls || 0} calls`)
          );
          console.log(
            chalk.gray(`  └─ TypeScript files: ${tsApiCalls || 0} calls`)
          );
        }

        // Show backend endpoints
        const backendEndpoints = result.crossStackGraph.apiCallGraph?.metadata.backendEndpoints;
        if (backendEndpoints !== undefined) {
          console.log(
            chalk.cyan(`${getEmoji('🔌', 'Backend:')} Backend API endpoints: ${backendEndpoints}`)
          );
        }

        console.log(
          chalk.magenta(
            `${getEmoji('📋', 'Schema:')} Data contracts: ${result.crossStackGraph.dataContractGraph?.metadata.dataContracts || 0}`
          )
        );
        console.log(
          chalk.magenta(
            `${getEmoji('🎛️', 'Features:')} Feature clusters: ${result.crossStackGraph.features?.length || 0}`
          )
        );
      }

      if (result.errors.length > 0) {
        console.log(
          chalk.yellow(
            `\n${getEmoji('⚠️', '[WARN]')}  ${result.errors.length} errors occurred during analysis:`
          )
        );
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
      console.log(
        chalk.blue(
          `\n${getEmoji('⏱️', 'Time:')} Total analysis time: ${(duration / 1000).toFixed(2)}s`
        )
      );

      // Final flush to ensure no logs appear after completion stats
      await flushLogs();

      // Close database connection
      await closeDatabaseConnection();

      // Exit cleanly
      await cleanExit(0);
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`\n${getEmoji('❌', '[ERROR]')} Error during analysis:`));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      await flushLogs();

      // Close database connection even in error case
      try {
        await closeDatabaseConnection();
      } catch (closeError) {
        // Ignore close errors
      }

      process.exit(1);
    }
  });

// MCP Server command (stdio transport)
program
  .command('mcp-server')
  .description('Start the MCP server for AI integration (stdio transport)')
  .option('--port <port>', 'Port to listen on', config.mcpServer.port.toString())
  .option('--host <host>', 'Host to bind to', config.mcpServer.host)
  .option('--verbose', 'Enable verbose logging')
  .action(async options => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    const spinner = ora('Starting MCP server...').start();

    try {
      // Initialize database connection
      await AdminService.runMigrations();
      spinner.succeed('Database connection established');

      console.log(chalk.blue('\n🚀 Starting Claude Compass MCP Server (stdio)...'));
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

// HTTP MCP Server command (HTTP/SSE transport)
program
  .command('http-server')
  .description('Start the MCP server with HTTP/SSE transport')
  .option('--port <port>', 'Port to listen on', '3000')
  .option('--host <host>', 'Host to bind to', 'localhost')
  .option('--allow-all-hosts', 'Disable DNS rebinding protection (allow connections from any host)', false)
  .option('--verbose', 'Enable verbose logging')
  .action(async options => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    const spinner = ora('Starting HTTP MCP server...').start();

    try {
      // Initialize database connection
      await AdminService.runMigrations();
      spinner.succeed('Database connection established');

      // Set environment variables for the HTTP server
      process.env.MCP_HTTP_PORT = options.port;
      process.env.MCP_HTTP_HOST = options.host;
      process.env.MCP_ALLOW_ALL_HOSTS = options.allowAllHosts ? 'true' : 'false';

      if (options.allowAllHosts) {
        console.log(chalk.yellow('\n⚠️  WARNING: DNS rebinding protection disabled. Server will accept connections from any host.'));
      }

      spinner.text = 'Launching HTTP server...';

      // Import and start the HTTP server
      // This will run the http-server.ts file which sets up Express
      await import('../mcp/examples/http-server.js');

      spinner.succeed('HTTP MCP Server started');
    } catch (error) {
      spinner.fail('Failed to start HTTP MCP server');
      console.error(chalk.red('\n❌ Error starting HTTP server:'));
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
      await AdminService.runMigrations();

      const repoId = options.repoId ? parseInt(options.repoId) : undefined;
      const symbols = await SearchService.searchSymbols(getDatabaseConnection(),query, repoId);

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

      console.log(
        chalk.blue(`\nShowing ${filteredSymbols.length} of ${symbols.length} total results`)
      );

      // Close database connection
      await closeDatabaseConnection();
    } catch (error) {
      spinner.fail('Search failed');
      console.error(chalk.red('\n❌ Error during search:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await closeDatabaseConnection();
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
  .action(async options => {
    const spinner = ora('Loading statistics...').start();

    try {
      await AdminService.runMigrations();

      // This would need additional database methods to get statistics
      spinner.succeed('Statistics loaded');

      console.log(chalk.blue(`\n${getEmoji('📊', 'Stats:')} Repository Statistics`));
      console.log(chalk.yellow('Statistics feature not yet fully implemented.'));
      console.log(chalk.gray('This requires additional database methods to aggregate data.'));

      // Close database connection
      await closeDatabaseConnection();
    } catch (error) {
      spinner.fail('Failed to load statistics');
      console.error(chalk.red('\n❌ Error loading statistics:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await closeDatabaseConnection();
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
      await AdminService.runMigrations();
      spinner.succeed('Migrations completed successfully');

      console.log(chalk.green('\n✅ Database migrations completed!'));

      // Close database connection
      await closeDatabaseConnection();
    } catch (error) {
      spinner.fail('Migration failed');
      console.error(chalk.red('\n❌ Migration error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await closeDatabaseConnection();
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
      await AdminService.rollbackMigrations();
      spinner.succeed('Migration rollback completed');

      console.log(chalk.green('\n✅ Database migration rollback completed!'));

      // Close database connection
      await closeDatabaseConnection();
    } catch (error) {
      spinner.fail('Rollback failed');
      console.error(chalk.red('\n❌ Rollback error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await closeDatabaseConnection();
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
        const db = getDatabaseConnection();
        const allRepos = await RepositoryService.getAllRepositories(db);

        if (allRepos.length === 0) {
          spinner.succeed('No repositories to clear');
          console.log(chalk.gray('\nNo repositories found in database'));
          await closeDatabaseConnection();
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
            output: process.stdout,
          });

          const answer = await new Promise<string>(resolve => {
            rl.question(
              chalk.yellow(
                `\n${getEmoji('⚠️', '[WARN]')}  This will permanently delete ALL ${allRepos.length} repositories and their data. Continue? (y/N): `
              ),
              resolve
            );
          });

          rl.close();

          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log(chalk.gray('\nOperation cancelled.'));
            await closeDatabaseConnection();
            await cleanExit(0);
          }
        }

        // Clear all repositories
        const clearSpinner = ora('Clearing all repositories...').start();

        for (const repo of allRepos) {
          clearSpinner.text = `Deleting ${repo.name}...`;
          await CleanupService.cleanupRepositoryData(db, repo.id);
          await RepositoryService.deleteRepository(db, repo.id);
        }

        clearSpinner.succeed(`Successfully deleted ${allRepos.length} repositories`);
        console.log(
          chalk.green(
            `\n${getEmoji('✅', '[OK]')} All repositories have been deleted from the database.`
          )
        );

        await closeDatabaseConnection();
        await cleanExit(0);
      }

      // Check if specific repository exists
      const db = getDatabaseConnection();
      const repository = await RepositoryService.getRepositoryByName(db, repositoryName);

      if (!repository) {
        spinner.fail('Repository not found');
        console.error(
          chalk.red(
            `\n${getEmoji('❌', '[ERROR]')} Repository "${repositoryName}" not found in database`
          )
        );

        // Show available repositories
        const allRepos = await RepositoryService.getAllRepositories(db);
        if (allRepos.length > 0) {
          console.log(chalk.gray('\nAvailable repositories:'));
          allRepos.forEach(repo => {
            console.log(chalk.gray(`  - ${repo.name} (${repo.path})`));
          });
        } else {
          console.log(chalk.gray('\nNo repositories found in database'));
        }

        await closeDatabaseConnection();
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
          output: process.stdout,
        });

        const answer = await new Promise<string>(resolve => {
          rl.question(
            chalk.yellow(
              '\n⚠️  This will permanently delete all data for this repository. Continue? (y/N): '
            ),
            resolve
          );
        });

        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log(chalk.gray('\nOperation cancelled'));
          await closeDatabaseConnection();
          await cleanExit(0);
        }
      }

      // Perform deletion
      const deleteSpinner = ora('Deleting repository data...').start();

      await CleanupService.cleanupRepositoryData(db, repository.id);
      const success = await RepositoryService.deleteRepository(db, repository.id);

      if (success) {
        deleteSpinner.succeed('Repository data cleared successfully');
        console.log(
          chalk.green(`\n✅ All data for repository "${repositoryName}" has been cleared!`)
        );
      } else {
        deleteSpinner.fail('Failed to clear repository data');
        console.error(chalk.red(`\n❌ Failed to clear data for repository "${repositoryName}"`));
        process.exit(1);
      }

      // Close database connection
      await closeDatabaseConnection();
      await cleanExit(0);
    } catch (error) {
      spinner.fail('Clear operation failed');
      console.error(chalk.red('\n❌ Clear operation error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));

      // Close database connection even in error case
      try {
        await closeDatabaseConnection();
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
process.on('uncaughtException', error => {
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
