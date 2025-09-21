import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseService } from '../../src/database/services';
import { getDatabaseConnection } from '../../src/database/connection';
import { CreateSymbol, CreateDependency, DependencyType, SymbolType, Visibility } from '../../src/database/models';
import { McpTools } from '../../src/mcp/tools';
import type { Knex } from 'knex';

describe('Parameter Context Integration Tests', () => {
  let db: Knex;
  let dbService: DatabaseService;
  let mcpTools: McpTools;
  let repoId: number;
  let fileId: number;

  beforeEach(async () => {
    db = getDatabaseConnection();
    dbService = new DatabaseService();
    mcpTools = new McpTools(dbService);

    // Clean up any existing test data
    await db('dependencies').where('line_number', '>', 9000).del();
    await db('symbols').where('name', 'like', 'Test%').del();
    await db('files').where('path', 'like', '%test%').del();
    await db('repositories').where('name', 'like', 'test%').del();

    // Create test repository and file
    const [repo] = await db('repositories').insert({
      name: 'test-parameter-context',
      path: '/tmp/test',
      framework_stack: JSON.stringify(['csharp', 'godot']),
      created_at: new Date(),
      updated_at: new Date()
    }).returning('*');
    repoId = repo.id;

    const [file] = await db('files').insert({
      repo_id: repoId,
      path: 'TestController.cs',
      language: 'csharp',
      size: 1000,
      is_generated: false,
      is_test: false,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('*');
    fileId = file.id;
  });

  afterEach(async () => {
    // Clean up test data
    await db('dependencies').where('line_number', '>', 9000).del();
    await db('symbols').where('name', 'like', 'Test%').del();
    await db('files').where('path', 'like', '%test%').del();
    await db('repositories').where('name', 'like', 'test%').del();
  });

  test('should demonstrate complete parameter context workflow', async () => {
    // Step 1: Create test symbols
    const callerSymbol: CreateSymbol = {
      file_id: fileId,
      name: 'TestInitializeServices',
      symbol_type: SymbolType.METHOD,
      start_line: 10,
      end_line: 20,
      is_exported: false,
      visibility: Visibility.PRIVATE
    };

    const targetSymbol: CreateSymbol = {
      file_id: fileId,
      name: 'TestSetHandPositions',
      symbol_type: SymbolType.METHOD,
      start_line: 30,
      end_line: 35,
      is_exported: true,
      visibility: Visibility.PUBLIC
    };

    const [caller] = await db('symbols').insert(callerSymbol).returning('*');
    const [target] = await db('symbols').insert(targetSymbol).returning('*');

    // Step 2: Create dependencies with parameter context (Enhancement 2)
    const dependency1: CreateDependency = {
      from_symbol_id: caller.id,
      to_symbol_id: target.id,
      dependency_type: DependencyType.CALLS,
      line_number: 9001,
      confidence: 0.95,
      parameter_context: '_handPosition, null',
      call_instance_id: '123e4567-e89b-12d3-a456-426614174001',
      parameter_types: ['var', 'null'],
      calling_object: '_cardManager',
      qualified_context: 'CardManager.TestSetHandPositions'
    };

    const dependency2: CreateDependency = {
      from_symbol_id: caller.id,
      to_symbol_id: target.id,
      dependency_type: DependencyType.CALLS,
      line_number: 9002,
      confidence: 0.92,
      parameter_context: 'playerHandPos, _handPosition',
      call_instance_id: '123e4567-e89b-12d3-a456-426614174002',
      parameter_types: ['var', 'var'],
      calling_object: '_cardManager',
      qualified_context: 'CardManager.TestSetHandPositions'
    };

    await dbService.createDependency(dependency1);
    await dbService.createDependency(dependency2);

    // Step 3: Test parameter context grouping
    const parameterAnalysis = await dbService.groupCallsByParameterContext(target.id);

    expect(parameterAnalysis.methodName).toBe('TestSetHandPositions');
    expect(parameterAnalysis.totalCalls).toBe(2);
    expect(parameterAnalysis.parameterVariations).toHaveLength(2);

    // Verify first parameter variation
    const variation1 = parameterAnalysis.parameterVariations.find(v =>
      v.parameter_context === '_handPosition, null'
    );
    expect(variation1).toBeDefined();
    expect(variation1!.call_count).toBe(1);
    expect(variation1!.call_instance_ids).toContain('123e4567-e89b-12d3-a456-426614174001');

    // Verify second parameter variation
    const variation2 = parameterAnalysis.parameterVariations.find(v =>
      v.parameter_context === 'playerHandPos, _handPosition'
    );
    expect(variation2).toBeDefined();
    expect(variation2!.call_count).toBe(1);
    expect(variation2!.call_instance_ids).toContain('123e4567-e89b-12d3-a456-426614174002');

    // Step 4: Test MCP tool integration
    const whoCallsResult = await mcpTools.whoCalls({
      symbol_id: target.id,
      show_call_chains: false
    });

    const response = JSON.parse(whoCallsResult.content[0].text);

    expect(response.symbol.name).toBe('TestSetHandPositions');
    expect(response.callers).toHaveLength(2);
    expect(response.parameter_analysis).toBeDefined();
    expect(response.parameter_analysis.total_variations).toBe(2);

    // Verify parameter analysis in MCP response
    const mcpVariation1 = response.parameter_analysis.parameter_variations.find((v: any) =>
      v.parameters === '_handPosition, null'
    );
    expect(mcpVariation1).toBeDefined();
    expect(mcpVariation1.call_count).toBe(1);

    const mcpVariation2 = response.parameter_analysis.parameter_variations.find((v: any) =>
      v.parameters === 'playerHandPos, _handPosition'
    );
    expect(mcpVariation2).toBeDefined();
    expect(mcpVariation2.call_count).toBe(1);

    // Verify insights are generated
    expect(response.parameter_analysis.insights).toContain(
      'Method called with 2 different parameter patterns'
    );
    expect(response.parameter_analysis.insights).toContain(
      '1 call pattern(s) use null parameters'
    );
  });

  test('should handle call chain visualization in MCP tools', async () => {
    // Create a simple call chain: caller1 -> caller2 -> target
    const symbols = await Promise.all([
      db('symbols').insert({
        file_id: fileId,
        name: 'TestCaller1',
        symbol_type: SymbolType.METHOD,
        start_line: 1,
        end_line: 5,
        is_exported: false,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*'),
      db('symbols').insert({
        file_id: fileId,
        name: 'TestCaller2',
        symbol_type: SymbolType.METHOD,
        start_line: 6,
        end_line: 10,
        is_exported: false,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*'),
      db('symbols').insert({
        file_id: fileId,
        name: 'TestTarget',
        symbol_type: SymbolType.METHOD,
        start_line: 11,
        end_line: 15,
        is_exported: true,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*')
    ]);

    const [caller1] = symbols[0];
    const [caller2] = symbols[1];
    const [target] = symbols[2];

    // Create dependencies
    await Promise.all([
      dbService.createDependency({
        from_symbol_id: caller1.id,
        to_symbol_id: caller2.id,
        dependency_type: DependencyType.CALLS,
        line_number: 9003,
        confidence: 0.9
      }),
      dbService.createDependency({
        from_symbol_id: caller2.id,
        to_symbol_id: target.id,
        dependency_type: DependencyType.CALLS,
        line_number: 9004,
        confidence: 0.85,
        parameter_context: 'testParam',
        call_instance_id: '123e4567-e89b-12d3-a456-426614174003'
      })
    ]);

    // Test whoCalls with call chain visualization
    const whoCallsResult = await mcpTools.whoCalls({
      symbol_id: target.id,
      include_indirect: true,
      show_call_chains: true
    });

    const response = JSON.parse(whoCallsResult.content[0].text);

    expect(response.transitive_analysis).toBeDefined();
    expect(response.filters.show_call_chains).toBe(true);

    // Note: The actual call chain formatting would be tested in the
    // TransitiveAnalyzer tests, but this verifies the integration
  });

  test('should demonstrate the specific SetHandPositions use case from the plan', async () => {
    // Create symbols that match the plan example
    const deckController = await db('symbols').insert({
      file_id: fileId,
      name: 'DeckController',
      symbol_type: SymbolType.CLASS,
      start_line: 1,
      end_line: 50,
      is_exported: true,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('*');

    const initializeServices = await db('symbols').insert({
      file_id: fileId,
      name: 'InitializeServices',
      symbol_type: SymbolType.METHOD,
      start_line: 10,
      end_line: 20,
      is_exported: false,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('*');

    const setHandPositions = await db('symbols').insert({
      file_id: fileId,
      name: 'SetHandPositions',
      symbol_type: SymbolType.METHOD,
      start_line: 30,
      end_line: 35,
      is_exported: true,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('*');

    // Create the specific dependencies mentioned in the plan
    await Promise.all([
      // Call 1: SetHandPositions(_handPosition, null) (line 226 equivalent)
      dbService.createDependency({
        from_symbol_id: initializeServices[0].id,
        to_symbol_id: setHandPositions[0].id,
        dependency_type: DependencyType.CALLS,
        line_number: 226,
        confidence: 0.95,
        parameter_context: '_handPosition, null',
        call_instance_id: '226-instance-id',
        parameter_types: ['var', 'null'],
        calling_object: '_cardManager'
      }),
      // Call 2: SetHandPositions(playerHandPos, _handPosition) (line 242 equivalent)
      dbService.createDependency({
        from_symbol_id: initializeServices[0].id,
        to_symbol_id: setHandPositions[0].id,
        dependency_type: DependencyType.CALLS,
        line_number: 242,
        confidence: 0.92,
        parameter_context: 'playerHandPos, _handPosition',
        call_instance_id: '242-instance-id',
        parameter_types: ['var', 'var'],
        calling_object: '_cardManager'
      })
    ]);

    // Test the parameter context analysis
    const analysis = await dbService.groupCallsByParameterContext(setHandPositions[0].id);

    expect(analysis.methodName).toBe('SetHandPositions');
    expect(analysis.totalCalls).toBe(2);
    expect(analysis.parameterVariations).toHaveLength(2);

    // Verify the specific use case from the plan
    const nullParamCall = analysis.parameterVariations.find(v =>
      v.parameter_context === '_handPosition, null'
    );
    const twoParamCall = analysis.parameterVariations.find(v =>
      v.parameter_context === 'playerHandPos, _handPosition'
    );

    expect(nullParamCall).toBeDefined();
    expect(nullParamCall!.line_numbers).toContain(226);
    expect(nullParamCall!.call_instance_ids).toContain('226-instance-id');

    expect(twoParamCall).toBeDefined();
    expect(twoParamCall!.line_numbers).toContain(242);
    expect(twoParamCall!.call_instance_ids).toContain('242-instance-id');

    // This demonstrates that we can now distinguish between:
    // - Call 1: SetHandPositions(_handPosition, null) (line 226)
    // - Call 2: SetHandPositions(playerHandPos, _handPosition) (line 242)
    // exactly as described in the plan!
  });
});