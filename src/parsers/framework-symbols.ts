import { SymbolType, Visibility } from '../database/models';

/**
 * Interface for framework-provided symbols
 */
export interface FrameworkSymbol {
  name: string;
  symbol_type: SymbolType;
  visibility: Visibility;
  signature?: string;
  description?: string;
  framework: string;
  context?: string; // Additional context (e.g., 'test', 'validation', etc.)
}

/**
 * Registry of framework-provided symbols that should be available
 * in specific contexts but aren't explicitly declared in user files
 */
export class FrameworkSymbolRegistry {
  private symbols: Map<string, FrameworkSymbol[]> = new Map();
  private phpUnitSymbols: FrameworkSymbol[] = [];
  private laravelSymbols: FrameworkSymbol[] = [];
  private phpBuiltinSymbols: FrameworkSymbol[] = [];
  private vueSymbols: FrameworkSymbol[] = [];
  private jsBuiltinSymbols: FrameworkSymbol[] = [];
  private domSymbols: FrameworkSymbol[] = [];
  private dotnetSymbols: FrameworkSymbol[] = [];
  private godotSymbols: FrameworkSymbol[] = [];

  constructor() {
    this.initializePHPUnitSymbols();
    this.initializeLaravelSymbols();
    this.initializePHPBuiltins();
    this.initializeVueSymbols();
    this.initializeJavaScriptBuiltins();
    this.initializeDOMSymbols();
    this.initializeDotNetFrameworkSymbols();
    this.initializeGodotSymbols();
    this.buildIndex();
  }

