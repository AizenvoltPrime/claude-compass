/**
 * Shared framework detection utility for parsers
 *
 * Centralizes framework detection logic to avoid duplication across parsers.
 * Each detector only runs if the framework is present in repositoryFrameworks,
 * preventing false positives from generic patterns.
 */

export class FrameworkDetector {
  /**
   * Detect if content contains Vue framework patterns
   */
  static detectVue(content: string, repositoryFrameworks?: string[]): boolean {
    // Only auto-detect if Vue is in repository frameworks
    if (!repositoryFrameworks?.includes('vue')) {
      return false;
    }

    // Check for Vue-specific imports and patterns
    const vuePatterns = [
      /from\s+['"]pinia['"]/,                    // Pinia store
      /from\s+['"]vue['"]/,                      // Vue core
      /from\s+['"]vue-router['"]/,               // Vue Router
      /from\s+['"]@vue\//,                       // Vue packages
      /defineStore\s*\(/,                        // Pinia defineStore
      /createRouter\s*\(/,                       // Vue Router
      /computed\s*\(/,                           // Vue computed
      /ref\s*\(/,                                // Vue ref
      /reactive\s*\(/,                           // Vue reactive
      /watch\s*\(/,                              // Vue watch
      /onMounted\s*\(/,                          // Vue lifecycle
      /onUnmounted\s*\(/,                        // Vue lifecycle
    ];

    return vuePatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect if content contains Laravel framework patterns
   */
  static detectLaravel(content: string, repositoryFrameworks?: string[]): boolean {
    // Only auto-detect if Laravel is in repository frameworks
    if (!repositoryFrameworks?.includes('laravel')) {
      return false;
    }

    // Check for Laravel-specific patterns in code content
    const laravelPatterns = [
      /use\s+Illuminate\\/,                      // Laravel framework imports
      /extends\s+Controller/,                    // Controller inheritance
      /extends\s+Model/,                         // Eloquent model
      /use\s+Illuminate\\Database\\Eloquent/,    // Eloquent namespace
      /Illuminate\\Http\\Request/,               // Request class
      /Illuminate\\Support\\Facades/,            // Facades
      /namespace\s+App\\/,                       // Laravel app namespace
    ];

    return laravelPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect if content contains React framework patterns
   */
  static detectReact(content: string, repositoryFrameworks?: string[]): boolean {
    // Only auto-detect if React is in repository frameworks
    if (!repositoryFrameworks?.includes('react')) {
      return false;
    }

    // Check for React-specific imports and patterns
    const reactPatterns = [
      /from\s+['"]react['"]/,                    // React core
      /import\s+React/,                          // React import
      /from\s+['"]react-dom['"]/,                // React DOM
      /useState\s*\(/,                           // React hooks
      /useEffect\s*\(/,                          // React hooks
      /useContext\s*\(/,                         // React hooks
      /useMemo\s*\(/,                            // React hooks
      /useCallback\s*\(/,                        // React hooks
      /React\.Component/,                        // Class components
      /React\.createElement/,                    // React elements
    ];

    return reactPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect if content contains Next.js framework patterns
   */
  static detectNextJS(content: string, repositoryFrameworks?: string[]): boolean {
    // Only auto-detect if Next.js is in repository frameworks
    if (!repositoryFrameworks?.includes('nextjs')) {
      return false;
    }

    // Check for Next.js-specific imports and patterns
    const nextJsPatterns = [
      /from\s+['"]next['"]/,                     // Next.js core
      /from\s+['"]next\/router['"]/,             // Next.js router
      /from\s+['"]next\/link['"]/,               // Next.js Link
      /from\s+['"]next\/image['"]/,              // Next.js Image
      /from\s+['"]next\/head['"]/,               // Next.js Head
      /getServerSideProps/,                      // Next.js SSR
      /getStaticProps/,                          // Next.js SSG
      /getStaticPaths/,                          // Next.js SSG
    ];

    return nextJsPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect if content contains Express framework patterns
   */
  static detectExpress(content: string, repositoryFrameworks?: string[]): boolean {
    // Only auto-detect if Express is in repository frameworks
    if (!repositoryFrameworks?.includes('express')) {
      return false;
    }

    // Check for Express-specific patterns
    const expressPatterns = [
      /require\s*\(\s*['"]express['"]\s*\)/,     // CommonJS require
      /from\s+['"]express['"]/,                  // ES6 import
      /express\s*\(\s*\)/,                       // Express initialization
      /app\.get\s*\(/,                           // Route handlers
      /app\.post\s*\(/,                          // Route handlers
      /app\.use\s*\(/,                           // Middleware
      /req\.params/,                             // Request params
      /res\.json\s*\(/,                          // Response methods
    ];

    return expressPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Auto-detect framework from content
   * Returns the first framework detected, or null if none found
   */
  static autoDetect(content: string, repositoryFrameworks?: string[]): string | null {
    if (this.detectVue(content, repositoryFrameworks)) return 'vue';
    if (this.detectReact(content, repositoryFrameworks)) return 'react';
    if (this.detectNextJS(content, repositoryFrameworks)) return 'nextjs';
    if (this.detectLaravel(content, repositoryFrameworks)) return 'laravel';
    if (this.detectExpress(content, repositoryFrameworks)) return 'express';
    return null;
  }
}
