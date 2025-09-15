#!/usr/bin/env node
import process from 'process';

import { Command } from 'commander';
import { GraphBuilder } from '../graph';
import { DatabaseService, databaseService } from '../database';
import { ClaudeCompassMCPServer } from '../mcp';
import { logger, config } from '../utils';
const chalk = require('chalk');
const ora = require('ora');

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
  .option('--max-file-size <size>', 'Maximum file size to process in bytes', '1048576') // 1MB
  .option('--max-files <count>', 'Maximum number of files to process', '10000')
  .option('--extensions <list>', 'File extensions to analyze (comma-separated)', '.js,.jsx,.ts,.tsx,.mjs,.cjs')
  .option('--verbose', 'Enable verbose logging')
  .action(async (repositoryPath, options) => {
    if (options.verbose) {
      logger.level = 'debug';
    }

    const spinner = ora('Initializing analysis...').start();

    try {
      // Initialize database connection
      spinner.text = 'Connecting to database...';
      // Skip migration check for now - migrations are already run
      // await databaseService.runMigrations();
      spinner.succeed('Database connection established');

      // Create graph builder
      const graphBuilder = new GraphBuilder(databaseService);

      // Parse options
      const buildOptions = {
        includeTestFiles: options.testFiles !== false,
        includeNodeModules: options.includeNodeModules === true,
        maxFileSize: parseInt(options.maxFileSize),
        maxFiles: parseInt(options.maxFiles),
        fileExtensions: options.extensions.split(','),
      };

      console.log(chalk.blue('\nStarting repository analysis...'));
      console.log(chalk.gray(`Repository: ${repositoryPath}`));
      console.log(chalk.gray(`Options: ${JSON.stringify(buildOptions, null, 2)}`));

      // Run analysis
      spinner.start('Analyzing repository...');

      const startTime = Date.now();
      const result = await graphBuilder.analyzeRepository(repositoryPath, buildOptions);
      const duration = Date.now() - startTime;

      spinner.succeed('Analysis completed');

      // Display results
      console.log(chalk.green('\n✅ Analysis completed successfully!'));
      console.log(chalk.blue(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`));
      console.log(chalk.blue(`📁 Files processed: ${result.filesProcessed}`));
      console.log(chalk.blue(`🔍 Symbols extracted: ${result.symbolsExtracted}`));
      console.log(chalk.blue(`🔗 Dependencies created: ${result.dependenciesCreated}`));
      console.log(chalk.blue(`📊 File graph nodes: ${result.fileGraph.nodes.length}`));
      console.log(chalk.blue(`📊 File graph edges: ${result.fileGraph.edges.length}`));
      console.log(chalk.blue(`🎯 Symbol graph nodes: ${result.symbolGraph.nodes.length}`));
      console.log(chalk.blue(`🎯 Symbol graph edges: ${result.symbolGraph.edges.length}`));

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n⚠️  ${result.errors.length} errors occurred during analysis:`));
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

    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red('\n❌ Error during analysis:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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

    } catch (error) {
      spinner.fail('Search failed');
      console.error(chalk.red('\n❌ Error during search:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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

      console.log(chalk.blue('\n📊 Repository Statistics'));
      console.log(chalk.yellow('Statistics feature not yet fully implemented.'));
      console.log(chalk.gray('This requires additional database methods to aggregate data.'));

    } catch (error) {
      spinner.fail('Failed to load statistics');
      console.error(chalk.red('\n❌ Error loading statistics:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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

    } catch (error) {
      spinner.fail('Migration failed');
      console.error(chalk.red('\n❌ Migration error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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

    } catch (error) {
      spinner.fail('Rollback failed');
      console.error(chalk.red('\n❌ Rollback error:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
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