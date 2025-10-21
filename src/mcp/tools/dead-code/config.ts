/// <summary>
/// Configuration for dead code detection including entry point patterns,
/// framework callbacks, and library detection heuristics
/// </summary>

export interface EntryPointPatterns {
  namePatterns: RegExp[];
  signaturePatterns: RegExp[];
  symbolTypes: string[];
  entityTypes: string[];
}

export class DeadCodeConfig {
  /// <summary>
  /// C# / Godot framework entry points and lifecycle methods
  /// </summary>
  static readonly CSHARP_GODOT_PATTERNS: EntryPointPatterns = {
    namePatterns: [
      /^_Ready$/,
      /^_Process$/,
      /^_PhysicsProcess$/,
      /^_Input$/,
      /^_UnhandledInput$/,
      /^_ExitTree$/,
      /^_EnterTree$/,
      /^_Notification$/,
      /^_On[A-Z]/,
      /^On[A-Z]/,
      /^Handle[A-Z]/,
      // Unity lifecycle methods
      /^Start$/,
      /^Update$/,
      /^FixedUpdate$/,
      /^Awake$/,
      /^OnEnable$/,
      /^OnDisable$/,
      /^OnDestroy$/,
      /^OnApplicationQuit$/,
      // ASP.NET / general C#
      /^Main$/,
      /^Configure$/,
      /^ConfigureServices$/,
    ],
    signaturePatterns: [
      /\boverride\b/,
      /\bvirtual\b/,
      /\boperator\b/,
    ],
    symbolTypes: ['constructor', 'destructor'],
    entityTypes: [],
  };

  /// <summary>
  /// JavaScript/TypeScript framework entry points
  /// </summary>
  static readonly JAVASCRIPT_TYPESCRIPT_PATTERNS: EntryPointPatterns = {
    namePatterns: [
      // React lifecycle
      /^componentDidMount$/,
      /^componentWillUnmount$/,
      /^componentDidUpdate$/,
      /^componentWillMount$/,
      /^shouldComponentUpdate$/,
      /^render$/,
      /^getInitialState$/,
      /^getDefaultProps$/,
      // React hooks
      /^use[A-Z]/,
      // Vue lifecycle
      /^mounted$/,
      /^created$/,
      /^beforeDestroy$/,
      /^destroyed$/,
      /^beforeMount$/,
      /^beforeUpdate$/,
      /^updated$/,
      /^activated$/,
      /^deactivated$/,
      /^setup$/,
      // Event handlers
      /^on[A-Z]/,
      /^handle[A-Z]/,
      /^onClick$/,
      /^onChange$/,
      /^onSubmit$/,
      /^onInput$/,
      // Entry points
      /^main$/,
      /^default$/,
    ],
    signaturePatterns: [],
    symbolTypes: ['constructor'],
    entityTypes: [],
  };

