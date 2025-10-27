import { GraphBuilder } from '../../src/graph/builder';
import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { FileDependency } from '../../src/database/models';
import path from 'path';
import fs from 'fs/promises';
import type { Knex } from 'knex';
import * as CleanupService from '../../src/database/services/cleanup-service';
import * as RepositoryService from '../../src/database/services/repository-service';
import * as FileService from '../../src/database/services/file-service';
import * as SymbolService from '../../src/database/services/symbol-service';
import * as DependencyService from '../../src/database/services/dependency-service';

describe('C# File Discovery Integration Tests', () => {
  let builder: GraphBuilder;
  let db: Knex;
  let testProjectPath: string;

  beforeAll(async () => {
    // Initialize database service with test database
    db = getDatabaseConnection();
    builder = new GraphBuilder(db);

    // Create test project directory
    testProjectPath = path.join(__dirname, 'fixtures', 'csharp-test-project');
  });

  afterAll(async () => {
    // Clean up test project
    await fs.rm(testProjectPath, { recursive: true, force: true });
    await closeDatabaseConnection();
  });

  beforeEach(async () => {
    // Clear any existing repository data
    await CleanupService.deleteRepositoryByName(db, 'csharp-test-project');

    // Clean up any existing test project files
    await fs.rm(testProjectPath, { recursive: true, force: true });

    // Setup test project files
    await setupTestCSharpProject(testProjectPath);
  });

  describe('C# File Discovery', () => {
    it('should discover C# files with .cs extension', async () => {
      const result = await builder.analyzeRepository(testProjectPath, {
        includeTestFiles: true,
        fileExtensions: ['.cs', '.js', '.ts'] // Explicitly include .cs
      });

      expect(result.filesProcessed).toBeGreaterThan(0);

      // Verify that C# files were discovered
      const repository = await RepositoryService.getRepository(db,result.repository.id);
      expect(repository).toBeDefined();

      const files = await FileService.getFilesByRepository(db,result.repository.id);
      const csFiles = files.filter(f => f.path.endsWith('.cs'));

      expect(csFiles.length).toBeGreaterThan(0);
      expect(csFiles.some(f => f.path.includes('CardManager.cs'))).toBe(true);
      expect(csFiles.some(f => f.path.includes('IHandManager.cs'))).toBe(true);
    });

    it('should discover C# files with default file extensions (includes .cs)', async () => {
      // Test with default options - should include .cs now
      const result = await builder.analyzeRepository(testProjectPath, {
        includeTestFiles: true
        // No explicit fileExtensions - should use defaults which now include .cs
      });

      expect(result.filesProcessed).toBeGreaterThan(0);

      const files = await FileService.getFilesByRepository(db,result.repository.id);
      const csFiles = files.filter(f => f.path.endsWith('.cs'));

      expect(csFiles.length).toBeGreaterThan(0);
      expect(csFiles.some(f => f.path.includes('CardManager.cs'))).toBe(true);
    });

    it('should correctly detect language as csharp for .cs files', async () => {
      const result = await builder.analyzeRepository(testProjectPath);

      const files = await FileService.getFilesByRepository(db,result.repository.id);
      const csFiles = files.filter(f => f.path.endsWith('.cs'));

      csFiles.forEach(file => {
        expect(file.language).toBe('csharp');
      });
    });

    it('should extract symbols from C# files', async () => {
      const result = await builder.analyzeRepository(testProjectPath);

      expect(result.symbolsExtracted).toBeGreaterThan(0);

      const symbols = await SymbolService.getSymbolsByRepository(db,result.repository.id);

      // Should find CardManager class
      const cardManagerSymbol = symbols.find(s => s.name === 'CardManager');
      expect(cardManagerSymbol).toBeDefined();
      expect(cardManagerSymbol?.symbol_type).toBe('class');

      // Should find SetHandPositions method
      const setHandPositionsSymbol = symbols.find(s => s.name === 'SetHandPositions');
      expect(setHandPositionsSymbol).toBeDefined();
      expect(setHandPositionsSymbol?.symbol_type).toBe('method');

      // Should find IHandManager interface
      const handManagerInterface = symbols.find(s => s.name === 'IHandManager');
      expect(handManagerInterface).toBeDefined();
      expect(handManagerInterface?.symbol_type).toBe('interface');
    });

    it('should detect method call dependencies in C# files', async () => {
      const result = await builder.analyzeRepository(testProjectPath);

      expect(result.dependenciesCreated).toBeGreaterThan(0);

      // Get symbols to check for SetHandPositions
      const symbols = await SymbolService.getSymbolsByRepository(db,result.repository.id);
      const setHandPositionsSymbol = symbols.find(s => s.name === 'SetHandPositions');

      if (setHandPositionsSymbol) {
        // Check if there are dependencies to this symbol
        const dependenciesTo = await DependencyService.getDependenciesTo(db,setHandPositionsSymbol.id);
        expect(dependenciesTo.length).toBeGreaterThan(0);
      }
    });

    it('should handle parsing errors gracefully', async () => {
      // Add a malformed C# file
      const malformedCsPath = path.join(testProjectPath, 'Malformed.cs');
      await fs.writeFile(malformedCsPath, 'class MalformedClass { // missing closing brace');

      const result = await builder.analyzeRepository(testProjectPath);

      // Should still complete analysis despite malformed file
      expect(result.filesProcessed).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);

      // Should have error for malformed file
      const malformedError = result.errors.find(e => e.filePath.includes('Malformed.cs'));
      expect(malformedError).toBeDefined();
    });
  });

  describe('SetHandPositions Method Chain Test Case', () => {
    it('should detect complete SetHandPositions method chain', async () => {
      const result = await builder.analyzeRepository(testProjectPath);

      const symbols = await SymbolService.getSymbolsByRepository(db,result.repository.id);
      const dependencies = await DependencyService.getFileDependenciesByRepository(db,result.repository.id);

      // 1. Interface definition: IHandManager.SetHandPositions
      const interfaceMethod = symbols.find(s =>
        s.name === 'SetHandPositions' &&
        symbols.some(parent => parent.name === 'IHandManager' && parent.symbol_type === 'interface')
      );
      expect(interfaceMethod).toBeDefined();

      // 2. Implementation: HandManager.SetHandPositions
      const implementationMethod = symbols.find(s =>
        s.name === 'SetHandPositions' &&
        symbols.some(parent => parent.name === 'HandManager' && parent.symbol_type === 'class')
      );
      expect(implementationMethod).toBeDefined();

      // 3. Wrapper: CardManager.SetHandPositions
      const wrapperMethod = symbols.find(s =>
        s.name === 'SetHandPositions' &&
        symbols.some(parent => parent.name === 'CardManager' && parent.symbol_type === 'class')
      );
      expect(wrapperMethod).toBeDefined();

      // 4. Check that method call dependencies exist
      // Get SetHandPositions symbol and check for callers
      const setHandPositionsSymbol = symbols.find(s => s.name === 'SetHandPositions');
      if (setHandPositionsSymbol) {
        const symbolDependencies = await DependencyService.getDependenciesTo(db,setHandPositionsSymbol.id);
        expect(symbolDependencies.length).toBeGreaterThan(0);
      }
    });
  });
});