  /**
   * Initialize PHPUnit assertion methods and test framework symbols
   */
  private initializePHPUnitSymbols(): void {
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
      this.phpUnitSymbols.push({
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
      this.phpUnitSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PROTECTED,
        framework: 'PHPUnit',
        context: 'test',
        description: `PHPUnit lifecycle method: ${method}`
      });
    }
  }

  /**
   * Initialize Laravel framework symbols
   */
  private initializeLaravelSymbols(): void {
    // Laravel Validator methods
    const validatorMethods = [
      'errors', 'failed', 'fails', 'passes', 'valid', 'invalid',
      'sometimes', 'after', 'getMessageBag', 'setMessageBag',
      'getRules', 'setRules', 'getPresenceVerifier'
    ];

    for (const method of validatorMethods) {
      this.laravelSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'validation',
        description: `Laravel Validator method: ${method}`
      });
    }

    // Laravel MessageBag methods (returned by validator->errors())
    const messageBagMethods = [
      'add', 'merge', 'has', 'hasAny', 'first', 'get', 'all', 'keys',
      'isEmpty', 'isNotEmpty', 'count', 'toArray', 'toJson', 'jsonSerialize'
    ];

    for (const method of messageBagMethods) {
      this.laravelSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'message_bag',
        description: `Laravel MessageBag method: ${method}`
      });
    }

    // Laravel Request methods
    const requestMethods = [
      'all', 'input', 'only', 'except', 'has', 'hasAny', 'filled', 'missing',
      'validate', 'validateWithBag', 'rules', 'messages', 'attributes',
      'merge', 'replace', 'flash', 'flashOnly', 'flashExcept'
    ];

    for (const method of requestMethods) {
      this.laravelSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'request',
        description: `Laravel Request method: ${method}`
      });
    }

    // Laravel Collection methods (commonly used)
    const collectionMethods = [
      'map', 'filter', 'reduce', 'each', 'collect', 'pluck', 'where',
      'first', 'last', 'push', 'pop', 'shift', 'unshift', 'slice',
      'take', 'skip', 'chunk', 'groupBy', 'sortBy', 'reverse', 'unique',
      'values', 'keys', 'flatten', 'flip', 'transform', 'tap'
    ];

    for (const method of collectionMethods) {
      this.laravelSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'collection',
        description: `Laravel Collection method: ${method}`
      });
    }
  }

  /**
   * Initialize PHP built-in functions and Laravel Facades
   */
  private initializePHPBuiltins(): void {
    // PHP built-in functions commonly used in Laravel applications
    const phpBuiltins = [
      // Array functions
      'array_diff', 'array_keys', 'array_values', 'array_merge', 'array_filter',
      'array_map', 'array_reduce', 'array_unique', 'array_slice', 'array_splice',
      'array_push', 'array_pop', 'array_shift', 'array_unshift', 'in_array',
      'array_key_exists', 'array_search', 'array_column', 'array_flip', 'array_reverse',
      // String functions
      'strlen', 'substr', 'strpos', 'strrpos', 'str_replace', 'str_ireplace',
      'trim', 'ltrim', 'rtrim', 'strtolower', 'strtoupper', 'ucfirst', 'ucwords',
      'explode', 'implode', 'strstr', 'stristr', 'sprintf', 'vsprintf', 'strrchr',
      'preg_match', 'preg_replace', 'preg_replace_callback',
      // Type checking and conversion
      'isset', 'empty', 'is_null', 'is_array', 'is_string', 'is_numeric',
      'is_int', 'is_float', 'is_bool', 'is_object', 'is_callable', 'intval',
      // System functions
      'shell_exec', 'exec', 'system', 'passthru', 'file_get_contents',
      'file_put_contents', 'file_exists', 'is_dir', 'is_file', 'unlink',
      // Date/time
      'time', 'date', 'strtotime', 'mktime', 'gmdate',
      // Math
      'count', 'max', 'min', 'abs', 'round', 'ceil', 'floor', 'rand', 'mt_rand',
      // JSON and encoding
      'json_encode', 'json_decode', 'json_last_error', 'serialize', 'unserialize',
      'md5', 'sha1', 'base64_encode', 'base64_decode', 'urlencode', 'urldecode', 'htmlspecialchars'
    ];

    for (const func of phpBuiltins) {
      this.phpBuiltinSymbols.push({
        name: func,
        symbol_type: SymbolType.FUNCTION,
        visibility: Visibility.PUBLIC,
        framework: 'PHP',
        context: 'builtin',
        description: `PHP built-in function: ${func}`
      });
    }

    // Laravel Facades (static method calls)
    const laravelFacades = [
      // Log facade
      { facade: 'Log', methods: ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug'] },
      // Auth facade
      { facade: 'Auth', methods: ['user', 'id', 'check', 'guest', 'login', 'logout', 'attempt', 'once', 'guard'] },
      // DB facade
      { facade: 'DB', methods: ['connection', 'table', 'select', 'insert', 'update', 'delete', 'statement', 'transaction', 'beginTransaction', 'commit', 'rollback'] },
      // App facade
      { facade: 'App', methods: ['environment', 'version', 'setLocale', 'getLocale', 'make', 'singleton', 'bind'] },
      // Lang facade
      { facade: 'Lang', methods: ['get', 'choice', 'trans', 'transChoice', 'setLocale', 'getLocale'] },
      // Config facade
      { facade: 'Config', methods: ['get', 'set', 'has', 'all'] },
      // Cache facade
      { facade: 'Cache', methods: ['get', 'put', 'forget', 'flush', 'remember', 'rememberForever', 'forever'] },
      // Session facade
      { facade: 'Session', methods: ['get', 'put', 'push', 'flash', 'forget', 'flush', 'has', 'exists'] },
      // Validator facade
      { facade: 'Validator', methods: ['make', 'extend', 'extendImplicit', 'replacer'] },
      // Rule facade
      { facade: 'Rule', methods: ['unique', 'exists', 'in', 'notIn', 'requiredIf', 'dimensions'] },
      // Http facade
      { facade: 'Http', methods: ['get', 'post', 'put', 'patch', 'delete', 'withHeaders', 'withToken', 'withBasicAuth', 'timeout', 'retry'] }
    ];

    for (const { facade, methods } of laravelFacades) {
      for (const method of methods) {
        this.phpBuiltinSymbols.push({
          name: `${facade}::${method}`,
          symbol_type: SymbolType.METHOD,
          visibility: Visibility.PUBLIC,
          framework: 'Laravel',
          context: 'facade',
          description: `Laravel ${facade} facade method: ${method}`
        });
      }
    }

    // Laravel Eloquent Model methods
    const eloquentMethods = [
      'where', 'orWhere', 'whereIn', 'whereNotIn', 'whereBetween', 'whereNotBetween',
      'whereNull', 'whereNotNull', 'whereDate', 'whereMonth', 'whereDay', 'whereYear',
      'whereTime', 'whereColumn', 'whereExists', 'whereNotExists', 'whereRaw',
      'orderBy', 'orderByDesc', 'orderByRaw', 'groupBy', 'groupByRaw', 'having', 'havingRaw',
      'limit', 'offset', 'skip', 'take', 'forPage', 'union', 'unionAll',
      'select', 'selectRaw', 'addSelect', 'distinct', 'from', 'fromRaw', 'join',
      'leftJoin', 'rightJoin', 'crossJoin', 'joinWhere', 'joinSub', 'leftJoinSub',
      'get', 'first', 'firstOrFail', 'find', 'findOrFail', 'findMany', 'findOrNew',
      'firstOrNew', 'firstOrCreate', 'updateOrCreate', 'count', 'min', 'max', 'avg',
      'sum', 'exists', 'doesntExist', 'pluck', 'chunk', 'chunkById', 'each',
      'create', 'insert', 'insertGetId', 'insertOrIgnore', 'update', 'updateOrInsert',
      'increment', 'decrement', 'delete', 'forceDelete', 'restore', 'truncate',
      'save', 'fresh', 'refresh', 'replicate', 'toArray', 'toJson', 'jsonSerialize'
    ];

    for (const method of eloquentMethods) {
      this.phpBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'eloquent',
        description: `Laravel Eloquent method: ${method}`
      });
    }

    // Model-specific facade calls (like OpenDataFile::where, User::find, etc.)
    const modelMethods = [
      'where', 'find', 'findOrFail', 'first', 'firstOrFail', 'create', 'update', 'delete',
      'all', 'get', 'pluck', 'count', 'exists', 'whereIn', 'whereNotIn', 'orderBy'
    ];

    // Common Laravel model names that might appear in facade calls
    const commonModels = [
      'User', 'OpenDataFile', 'Tag', 'Camera', 'Dashboard', 'DmsFile', 'Equipment',
      'Facility', 'Personnel', 'Vehicle', 'Volunteer', 'Alert', 'Device'
    ];

    for (const model of commonModels) {
      for (const method of modelMethods) {
        this.phpBuiltinSymbols.push({
          name: `${model}::${method}`,
          symbol_type: SymbolType.METHOD,
          visibility: Visibility.PUBLIC,
          framework: 'Laravel',
          context: 'model-facade',
          description: `Laravel ${model} model method: ${method}`
        });
      }
    }

    // Laravel helper functions (commonly used global functions)
    const laravelHelpers = [
      'auth', 'config', 'response', 'request', 'route', 'url', 'asset', 'mix',
      'app', 'env', 'old', 'session', 'trans', 'trans_choice', 'view',
      'abort', 'abort_if', 'abort_unless', 'back', 'redirect', 'validator'
    ];

    for (const helper of laravelHelpers) {
      this.phpBuiltinSymbols.push({
        name: helper,
        symbol_type: SymbolType.FUNCTION,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'helper',
        description: `Laravel helper function: ${helper}`
      });
    }

    // HTTP client methods (Laravel Http facade methods)
    const httpMethods = [
      'get', 'post', 'put', 'patch', 'delete', 'head', 'options',
      'withHeaders', 'withBody', 'asJson', 'asForm', 'attach',
      'timeout', 'retry', 'accept', 'acceptJson', 'contentType',
      'withToken', 'withBasicAuth', 'withDigestAuth', 'withCookies',
      'withOptions', 'withMiddleware', 'dd', 'dump'
    ];

    for (const method of httpMethods) {
      this.phpBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'http',
        description: `Laravel HTTP client method: ${method}`
      });
    }

    // HTTP response methods (commonly used on HTTP responses)
    const responseMethods = [
      'body', 'json', 'object', 'collect', 'status', 'successful',
      'ok', 'redirect', 'failed', 'clientError', 'serverError',
      'headers', 'header', 'cookies', 'effectiveUri', 'getReasonPhrase',
      'getStatusCode', 'getBody', 'getContents'
    ];

    for (const method of responseMethods) {
      this.phpBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'http-response',
        description: `Laravel HTTP response method: ${method}`
      });
    }

    // Exception methods (commonly used on Exception objects)
    const exceptionMethods = [
      'getMessage', 'getCode', 'getFile', 'getLine', 'getTrace',
      'getTraceAsString', 'getPrevious', '__toString'
    ];

    for (const method of exceptionMethods) {
      this.phpBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'PHP',
        context: 'exception',
        description: `PHP Exception method: ${method}`
      });
    }

    // Laravel Model attribute methods (commonly used on models)
    const modelAttributeMethods = [
      'id', 'setAttributeNames', 'getAttribute', 'setAttribute',
      'getAttributes', 'setAttributes', 'isDirty', 'isClean',
      'wasChanged', 'getOriginal', 'syncOriginal'
    ];

    for (const method of modelAttributeMethods) {
      this.phpBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Laravel',
        context: 'model-attribute',
        description: `Laravel Model attribute method: ${method}`
      });
    }
  }

  /**
   * Initialize Vue.js Composition API and framework symbols
   */
  private initializeVueSymbols(): void {
    // Vue 3 Composition API
    const vueCompositionAPI = [
      'ref', 'reactive', 'computed', 'watch', 'watchEffect', 'readonly',
      'toRef', 'toRefs', 'isRef', 'unref', 'shallowRef', 'shallowReactive',
      'markRaw', 'toRaw', 'isReactive', 'isReadonly', 'isProxy',
      'nextTick', 'defineComponent', 'defineAsyncComponent',
      'onMounted', 'onUnmounted', 'onUpdated', 'onBeforeMount', 'onBeforeUnmount',
      'onBeforeUpdate', 'onActivated', 'onDeactivated', 'onErrorCaptured',
      'provide', 'inject', 'getCurrentInstance', 'useSlots', 'useAttrs'
    ];

    for (const method of vueCompositionAPI) {
      this.vueSymbols.push({
        name: method,
        symbol_type: SymbolType.FUNCTION,
        visibility: Visibility.PUBLIC,
        framework: 'Vue',
        context: 'composition-api',
        description: `Vue 3 Composition API: ${method}`
      });
    }

    // Vue Router composables
    const vueRouterAPI = [
      'useRouter', 'useRoute', 'onBeforeRouteLeave', 'onBeforeRouteUpdate'
    ];

    for (const method of vueRouterAPI) {
      this.vueSymbols.push({
        name: method,
        symbol_type: SymbolType.FUNCTION,
        visibility: Visibility.PUBLIC,
        framework: 'Vue',
        context: 'router',
        description: `Vue Router composable: ${method}`
      });
    }

    // Common i18n function
    this.vueSymbols.push({
      name: 't',
      symbol_type: SymbolType.FUNCTION,
      visibility: Visibility.PUBLIC,
      framework: 'Vue',
      context: 'i18n',
      description: 'Vue i18n translation function'
    });
  }

  /**
   * Initialize JavaScript built-in objects and methods
   */
  private initializeJavaScriptBuiltins(): void {
    // Array methods
    const arrayMethods = [
      'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat',
      'join', 'reverse', 'sort', 'indexOf', 'lastIndexOf', 'includes',
      'find', 'findIndex', 'filter', 'map', 'reduce', 'reduceRight',
      'forEach', 'some', 'every', 'fill', 'copyWithin', 'entries',
      'keys', 'values', 'flat', 'flatMap'
    ];

    for (const method of arrayMethods) {
      this.jsBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'JavaScript',
        context: 'Array',
        description: `Array.prototype.${method}`
      });
    }

    // String methods
    const stringMethods = [
      'charAt', 'charCodeAt', 'concat', 'indexOf', 'lastIndexOf',
      'slice', 'substring', 'substr', 'toLowerCase', 'toUpperCase',
      'trim', 'trimStart', 'trimEnd', 'replace', 'replaceAll', 'split',
      'match', 'search', 'includes', 'startsWith', 'endsWith',
      'padStart', 'padEnd', 'repeat', 'localeCompare'
    ];

    for (const method of stringMethods) {
      this.jsBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'JavaScript',
        context: 'String',
        description: `String.prototype.${method}`
      });
    }

    // Object methods
    const objectMethods = [
      'keys', 'values', 'entries', 'assign', 'create', 'defineProperty',
      'freeze', 'seal', 'hasOwnProperty', 'isPrototypeOf', 'toString',
      'valueOf', 'getOwnPropertyNames', 'getOwnPropertyDescriptor'
    ];

    for (const method of objectMethods) {
      this.jsBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'JavaScript',
        context: 'Object',
        description: `Object.${method} or Object.prototype.${method}`
      });
    }

    // Global functions
    const globalFunctions = [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI',
      'decodeURI', 'encodeURIComponent', 'decodeURIComponent'
    ];

    for (const func of globalFunctions) {
      this.jsBuiltinSymbols.push({
        name: func,
        symbol_type: SymbolType.FUNCTION,
        visibility: Visibility.PUBLIC,
        framework: 'JavaScript',
        context: 'global',
        description: `Global function: ${func}`
      });
    }

    // JSON methods
    this.jsBuiltinSymbols.push({
      name: 'stringify',
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'JSON',
      description: 'JSON.stringify'
    });

    this.jsBuiltinSymbols.push({
      name: 'parse',
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'JavaScript',
      context: 'JSON',
      description: 'JSON.parse'
    });

    // Console methods
    const consoleMethods = ['log', 'error', 'warn', 'info', 'debug', 'trace'];
    for (const method of consoleMethods) {
      this.jsBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'JavaScript',
        context: 'console',
        description: `console.${method}`
      });
    }

    // RegExp methods
    const regexpMethods = ['test', 'exec', 'match', 'replace', 'search'];
    for (const method of regexpMethods) {
      this.jsBuiltinSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'JavaScript',
        context: 'RegExp',
        description: `RegExp.prototype.${method} or String.prototype.${method}`
      });
    }
  }

  /**
   * Initialize DOM API methods
   */
  private initializeDOMSymbols(): void {
    // Document methods
    const documentMethods = [
      'getElementById', 'querySelector', 'querySelectorAll',
      'createElement', 'createTextNode', 'createDocumentFragment',
      'addEventListener', 'removeEventListener', 'dispatchEvent'
    ];

    for (const method of documentMethods) {
      this.domSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'DOM',
        context: 'document',
        description: `Document.prototype.${method}`
      });
    }

    // Element methods
    const elementMethods = [
      'appendChild', 'removeChild', 'replaceChild', 'insertBefore',
      'getAttribute', 'setAttribute', 'removeAttribute', 'hasAttribute',
      'getElementsByClassName', 'getElementsByTagName', 'closest',
      'matches', 'contains', 'cloneNode', 'focus', 'blur', 'click',
      'scrollIntoView', 'getBoundingClientRect'
    ];

    for (const method of elementMethods) {
      this.domSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'DOM',
        context: 'element',
        description: `Element.prototype.${method}`
      });
    }

    // Window methods
    const windowMethods = [
      'alert', 'confirm', 'prompt', 'open', 'close', 'focus', 'blur',
      'scroll', 'scrollTo', 'scrollBy', 'resizeTo', 'resizeBy',
      'requestAnimationFrame', 'cancelAnimationFrame'
    ];

    for (const method of windowMethods) {
      this.domSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'DOM',
        context: 'window',
        description: `Window.prototype.${method}`
      });
    }
  }

  /**
   * Initialize .NET Framework symbols
   */
  private initializeDotNetFrameworkSymbols(): void {
    // System.Threading namespace
    const threadingTypes = [
      'SemaphoreSlim', 'ReaderWriterLockSlim', 'Mutex', 'AutoResetEvent', 'ManualResetEvent',
      'CountdownEvent', 'Barrier', 'Thread', 'Task', 'CancellationToken', 'CancellationTokenSource'
    ];

    for (const type of threadingTypes) {
      this.dotnetSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'System.Threading',
        signature: `class ${type}`,
        description: `System.Threading.${type}`
      });

      // Add common methods for threading types
      const commonMethods = ['WaitAsync', 'Release', 'EnterWriteLock', 'ExitWriteLock', 'EnterReadLock', 'ExitReadLock', 'Dispose'];
      for (const method of commonMethods) {
        this.dotnetSymbols.push({
          name: `${type}.${method}`,
          symbol_type: SymbolType.METHOD,
          visibility: Visibility.PUBLIC,
          framework: 'System.Threading',
          signature: `${method}()`,
          description: `${type}.${method} method`
        });
      }
    }

    // System namespace common types
    const systemTypes = [
      'Exception', 'ArgumentException', 'InvalidOperationException', 'NotSupportedException',
      'IDisposable', 'IAsyncDisposable', 'EventArgs', 'DateTime', 'TimeSpan', 'Guid', 'Uri'
    ];

    for (const type of systemTypes) {
      this.dotnetSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'System',
        signature: `class ${type}`,
        description: `System.${type}`
      });
    }

    const exceptionProperties = [
      'Message', 'StackTrace', 'Source', 'HelpLink', 'HResult',
      'InnerException', 'Data', 'TargetSite'
    ];

    for (const prop of exceptionProperties) {
      this.dotnetSymbols.push({
        name: prop,
        symbol_type: SymbolType.PROPERTY,
        visibility: Visibility.PUBLIC,
        framework: 'System',
        signature: `Exception.${prop}`,
        description: `Exception.${prop} property`
      });
    }

    // System.Collections.Generic
    const collectionTypes = ['List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'IEnumerable', 'ICollection'];
    for (const type of collectionTypes) {
      this.dotnetSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'System.Collections.Generic',
        signature: `class ${type}<T>`,
        description: `System.Collections.Generic.${type}`
      });
    }

    const listMethods = [
      'Add', 'AddRange', 'Clear', 'Contains', 'Remove', 'RemoveAt', 'RemoveAll',
      'Insert', 'InsertRange', 'IndexOf', 'LastIndexOf', 'Find', 'FindAll',
      'FindIndex', 'FindLast', 'FindLastIndex', 'Sort', 'Reverse', 'ToArray',
      'CopyTo', 'GetRange', 'Count', 'ForEach', 'Exists', 'TrueForAll', 'constructor'
    ];

    for (const method of listMethods) {
      this.dotnetSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'System.Collections.Generic',
        signature: `List<T>.${method}()`,
        description: `List<T>.${method} method`
      });
    }

    const dictionaryMethods = [
      'Add', 'Clear', 'ContainsKey', 'ContainsValue', 'Remove', 'TryGetValue',
      'TryAdd', 'GetValueOrDefault', 'Keys', 'Values', 'Count', 'constructor'
    ];

    for (const method of dictionaryMethods) {
      this.dotnetSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'System.Collections.Generic',
        signature: `Dictionary<TKey,TValue>.${method}()`,
        description: `Dictionary<TKey,TValue>.${method} method`
      });
    }

    const hashSetMethods = [
      'Add', 'Clear', 'Contains', 'Remove', 'RemoveWhere', 'UnionWith',
      'IntersectWith', 'ExceptWith', 'SymmetricExceptWith', 'IsSubsetOf',
      'IsSupersetOf', 'Overlaps', 'SetEquals', 'Count', 'constructor'
    ];

    for (const method of hashSetMethods) {
      this.dotnetSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'System.Collections.Generic',
        signature: `HashSet<T>.${method}()`,
        description: `HashSet<T>.${method} method`
      });
    }

    // Common method names that might appear
    const frameworkMethods = [
      'WaitAsync', 'Release', 'EnterWriteLock', 'ExitWriteLock', 'EnterReadLock', 'ExitReadLock',
      'Dispose', 'ToString', 'GetHashCode', 'Equals', 'GetType', 'nameof'
    ];

    for (const method of frameworkMethods) {
      this.dotnetSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'System',
        signature: `${method}()`,
        description: `Framework method ${method}`
      });
    }

    // System.Linq extension methods
    const linqMethods = [
      'Select', 'Where', 'OrderBy', 'OrderByDescending', 'GroupBy', 'Join',
      'First', 'FirstOrDefault', 'Last', 'LastOrDefault', 'Single', 'SingleOrDefault',
      'Any', 'All', 'Count', 'Sum', 'Average', 'Min', 'Max',
      'ToList', 'ToArray', 'ToDictionary', 'ToHashSet',
      'Skip', 'Take', 'Distinct', 'Union', 'Intersect', 'Except',
      'Concat', 'Zip', 'Aggregate', 'Contains', 'SequenceEqual'
    ];

    for (const method of linqMethods) {
      this.dotnetSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'System.Linq',
        signature: `${method}()`,
        description: `LINQ extension method ${method}`
      });
    }

    // Common enum values that might appear in code (like ServiceState)
    const commonEnumValues = [
      'Idle', 'StartingTurn', 'ExecutingPhase', 'TransitioningPhase', 'Stopped', 'Running', 'Paused',
      'Success', 'Failed', 'Pending', 'Completed', 'InProgress'
    ];

    for (const enumValue of commonEnumValues) {
      this.dotnetSymbols.push({
        name: enumValue,
        symbol_type: SymbolType.VARIABLE,
        visibility: Visibility.PUBLIC,
        framework: 'System',
        signature: enumValue,
        description: `Common enum value ${enumValue}`
      });
    }
  }

  /**
   * Initialize Godot Engine framework symbols
   */
  private initializeGodotSymbols(): void {
    const coreNodeTypes = [
      'Node', 'Node2D', 'Node3D', 'RefCounted', 'Resource', 'Object'
    ];

    for (const type of coreNodeTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type}`,
        description: `Godot.${type}`
      });
    }

    const node3DTypes = [
      'Marker3D', 'Sprite3D', 'Label3D', 'Camera3D', 'MeshInstance3D',
      'Light3D', 'DirectionalLight3D', 'SpotLight3D', 'OmniLight3D',
      'VisibleOnScreenNotifier3D', 'Skeleton3D', 'BoneAttachment3D'
    ];

    for (const type of node3DTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type} : Node3D`,
        description: `Godot.${type}`
      });
    }

    const physicsTypes = [
      'CharacterBody3D', 'RigidBody3D', 'StaticBody3D', 'AnimatableBody3D',
      'Area3D', 'CollisionShape3D', 'CollisionObject3D', 'CollisionPolygon3D',
      'CharacterBody2D', 'RigidBody2D', 'StaticBody2D', 'AnimatableBody2D',
      'Area2D', 'CollisionShape2D', 'CollisionObject2D', 'CollisionPolygon2D',
      'PhysicsBody3D', 'PhysicsBody2D'
    ];

    for (const type of physicsTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type}`,
        description: `Godot.${type}`
      });
    }

    const controlTypes = [
      'Control', 'Button', 'Label', 'Panel', 'Container',
      'VBoxContainer', 'HBoxContainer', 'GridContainer', 'MarginContainer',
      'ScrollContainer', 'TextureRect', 'ColorRect', 'RichTextLabel',
      'LineEdit', 'TextEdit', 'CheckBox', 'OptionButton', 'SpinBox',
      'ProgressBar', 'Slider', 'TabContainer', 'Tree', 'ItemList',
      'PanelContainer', 'CenterContainer', 'AspectRatioContainer',
      'SplitContainer', 'HSplitContainer', 'VSplitContainer'
    ];

    for (const type of controlTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type} : Control`,
        description: `Godot.${type}`
      });
    }

    const resourceTypes = [
      'PackedScene', 'Texture2D', 'Material', 'Mesh', 'AudioStream',
      'Animation', 'Theme', 'Font', 'Shader', 'Script', 'Texture',
      'StandardMaterial3D', 'ShaderMaterial', 'ImageTexture', 'AtlasTexture',
      'AnimationLibrary', 'StyleBox', 'StyleBoxFlat', 'StyleBoxTexture'
    ];

    for (const type of resourceTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type} : Resource`,
        description: `Godot.${type}`
      });
    }

    const utilityNodeTypes = [
      'Timer', 'Tween', 'AnimationPlayer', 'AudioStreamPlayer',
      'AudioStreamPlayer2D', 'AudioStreamPlayer3D', 'HTTPRequest',
      'CanvasLayer', 'ParallaxBackground', 'ParallaxLayer'
    ];

    for (const type of utilityNodeTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type} : Node`,
        description: `Godot.${type}`
      });
    }

    const viewportTypes = [
      'SubViewport', 'Viewport', 'Window'
    ];

    for (const type of viewportTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type}`,
        description: `Godot.${type}`
      });
    }

    const valueTypes = [
      'Vector2', 'Vector2I', 'Vector3', 'Vector3I', 'Vector4', 'Vector4I',
      'Color', 'Rect2', 'Rect2I', 'Transform2D', 'Transform3D',
      'Basis', 'Quaternion', 'Plane', 'AABB', 'Projection'
    ];

    for (const type of valueTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `struct ${type}`,
        description: `Godot.${type}`
      });
    }

    const globalTypes = [
      'GD', 'ResourceLoader', 'SceneTree', 'Input', 'Time', 'OS', 'Engine',
      'ClassDB', 'EditorInterface', 'ProjectSettings'
    ];

    for (const type of globalTypes) {
      this.godotSymbols.push({
        name: type,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${type}`,
        description: `Godot.${type}`
      });
    }

    const commonMethods = [
      'GetNode', 'GetNodeOrNull', 'QueueFree', 'AddChild', 'RemoveChild',
      'Connect', 'Emit', 'EmitSignal', 'CallDeferred', 'SetDeferred',
      'GetParent', 'GetChildren', 'GetChild', 'FindChild', 'IsInsideTree',
      'GetTree', 'GetViewport', 'GetWindow', 'Print', 'PrintErr', 'PushError',
      'PushWarning', 'Load', 'Instantiate'
    ];

    for (const method of commonMethods) {
      this.godotSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `${method}()`,
        description: `Godot framework method ${method}`
      });
    }

    const colorConstants = ['Colors'];
    for (const constant of colorConstants) {
      this.godotSymbols.push({
        name: constant,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class ${constant}`,
        description: `Godot.${constant}`
      });
    }

    this.godotSymbols.push({
      name: 'Variant',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'struct Variant',
      description: 'Godot.Variant'
    });

    const variantMethods = [
      'AsString', 'AsInt', 'AsInt32', 'AsInt64', 'AsFloat', 'AsBool',
      'AsGodotArray', 'AsGodotDictionary', 'AsVector2', 'AsVector3',
      'AsNode', 'AsObject', 'AsStringName', 'AsNodePath',
      'VariantType', 'Obj', 'constructor'
    ];

    for (const method of variantMethods) {
      this.godotSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `Variant.${method}()`,
        description: `Godot Variant method ${method}`
      });
    }

    this.godotSymbols.push({
      name: 'Type',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'enum Variant.Type',
      description: 'Godot Variant.Type enum'
    });

    const variantTypeMembers = [
      'Nil', 'Bool', 'Int', 'Float', 'String', 'Vector2', 'Vector2I',
      'Rect2', 'Rect2I', 'Vector3', 'Vector3I', 'Transform2D', 'Vector4',
      'Vector4I', 'Plane', 'Quaternion', 'Aabb', 'Basis', 'Transform3D',
      'Projection', 'Color', 'StringName', 'NodePath', 'Rid', 'Object',
      'Callable', 'Signal', 'Dictionary', 'Array', 'PackedByteArray',
      'PackedInt32Array', 'PackedInt64Array', 'PackedFloat32Array',
      'PackedFloat64Array', 'PackedStringArray', 'PackedVector2Array',
      'PackedVector3Array', 'PackedColorArray', 'Max'
    ];

    for (const member of variantTypeMembers) {
      this.godotSymbols.push({
        name: member,
        symbol_type: SymbolType.VARIABLE,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `Variant.Type.${member}`,
        description: `Godot Variant.Type.${member} enum value`
      });
    }

    this.godotSymbols.push({
      name: 'FileAccess',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'class FileAccess',
      description: 'Godot.FileAccess'
    });

    const fileAccessMethods = [
      'Open', 'Close', 'GetAsText', 'GetAsJson', 'FileExists',
      'GetLine', 'GetBuffer', 'GetLength', 'GetPosition', 'Seek',
      'SeekEnd', 'IsOpen', 'GetError', 'StoreLine', 'StoreString',
      'StoreBuffer', 'Store8', 'Store16', 'Store32', 'Store64',
      'Get8', 'Get16', 'Get32', 'Get64', 'GetFloat', 'GetDouble'
    ];

    for (const method of fileAccessMethods) {
      this.godotSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `FileAccess.${method}()`,
        description: `Godot FileAccess method ${method}`
      });
    }

    this.godotSymbols.push({
      name: 'ModeFlags',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'enum FileAccess.ModeFlags',
      description: 'Godot FileAccess.ModeFlags enum'
    });

    const modeFlags = ['Read', 'Write', 'ReadWrite', 'WriteRead'];
    for (const flag of modeFlags) {
      this.godotSymbols.push({
        name: flag,
        symbol_type: SymbolType.VARIABLE,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `FileAccess.ModeFlags.${flag}`,
        description: `Godot FileAccess.ModeFlags.${flag} enum value`
      });
    }

    this.godotSymbols.push({
      name: 'Json',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'class Json',
      description: 'Godot.Json'
    });

    const jsonMethods = [
      'Parse', 'Stringify', 'GetData', 'GetErrorLine',
      'GetErrorMessage', 'GetParsedText', 'constructor'
    ];

    for (const method of jsonMethods) {
      this.godotSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `Json.${method}()`,
        description: `Godot Json method ${method}`
      });
    }

    this.godotSymbols.push({
      name: 'Error',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'enum Error',
      description: 'Godot.Error enum'
    });

    const errorValues = [
      'Ok', 'Failed', 'ErrUnavailable', 'ErrUnconfigured', 'ErrUnauthorized',
      'ErrParameterRangeError', 'ErrOutOfMemory', 'ErrFileNotFound',
      'ErrFileBadDrive', 'ErrFileBadPath', 'ErrFileNoPermission',
      'ErrFileAlreadyInUse', 'ErrFileCantOpen', 'ErrFileCantWrite',
      'ErrFileCantRead', 'ErrFileUnrecognized', 'ErrFileCorrupt',
      'ErrFileMissingDependencies', 'ErrFileEof', 'ErrCantOpen', 'ErrCantCreate'
    ];

    for (const error of errorValues) {
      this.godotSymbols.push({
        name: error,
        symbol_type: SymbolType.VARIABLE,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `Error.${error}`,
        description: `Godot Error.${error} enum value`
      });
    }

    this.godotSymbols.push({
      name: 'SignalName',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'class SceneTree.SignalName',
      description: 'Godot SceneTree.SignalName'
    });

    const sceneTreeSignals = [
      'ProcessFrame', 'PhysicsFrame', 'TreeChanged', 'TreeProcessModeChanged',
      'NodeAdded', 'NodeRemoved', 'NodeRenamed', 'NodeConfigurationWarningChanged'
    ];

    for (const signal of sceneTreeSignals) {
      this.godotSymbols.push({
        name: signal,
        symbol_type: SymbolType.VARIABLE,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `SceneTree.SignalName.${signal}`,
        description: `Godot SceneTree.SignalName.${signal} signal`
      });
    }

    this.godotSymbols.push({
      name: 'AudioStreamPlayer',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'class AudioStreamPlayer : Node',
      description: 'Godot.AudioStreamPlayer'
    });

    const audioStreamPlayerMethods = ['Play', 'Stop', 'constructor'];
    for (const method of audioStreamPlayerMethods) {
      this.godotSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `AudioStreamPlayer.${method}()`,
        description: `Godot AudioStreamPlayer method ${method}`
      });
    }

    const audioStreamPlayerProperties = ['Stream', 'Bus', 'VolumeDb'];
    for (const prop of audioStreamPlayerProperties) {
      this.godotSymbols.push({
        name: prop,
        symbol_type: SymbolType.PROPERTY,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `AudioStreamPlayer.${prop}`,
        description: `Godot AudioStreamPlayer property ${prop}`
      });
    }

    this.godotSymbols.push({
      name: 'SceneTreeTimer',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'class SceneTreeTimer : RefCounted',
      description: 'Godot.SceneTreeTimer'
    });

    this.godotSymbols.push({
      name: 'SignalName',
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: 'class SceneTreeTimer.SignalName',
      description: 'Godot SceneTreeTimer.SignalName'
    });

    const sceneTreeTimerSignals = ['Timeout'];
    for (const signal of sceneTreeTimerSignals) {
      this.godotSymbols.push({
        name: signal,
        symbol_type: SymbolType.VARIABLE,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `SceneTreeTimer.SignalName.${signal}`,
        description: `Godot SceneTreeTimer.SignalName.${signal} signal`
      });
    }

    const godotUtilityMethods = [
      'ToSignal', 'GetNodesInGroup', 'CreateTimer', 'FindChild',
      'DirExistsAbsolute', 'ListDirBegin', 'GetNext', 'CurrentIsDir',
      'EndsWith', 'GetBaseName', 'Clamp'
    ];
    for (const method of godotUtilityMethods) {
      this.godotSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `${method}()`,
        description: `Godot utility method ${method}`
      });
    }

    const godotCollectionsTypes = [
      { name: 'Dictionary', methods: ['Add', 'Clear', 'ContainsKey', 'Remove', 'TryGetValue', 'Keys', 'Values', 'Count', 'constructor'] },
      { name: 'Array', methods: ['Add', 'Clear', 'Contains', 'Remove', 'Insert', 'Count', 'constructor'] }
    ];

    for (const { name, methods } of godotCollectionsTypes) {
      this.godotSymbols.push({
        name,
        symbol_type: SymbolType.CLASS,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `class Godot.Collections.${name}`,
        description: `Godot.Collections.${name}`
      });

      for (const method of methods) {
        this.godotSymbols.push({
          name: method,
          symbol_type: SymbolType.METHOD,
          visibility: Visibility.PUBLIC,
          framework: 'Godot',
          signature: `Godot.Collections.${name}.${method}()`,
          description: `Godot.Collections.${name}.${method} method`
        });
      }
    }

    const additionalUtilityMethods = [
      'ToSignal', 'Invoke', 'ToLower', 'ToUpper', 'Substring', 'setter'
    ];

    for (const method of additionalUtilityMethods) {
      this.godotSymbols.push({
        name: method,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'Godot',
        signature: `${method}()`,
        description: `Godot utility method ${method}`
      });
    }
  }

  /**
   * Build searchable index of all framework symbols
   */
  private buildIndex(): void {
    // Index PHPUnit symbols
    for (const symbol of this.phpUnitSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index Laravel symbols
    for (const symbol of this.laravelSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index PHP built-in symbols
    for (const symbol of this.phpBuiltinSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index Vue symbols
    for (const symbol of this.vueSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index JavaScript built-in symbols
    for (const symbol of this.jsBuiltinSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index DOM symbols
    for (const symbol of this.domSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index .NET symbols
    for (const symbol of this.dotnetSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }

    // Index Godot symbols
    for (const symbol of this.godotSymbols) {
      const existing = this.symbols.get(symbol.name) || [];
      existing.push(symbol);
      this.symbols.set(symbol.name, existing);
    }
  }

  /**
   * Check if a symbol is available in a given context
   */
  public isFrameworkSymbolAvailable(symbolName: string, context: string, filePath?: string): FrameworkSymbol | null {
    const candidates = this.symbols.get(symbolName);
    if (!candidates || candidates.length === 0) {
      return null;
    }

    // For test files, prioritize PHPUnit symbols
    if (this.isTestFile(filePath)) {
      const phpunitSymbol = candidates.find(s => s.framework === 'PHPUnit');
      if (phpunitSymbol) {
        return phpunitSymbol;
      }
    }

    // For Vue files, prioritize Vue symbols
    if (this.isVueFile(filePath)) {
      const vueSymbol = candidates.find(s => s.framework === 'Vue');
      if (vueSymbol) {
        return vueSymbol;
      }
    }

    // For C# files, prioritize Godot symbols first, then .NET symbols
    if (this.isCSharpFile(filePath)) {
      const godotSymbol = candidates.find(s => s.framework === 'Godot');
      if (godotSymbol) {
        return godotSymbol;
      }

      const dotnetSymbol = candidates.find(s =>
        s.framework.startsWith('System') || s.framework === '.NET'
      );
      if (dotnetSymbol) {
        return dotnetSymbol;
      }
    }

    // For JavaScript/TypeScript files, check for JS built-ins and DOM
    if (this.isJavaScriptFile(filePath)) {
      // Prioritize framework-specific symbols first
      const jsBuiltinSymbol = candidates.find(s => s.framework === 'JavaScript');
      if (jsBuiltinSymbol) {
        return jsBuiltinSymbol;
      }

      const domSymbol = candidates.find(s => s.framework === 'DOM');
      if (domSymbol) {
        return domSymbol;
      }
    }

    // For Laravel files, check context-specific symbols
    if (this.isLaravelFile(filePath)) {
      // Check for context-specific matches first
      const contextSpecificSymbol = candidates.find(s =>
        s.framework === 'Laravel' &&
        (s.context === context || this.isCompatibleContext(context, s.context))
      );
      if (contextSpecificSymbol) {
        return contextSpecificSymbol;
      }

      // Fallback to any Laravel symbol
      const laravelSymbol = candidates.find(s => s.framework === 'Laravel');
      if (laravelSymbol) {
        return laravelSymbol;
      }
    }

    // Return the first available symbol as fallback
    return candidates[0];
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.includes('/tests/') ||
           filePath.includes('/test/') ||
           filePath.toLowerCase().includes('test.php') ||
           filePath.toLowerCase().includes('spec.php');
  }

  /**
   * Check if file is part of a Laravel project
   */
  private isLaravelFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.includes('/app/') ||
           filePath.includes('/resources/') ||
           filePath.includes('/routes/') ||
           filePath.includes('artisan') ||
           filePath.includes('Laravel') ||
           filePath.includes('Illuminate');
  }

  /**
   * Check if file is a Vue file
   */
  private isVueFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.endsWith('.vue') ||
           filePath.includes('/vue/') ||
           filePath.includes('Vue') ||
           (filePath.includes('/Composables/') && filePath.endsWith('.ts'));
  }

  /**
   * Check if file is JavaScript/TypeScript
   */
  private isJavaScriptFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.endsWith('.js') ||
           filePath.endsWith('.ts') ||
           filePath.endsWith('.jsx') ||
           filePath.endsWith('.tsx') ||
           filePath.endsWith('.mjs') ||
           filePath.endsWith('.cjs') ||
           filePath.endsWith('.vue');
  }

  /**
   * Check if file is a C# file
   */
  private isCSharpFile(filePath?: string): boolean {
    if (!filePath) return false;
    return filePath.endsWith('.cs');
  }

  /**
   * Check if contexts are compatible (e.g., validation context can access message_bag methods)
   */
  private isCompatibleContext(requestedContext: string, symbolContext?: string): boolean {
    if (!symbolContext) return true;

    const compatibilityMap: Record<string, string[]> = {
      'validation': ['message_bag', 'request'],
      'test': ['validation', 'request', 'collection'],
      'request': ['validation', 'collection']
    };

    const compatibleContexts = compatibilityMap[requestedContext] || [];
    return compatibleContexts.includes(symbolContext);
  }

  /**
   * Get all symbols for a given framework
   */
  public getFrameworkSymbols(framework: string): FrameworkSymbol[] {
    switch (framework.toLowerCase()) {
      case 'phpunit':
        return this.phpUnitSymbols;
      case 'laravel':
        return this.laravelSymbols;
      case 'vue':
        return this.vueSymbols;
      case 'javascript':
        return this.jsBuiltinSymbols;
      case 'dom':
        return this.domSymbols;
      case 'dotnet':
      case '.net':
      case 'system':
        return this.dotnetSymbols;
      case 'godot':
        return this.godotSymbols;
      default:
        return [];
    }
  }

  /**
   * Get all available symbol names
   */
  public getAllSymbolNames(): string[] {
    return Array.from(this.symbols.keys());
  }
}

// Export singleton instance
export const frameworkSymbolRegistry = new FrameworkSymbolRegistry();