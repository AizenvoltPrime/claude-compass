import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize PHPUnit assertion methods and test framework symbols
 */
export function initializePHPUnitSymbols(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

  // Common PHPUnit assertions
  const phpunitAssertions = [
    'assertEquals', 'assertNotEquals', 'assertSame', 'assertNotSame',
    'assertTrue', 'assertFalse', 'assertNull', 'assertNotNull',
    'assertEmpty', 'assertNotEmpty', 'assertCount', 'assertNotCount',
    'assertContains', 'assertNotContains', 'assertStringContains', 'assertStringNotContains',
    'assertArrayHasKey', 'assertArrayNotHasKey', 'assertArraySubset',
    'assertInstanceOf', 'assertNotInstanceOf', 'assertInternalType',
    'assertIsArray', 'assertIsBool', 'assertIsFloat', 'assertIsInt',
    'assertIsNumeric', 'assertIsObject', 'assertIsResource', 'assertIsString',
    'assertIsScalar', 'assertIsCallable', 'assertIsIterable',
    'assertRegExp', 'assertNotRegExp', 'assertMatchesRegularExpression',
    'assertFileExists', 'assertFileNotExists', 'assertDirectoryExists',
    'assertGreaterThan', 'assertGreaterThanOrEqual', 'assertLessThan', 'assertLessThanOrEqual',
    'expectException', 'expectExceptionMessage', 'expectExceptionCode',
    'markTestSkipped', 'markTestIncomplete'
  ];

  for (const assertion of phpunitAssertions) {
    symbols.push({
      name: assertion,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'PHPUnit',
      context: 'test',
      description: `PHPUnit assertion method: ${assertion}`
    });
  }

  // PHPUnit test lifecycle methods
  const lifecycleMethods = [
    'setUp', 'tearDown', 'setUpBeforeClass', 'tearDownAfterClass'
  ];

  for (const method of lifecycleMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PROTECTED,
      framework: 'PHPUnit',
      context: 'test',
      description: `PHPUnit lifecycle method: ${method}`
    });
  }

  return symbols;
}