/**
 * Setup test C# project with the exact structure from the bug report
 */
async function setupTestCSharpProject(projectPath: string): Promise<void> {
  await fs.mkdir(projectPath, { recursive: true });

  // Create directory structure
  const scriptsDir = path.join(projectPath, 'scripts', 'core', 'managers');
  const interfacesDir = path.join(projectPath, 'scripts', 'interfaces');
  const controllersDir = path.join(projectPath, 'scripts', 'controllers');

  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(interfacesDir, { recursive: true });
  await fs.mkdir(controllersDir, { recursive: true });

  // 1. IHandManager interface
  const iHandManagerContent = `using System;
using Godot;

namespace CardGame.Interfaces
{
    public interface IHandManager
    {
        void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition);
        void UpdateHandLayout();
        void ClearHand();
    }
}`;

  // 2. HandManager implementation
  const handManagerContent = `using System;
using Godot;
using CardGame.Interfaces;

namespace CardGame.Managers
{
    public class HandManager : Node, IHandManager
    {
        private Node3D _playerHandPosition;
        private Node3D _opponentHandPosition;

        public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition)
        {
            _playerHandPosition = playerHandPosition;
            _opponentHandPosition = opponentHandPosition;
            UpdateHandLayout();
        }

        public void UpdateHandLayout()
        {
            // Implementation details
        }

        public void ClearHand()
        {
            // Implementation details
        }
    }
}`;

  // 3. CardManager wrapper class (the missing one from the bug report)
  const cardManagerContent = `using System;
using Godot;
using CardGame.Interfaces;
using CardGame.Managers;

namespace CardGame.Managers
{
    public class CardManager : Node
    {
        private IHandManager _handManager;
        private Node3D _defaultPlayerPosition;
        private Node3D _defaultOpponentPosition;

        public override void _Ready()
        {
            _handManager = GetNode<HandManager>("HandManager");
        }

        public void SetHandPositions(Node3D playerHandPosition, Node3D opponentHandPosition)
        {
            _handManager?.SetHandPositions(playerHandPosition, opponentHandPosition);
        }

        public void ResetToDefaults()
        {
            _handManager?.SetHandPositions(_defaultPlayerPosition, _defaultOpponentPosition);
        }
    }
}`;

  // 4. DeckController usage class
  const deckControllerContent = `using System;
using Godot;
using CardGame.Managers;

namespace CardGame.Controllers
{
    public class DeckController : Node
    {
        private CardManager _cardManager;
        private Node3D _handPosition;

        public override void _Ready()
        {
            _cardManager = GetNode<CardManager>("CardManager");
        }

        public void InitializePlayerHand()
        {
            // First usage - line 226 equivalent
            _cardManager.SetHandPositions(_handPosition, null);
        }

        public void SetupGameBoard(Node3D playerHandPos)
        {
            // Second usage - line 242 equivalent
            _cardManager.SetHandPositions(playerHandPos, _handPosition);
        }
    }
}`;

  // Write all files
  await fs.writeFile(path.join(interfacesDir, 'IHandManager.cs'), iHandManagerContent);
  await fs.writeFile(path.join(scriptsDir, 'HandManager.cs'), handManagerContent);
  await fs.writeFile(path.join(scriptsDir, 'CardManager.cs'), cardManagerContent);
  await fs.writeFile(path.join(controllersDir, 'DeckController.cs'), deckControllerContent);

  // Add a simple project file to make it look like a real C# project
  const projectFileContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <OutputType>Library</OutputType>
  </PropertyGroup>
</Project>`;

  await fs.writeFile(path.join(projectPath, 'CardGame.csproj'), projectFileContent);
}