  /// <summary>
  /// PHP / Laravel framework entry points
  /// </summary>
  static readonly PHP_LARAVEL_PATTERNS: EntryPointPatterns = {
    namePatterns: [
      // Laravel specific
      /^handle$/,
      /^render$/,
      /^boot$/,
      /^booted$/,
      /^register$/,
      /^mount$/,
      /^schedule$/,
      /^commands$/,
      // Laravel middleware hooks
      /^redirectTo$/,
      /^authenticate$/,
      // Laravel form request hooks
      /^prepareForValidation$/,
      /^withValidator$/,
      /^passedValidation$/,
      /^failedValidation$/,
      /^after$/,
      /^rules$/,
      /^messages$/,
      /^attributes$/,
      /^authorize$/,
      // Magic methods
      /^__construct$/,
      /^__destruct$/,
      /^__call$/,
      /^__get$/,
      /^__set$/,
      /^__isset$/,
      /^__unset$/,
      /^__toString$/,
      /^__invoke$/,
    ],
    signaturePatterns: [
      // Laravel Attribute accessors (Laravel 9+)
      /:\s*Attribute$/,
      /function\s+\w+\s*\([^)]*\)\s*:\s*Attribute/,
      // Laravel model scopes
      /function\s+scope[A-Z]/,
    ],
    symbolTypes: [],
    entityTypes: ['controller', 'route', 'middleware', 'command', 'listener'],
  };

  /// <summary>
  /// Test method patterns across frameworks
  /// </summary>
  static readonly TEST_PATTERNS: EntryPointPatterns = {
    namePatterns: [
      /^test[A-Z_]/,
      /^it_/,
      /^should_/,
      /^setUp$/,
      /^tearDown$/,
      /^beforeEach$/,
      /^afterEach$/,
      /^beforeAll$/,
      /^afterAll$/,
    ],
    signaturePatterns: [/@Test/, /@Before/, /@After/, /\[Test\]/, /\[TestMethod\]/],
    symbolTypes: [],
    entityTypes: [],
  };

  /// <summary>
  /// Check if a file is a test file based on path patterns
  /// </summary>
  static isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\.(ts|js|tsx|jsx|cs|php)$/,
      /\.spec\.(ts|js|tsx|jsx|cs|php)$/,
      /_test\.(ts|js|tsx|jsx|cs|php)$/,
      /Tests?\.(ts|js|tsx|jsx|cs|php)$/,
      /\/tests?\//i,
      /\/__tests__\//,
      /\/spec\//,
    ];

    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /// <summary>
  /// Library detection heuristics for identifying published packages
  /// </summary>
  static async detectLibraryIndicators(repoPath: string, repoName: string): Promise<string[]> {
    const indicators: string[] = [];

    // Check package.json indicators
    const packageJsonPatterns = [
      { file: 'package.json', fields: ['private', 'exports', 'main', 'module'] },
      { file: 'composer.json', fields: ['type'] },
      { file: '*.csproj', fields: [] },
    ];

    // Common library directory structures
    const libraryDirPatterns = [
      /\/lib\//,
      /\/dist\//,
      /\/build\//,
      /\/pkg\//,
      /\/src\/.*\/index\.(ts|js)$/,
    ];

    // Documentation indicators
    const docIndicators = ['README.md mentions "Installation"', 'README.md mentions "npm install"'];

    // Note: Actual file reading would happen in the detector using database
    // This config just defines the patterns

    return indicators;
  }

  /// <summary>
  /// Patterns indicating a symbol might be intentionally unused (keep for API compatibility)
  /// </summary>
  static readonly API_COMPATIBILITY_PATTERNS = {
    namePatterns: [
      /^deprecated/i,
      /^legacy/i,
      /^obsolete/i,
    ],
    signaturePatterns: [
      /@deprecated/,
      /@obsolete/,
      /\[Obsolete\]/,
      /\[Deprecated\]/,
    ],
  };

  /// <summary>
  /// Property and accessor patterns (often called implicitly)
  /// </summary>
  static readonly IMPLICIT_CALL_PATTERNS = {
    symbolTypes: ['property', 'getter', 'setter', 'accessor', 'field'],
    namePatterns: [
      /^get_/,
      /^set_/,
      /^Get[A-Z]/,
      /^Set[A-Z]/,
    ],
    signaturePatterns: [/\bget\s*\{/, /\bset\s*\{/],
  };

  /// <summary>
  /// Signal and event patterns (Godot, C# events)
  /// </summary>
  static readonly SIGNAL_EVENT_PATTERNS = {
    namePatterns: [
      /EventHandler$/,
      /Changed$/,
      /Completed$/,
      /Started$/,
    ],
    signaturePatterns: [
      /\[Signal\]/,
      /\bevent\b/,
      /EventHandler</,
      /delegate\s+void/,
    ],
  };

  /// <summary>
  /// Explicit interface implementation patterns (C#)
  /// Methods implementing interfaces explicitly are called through interface references
  /// </summary>
  static readonly EXPLICIT_INTERFACE_PATTERNS = {
    signaturePatterns: [
      // Matches any return type followed by IInterfaceName.MethodName pattern
      // Handles generics like IEnumerable<T>, Dictionary<K,V>, etc.
      /\bI[A-Z]\w+\.\w+\s*\(/,
    ],
  };
}
