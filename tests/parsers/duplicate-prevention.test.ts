import { TypeScriptParser } from '../../src/parsers/typescript';
import { JavaScriptParser } from '../../src/parsers/javascript';

describe('Duplicate Symbol Prevention', () => {
  let tsParser: TypeScriptParser;
  let jsParser: JavaScriptParser;

  beforeEach(() => {
    tsParser = new TypeScriptParser();
    jsParser = new JavaScriptParser();
  });

  describe('Small Non-Chunked Files', () => {
    it('should not create duplicate symbols in small TypeScript files', async () => {
      const content = `
        export class TestClass {
          method1() {}
          method2() {}
        }

        export function testFunc() {}

        export const testConst = 42;
      `;

      const result = await tsParser.parseFile('test.ts', content);
      const symbolNames = result.symbols.map(s => `${s.name}:${s.symbol_type}:${s.start_line}`);
      const uniqueNames = new Set(symbolNames);

      expect(symbolNames.length).toBe(uniqueNames.size);
    });

    it('should not create duplicate symbols in small JavaScript files', async () => {
      const content = `
        class MyClass {
          constructor() {}
          method() {}
        }

        function myFunction() {}

        const myConst = () => {};
      `;

      const result = await jsParser.parseFile('test.js', content);
      const symbolNames = result.symbols.map(s => `${s.name}:${s.symbol_type}:${s.start_line}`);
      const uniqueNames = new Set(symbolNames);

      expect(symbolNames.length).toBe(uniqueNames.size);
    });
  });

  describe('Medium-Sized Files', () => {
    it('should not create duplicates in medium TypeScript files', async () => {
      const content = generateMediumTypeScriptContent();

      const result = await tsParser.parseFile('medium.ts', content);

      expect(hasNoDuplicateSymbols(result.symbols)).toBe(true);
    });

    it('should not create duplicates in medium JavaScript files', async () => {
      const content = generateMediumJavaScriptContent();

      const result = await jsParser.parseFile('medium.js', content);

      expect(hasNoDuplicateSymbols(result.symbols)).toBe(true);
    });
  });

  describe('Import Statement Validation', () => {
    it('should not extract import statements as classes in TypeScript', async () => {
      const content = `
        import { SomeClass, AnotherClass } from './module';
        import DefaultClass from './default';

        export class ActualClass {
          method() {}
        }
      `;

      const result = await tsParser.parseFile('test.ts', content);
      const classSymbols = result.symbols.filter(s => s.symbol_type === 'class');

      expect(classSymbols).toHaveLength(1);
      expect(classSymbols[0].name).toBe('ActualClass');
    });

    it('should not extract import statements as classes in JavaScript', async () => {
      const content = `
        import { MyClass } from './classes';

        class RealClass {
          constructor() {}
        }
      `;

      const result = await jsParser.parseFile('test.js', content);
      const classSymbols = result.symbols.filter(s => s.symbol_type === 'class');

      expect(classSymbols).toHaveLength(1);
      expect(classSymbols[0].name).toBe('RealClass');
    });

    it('should handle mixed imports and class declarations', async () => {
      const content = `
        import { Button, Input } from './components';
        import * as Utils from './utils';

        export class MyComponent {
          render() {}
        }

        export class AnotherComponent {
          mount() {}
        }
      `;

      const result = await tsParser.parseFile('test.ts', content);
      const classSymbols = result.symbols.filter(s => s.symbol_type === 'class');

      expect(classSymbols).toHaveLength(2);
      expect(classSymbols.map(s => s.name)).toEqual(['MyComponent', 'AnotherComponent']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle files with same-named symbols at different locations', async () => {
      const content = `
        function test() {
          class Inner {}
        }

        class Outer {
          method() {
            const Inner = class {};
          }
        }
      `;

      const result = await tsParser.parseFile('test.ts', content);

      const classSymbols = result.symbols.filter(s => s.symbol_type === 'class');
      expect(classSymbols.length).toBeGreaterThan(0);
      expect(hasNoDuplicateSymbols(result.symbols)).toBe(true);
    });

    it('should handle complex TypeScript files with interfaces and types', async () => {
      const content = `
        interface Props {
          name: string;
        }

        type State = {
          count: number;
        };

        export class Component {
          constructor(props: Props) {}
        }
      `;

      const result = await tsParser.parseFile('test.ts', content);
      expect(hasNoDuplicateSymbols(result.symbols)).toBe(true);
    });
  });

  describe('Large Chunked Files', () => {
    it('should not create duplicates in large chunked TypeScript files', async () => {
      const content = generateLargeTypeScriptContent();

      const result = await tsParser.parseFile('large.ts', content);

      expect(hasNoDuplicateSymbols(result.symbols)).toBe(true);
      expect(result.symbols.length).toBeGreaterThan(0);
    });
  });
});

function hasNoDuplicateSymbols(symbols: any[]): boolean {
  const seen = new Set<string>();

  for (const symbol of symbols) {
    const key = `${symbol.name}:${symbol.symbol_type}:${symbol.start_line}`;

    if (seen.has(key)) {
      console.error(`Duplicate symbol found: ${key}`);
      return false;
    }

    seen.add(key);
  }

  return true;
}

function generateMediumTypeScriptContent(): string {
  let content = 'export namespace App {\n';

  for (let i = 0; i < 20; i++) {
    content += `
      export class Service${i} {
        private data: any;

        constructor() {
          this.data = {};
        }

        method${i}A() {
          return this.data;
        }

        method${i}B() {
          return null;
        }
      }

      export interface Interface${i} {
        prop${i}: string;
      }

      export function utility${i}() {
        return ${i};
      }
    `;
  }

  content += '\n}\n';
  return content;
}

function generateMediumJavaScriptContent(): string {
  let content = '';

  for (let i = 0; i < 25; i++) {
    content += `
      class Component${i} {
        constructor() {
          this.state = {};
        }

        render() {
          return null;
        }

        method${i}() {
          return this.state;
        }
      }

      function helper${i}() {
        return ${i};
      }

      const constant${i} = ${i * 10};
    `;
  }

  return content;
}

function generateLargeTypeScriptContent(): string {
  let content = '';

  for (let i = 0; i < 100; i++) {
    content += `
      export class LargeClass${i} {
        private field${i}: number = ${i};

        constructor() {}

        method${i}A(): number {
          return this.field${i};
        }

        method${i}B(): void {
          console.log(this.field${i});
        }

        get value${i}(): number {
          return this.field${i};
        }

        set value${i}(val: number) {
          this.field${i} = val;
        }
      }

      export interface LargeInterface${i} {
        prop${i}A: string;
        prop${i}B: number;
        prop${i}C: boolean;
      }

      export type LargeType${i} = {
        field${i}: string;
      };

      export function largeFunction${i}(param${i}: number): number {
        return param${i} * 2;
      }

      export const largeConst${i} = {
        value: ${i},
        name: 'const${i}'
      };
    `;
  }

  return content;
}
