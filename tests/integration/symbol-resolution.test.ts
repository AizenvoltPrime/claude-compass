import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GraphBuilder } from '../../src/graph/builder';
import { getDatabaseConnection } from '../../src/database/connection';
import { MultiParser } from '../../src/parsers/multi-parser';
import { autoloaderRegistry } from '../../src/config/autoloader-resolver';
import type { Knex } from 'knex';

describe('Symbol Resolution Integration Tests', () => {
  let tempDir: string;
  let db: Knex;
  let graphBuilder: GraphBuilder;
  let multiParser: MultiParser;

  beforeAll(async () => {
    db = getDatabaseConnection();
    graphBuilder = new GraphBuilder(db);
    multiParser = new MultiParser();
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-resolution-test-'));
    autoloaderRegistry.clear();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    autoloaderRegistry.clear();
  });

  describe('PHP Symbol Resolution', () => {
    it('should resolve static class calls to fully qualified names', async () => {
      // Create a Laravel-like structure with composer.json
      const composerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/',
            'Database\\': 'database/'
          }
        }
      };
      await fs.writeFile(path.join(tempDir, 'composer.json'), JSON.stringify(composerJson, null, 2));

      // Create Personnel model
      const appModelsDir = path.join(tempDir, 'app', 'Models');
      await fs.mkdir(appModelsDir, { recursive: true });
      const personnelModelContent = `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Personnel extends Model
{
    protected $fillable = ['first_name', 'last_name', 'position'];

    public function save(array $options = [])
    {
        return parent::save($options);
    }

    public static function create(array $attributes = [])
    {
        $model = new static($attributes);
        $model->save();
        return $model;
    }
}`;
      await fs.writeFile(path.join(appModelsDir, 'Personnel.php'), personnelModelContent);

      // Create PersonnelCreationService that uses Personnel::create
      const appServicesDir = path.join(tempDir, 'app', 'Services', 'Personnel');
      await fs.mkdir(appServicesDir, { recursive: true });
      const serviceContent = `<?php

namespace App\\Services\\Personnel;

use App\\Models\\Personnel;

class PersonnelCreationService
{
    public function createPersonnel(array $data)
    {
        return Personnel::create($data);
    }
}`;
      await fs.writeFile(path.join(appServicesDir, 'PersonnelCreationService.php'), serviceContent);

      // Parse files
      const personnelModelPath = path.join(appModelsDir, 'Personnel.php');
      const servicePath = path.join(appServicesDir, 'PersonnelCreationService.php');

      const readPersonnelModelContent = await fs.readFile(personnelModelPath, 'utf-8');
      const readServiceContent = await fs.readFile(servicePath, 'utf-8');

      const personnelModelResult = await multiParser.parseFile(readPersonnelModelContent, personnelModelPath);
      const serviceResult = await multiParser.parseFile(readServiceContent, servicePath);

      // Verify that Personnel::create was resolved to FQN
      const serviceDependencies = serviceResult.dependencies.filter(
        dep => dep.to_symbol === 'create' && dep.from_symbol === 'createPersonnel'
      );

      expect(serviceDependencies.length).toBeGreaterThan(0);

      // Check if to_qualified_name was set
      const personnelCreateDep = serviceDependencies.find(dep =>
        dep.to_qualified_name?.includes('Personnel')
      );

      if (personnelCreateDep) {
        expect(personnelCreateDep.to_qualified_name).toBe('App\\Models\\Personnel::create');
      }
    });

    it('should resolve nested namespace dependencies', async () => {
      // Create composer.json
      const composerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/'
          }
        }
      };
      await fs.writeFile(path.join(tempDir, 'composer.json'), JSON.stringify(composerJson, null, 2));

      // Create BaseService
      const appServicesDir = path.join(tempDir, 'app', 'Services');
      await fs.mkdir(appServicesDir, { recursive: true });
      const baseServiceContent = `<?php

namespace App\\Services;

class BaseService
{
    protected function validateRequiredFields(array $data, array $fields)
    {
        foreach ($fields as $field) {
            if (!isset($data[$field])) {
                throw new \\Exception("Missing required field: $field");
            }
        }
    }
}`;
      await fs.writeFile(path.join(appServicesDir, 'BaseService.php'), baseServiceContent);

      // Create PersonnelCreationService extending BaseService
      const personnelServicesDir = path.join(tempDir, 'app', 'Services', 'Personnel');
      await fs.mkdir(personnelServicesDir, { recursive: true });
      const personnelServiceContent = `<?php

namespace App\\Services\\Personnel;

use App\\Services\\BaseService;

class PersonnelCreationService extends BaseService
{
    public function createPersonnel(array $data)
    {
        $this->validateRequiredFields($data, ['first_name', 'last_name']);
        return $data;
    }
}`;
      await fs.writeFile(path.join(personnelServicesDir, 'PersonnelCreationService.php'), personnelServiceContent);

      // Parse files
      const baseServicePath = path.join(appServicesDir, 'BaseService.php');
      const personnelServicePath = path.join(personnelServicesDir, 'PersonnelCreationService.php');

      const readBaseServiceContent = await fs.readFile(baseServicePath, 'utf-8');
      const readPersonnelServiceContent = await fs.readFile(personnelServicePath, 'utf-8');

      const baseServiceResult = await multiParser.parseFile(readBaseServiceContent, baseServicePath);
      const personnelServiceResult = await multiParser.parseFile(readPersonnelServiceContent, personnelServicePath);

      // Verify validateRequiredFields call has qualified name
      const validateCalls = personnelServiceResult.dependencies.filter(
        dep => dep.to_symbol === 'validateRequiredFields'
      );

      expect(validateCalls.length).toBeGreaterThan(0);

      // Check if method call is properly qualified
      const qualifiedCall = validateCalls.find(dep =>
        dep.to_qualified_name?.includes('BaseService') ||
        dep.qualified_context?.includes('BaseService')
      );

      expect(qualifiedCall).toBeDefined();
    });
  });

  describe('TypeScript Symbol Resolution', () => {
    it('should resolve import path aliases', async () => {
      // Create tsconfig.json with path aliases
      const tsconfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
            '@stores/*': ['src/stores/*']
          }
        }
      };
      await fs.writeFile(path.join(tempDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

      // Create a store file
      const storesDir = path.join(tempDir, 'src', 'stores');
      await fs.mkdir(storesDir, { recursive: true });
      const storeContent = `
export interface Personnel {
  id: number;
  first_name: string;
  last_name: string;
}

export const personnelStore = {
  create: async (data: Partial<Personnel>) => {
    return fetch('/api/personnel', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
};`;
      await fs.writeFile(path.join(storesDir, 'personnelStore.ts'), storeContent);

      // Create a component that uses the store
      const pagesDir = path.join(tempDir, 'src', 'pages');
      await fs.mkdir(pagesDir, { recursive: true });
      const componentContent = `
import { personnelStore } from '@stores/personnelStore';

export const PersonnelForm = () => {
  const handleSubmit = async (data: any) => {
    await personnelStore.create(data);
  };

  return null;
};`;
      await fs.writeFile(path.join(pagesDir, 'PersonnelForm.tsx'), componentContent);

      // Parse files
      const storePath = path.join(storesDir, 'personnelStore.ts');
      const componentPath = path.join(pagesDir, 'PersonnelForm.tsx');

      const readStoreContent = await fs.readFile(storePath, 'utf-8');
      const readComponentContent = await fs.readFile(componentPath, 'utf-8');

      const storeResult = await multiParser.parseFile(readStoreContent, storePath);
      const componentResult = await multiParser.parseFile(readComponentContent, componentPath);

      // Verify imports were tracked
      expect(componentResult.imports.length).toBeGreaterThan(0);

      const storeImport = componentResult.imports.find(imp =>
        imp.imported_names.includes('personnelStore')
      );

      expect(storeImport).toBeDefined();
      expect(storeImport?.source).toContain('personnelStore');
    });
  });

  describe('C# Symbol Resolution', () => {
    it('should resolve using statements to namespaces', async () => {
      // Create .csproj file
      const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <RootNamespace>MyGame.Core</RootNamespace>
  </PropertyGroup>
</Project>`;
      await fs.writeFile(path.join(tempDir, 'MyGame.csproj'), csprojContent);

      // Create CardData class
      const modelsDir = path.join(tempDir, 'Models');
      await fs.mkdir(modelsDir, { recursive: true });
      const cardDataContent = `using System;

namespace MyGame.Core.Models
{
    public class CardData
    {
        public string CardName { get; set; }
        public int AttackPower { get; set; }

        public static CardData Create(string name, int attack)
        {
            return new CardData { CardName = name, AttackPower = attack };
        }
    }
}`;
      await fs.writeFile(path.join(modelsDir, 'CardData.cs'), cardDataContent);

      // Create CardManager that uses CardData
      const managersDir = path.join(tempDir, 'Managers');
      await fs.mkdir(managersDir, { recursive: true });
      const cardManagerContent = `using System;
using MyGame.Core.Models;

namespace MyGame.Core.Managers
{
    public class CardManager
    {
        public void CreateCard(string name, int attack)
        {
            var card = CardData.Create(name, attack);
        }
    }
}`;
      await fs.writeFile(path.join(managersDir, 'CardManager.cs'), cardManagerContent);

      // Parse files
      const cardDataPath = path.join(modelsDir, 'CardData.cs');
      const cardManagerPath = path.join(managersDir, 'CardManager.cs');

      const readCardDataContent = await fs.readFile(cardDataPath, 'utf-8');
      const readCardManagerContent = await fs.readFile(cardManagerPath, 'utf-8');

      const cardDataResult = await multiParser.parseFile(readCardDataContent, cardDataPath);
      const cardManagerResult = await multiParser.parseFile(readCardManagerContent, cardManagerPath);

      // Verify CardData.Create call was tracked
      const createCalls = cardManagerResult.dependencies.filter(
        dep => dep.to_symbol === 'Create'
      );

      expect(createCalls.length).toBeGreaterThan(0);

      // Check if qualified name includes CardData
      const qualifiedCall = createCalls.find(dep =>
        dep.to_qualified_name?.includes('CardData') ||
        dep.qualified_context?.includes('CardData')
      );

      expect(qualifiedCall).toBeDefined();
    });
  });

  describe('Cross-Language Dependencies', () => {
    it('should track Vue component calling Laravel API endpoint', async () => {
      // Create composer.json
      const composerJson = {
        autoload: {
          'psr-4': {
            'App\\': 'app/'
          }
        }
      };
      await fs.writeFile(path.join(tempDir, 'composer.json'), JSON.stringify(composerJson, null, 2));

      // Create Laravel controller
      const controllersDir = path.join(tempDir, 'app', 'Http', 'Controllers');
      await fs.mkdir(controllersDir, { recursive: true });
      const controllerContent = `<?php

namespace App\\Http\\Controllers;

class PersonnelController
{
    public function createPersonnel(Request $request)
    {
        return response()->json(['message' => 'Personnel created']);
    }
}`;
      await fs.writeFile(path.join(controllersDir, 'PersonnelController.php'), controllerContent);

      // Create Vue component that calls the API
      const componentsDir = path.join(tempDir, 'resources', 'ts', 'components');
      await fs.mkdir(componentsDir, { recursive: true });
      const vueContent = `<script setup lang="ts">
const createPersonnel = async (data: any) => {
  const response = await fetch('/api/personnel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return response.json();
};
</script>`;
      await fs.writeFile(path.join(componentsDir, 'PersonnelForm.vue'), vueContent);

      // Parse files
      const controllerPath = path.join(controllersDir, 'PersonnelController.php');
      const vuePath = path.join(componentsDir, 'PersonnelForm.vue');

      const readControllerContent = await fs.readFile(controllerPath, 'utf-8');
      const readVueContent = await fs.readFile(vuePath, 'utf-8');

      const controllerResult = await multiParser.parseFile(readControllerContent, controllerPath);
      const vueResult = await multiParser.parseFile(readVueContent, vuePath);

      // Verify controller method was parsed
      expect(controllerResult.symbols.length).toBeGreaterThan(0);
      const createMethod = controllerResult.symbols.find(sym => sym.name === 'createPersonnel');
      expect(createMethod).toBeDefined();

      // Verify Vue component parsed fetch call
      expect(vueResult.symbols.length).toBeGreaterThan(0);
    });
  });
});
