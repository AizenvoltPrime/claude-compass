import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize PHP built-in functions and Laravel Facades
 */
export function initializePHPBuiltins(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

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
    symbols.push({
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
      symbols.push({
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
    symbols.push({
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
      symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Laravel',
      context: 'model-attribute',
      description: `Laravel Model attribute method: ${method}`
    });
  }

  // Laravel UploadedFile methods (file upload handling)
  const uploadedFileMethods = [
    'store', 'storeAs', 'storePublicly', 'storePubliclyAs',
    'move', 'isValid', 'getError', 'getClientOriginalName',
    'getClientOriginalExtension', 'getClientMimeType', 'guessExtension',
    'getMimeType', 'getSize', 'getPath', 'getRealPath', 'getPathname',
    'getBasename', 'getFilename', 'getExtension', 'hashName'
  ];

  for (const method of uploadedFileMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Laravel',
      context: 'uploaded-file',
      description: `Laravel UploadedFile method: ${method}`
    });
  }

  // Laravel Storage facade methods (filesystem operations)
  const storageMethods = [
    'disk', 'get', 'put', 'putFile', 'putFileAs', 'exists', 'missing',
    'download', 'url', 'temporaryUrl', 'delete', 'copy', 'move', 'size',
    'lastModified', 'files', 'allFiles', 'directories', 'allDirectories',
    'makeDirectory', 'deleteDirectory', 'path', 'prepend', 'append'
  ];

  for (const method of storageMethods) {
    symbols.push({
      name: `Storage::${method}`,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Laravel',
      context: 'storage-facade',
      description: `Laravel Storage facade method: ${method}`
    });
  }

  return symbols;
}
