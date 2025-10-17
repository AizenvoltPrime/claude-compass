import { ParsedDependency, ParsedImport } from '../../../parsers/base';
import { IContextAnalyzer, IResolutionContext, FrameworkContext } from '../interfaces';

export class ContextAnalyzer implements IContextAnalyzer {
  private testFilePatterns = [
    /\/tests?\//,
    /\/spec\//,
    /\/__tests__\//,
    /\.test\.(ts|tsx|js|jsx|php)$/,
    /\.spec\.(ts|tsx|js|jsx|php)$/,
    /Test\.php$/,
    /Spec\.php$/,
  ];

  private validationPatterns = [
    'validator',
    'validation',
    'validate',
    'errors',
    'rules',
    'messages',
    'MessageBag',
  ];

  private requestPatterns = ['request', 'input', 'validate', 'Request'];

  analyzeContext(context: IResolutionContext, dependency?: ParsedDependency): FrameworkContext {
    const framework = this.detectFramework(context.filePath, context.imports);
    const isTestFile = this.isTestFile(context.filePath);
    const isValidationContext = this.isValidationContext(dependency);
    const isRequestContext = this.isRequestContext(dependency);

    const contextHints: string[] = [];

    if (isTestFile) {
      contextHints.push('test');
    }

    if (isValidationContext) {
      contextHints.push('validation');
    }

    if (isRequestContext) {
      contextHints.push('request');
    }

    if (framework) {
      contextHints.push(`framework:${framework}`);
    }

    return {
      framework: framework || 'unknown',
      isTestFile,
      isValidationContext,
      isRequestContext,
      contextHints,
    };
  }

  isTestFile(filePath: string): boolean {
    return this.testFilePatterns.some(pattern => pattern.test(filePath));
  }

  detectFramework(filePath: string, imports: ParsedImport[]): string | null {
    const importSources = imports.map(imp => imp.source);

    if (filePath.endsWith('.vue') || importSources.some(src => src === 'vue' || src.startsWith('@vue'))) {
      return 'vue';
    }

    if (
      importSources.some(src => src === 'react' || src.startsWith('react-') || src.startsWith('@react'))
    ) {
      return 'react';
    }

    if (filePath.endsWith('.php')) {
      if (
        importSources.some(
          src =>
            src.includes('Illuminate\\') ||
            src.includes('Laravel\\') ||
            src.startsWith('Illuminate/') ||
            src.startsWith('Laravel/')
        )
      ) {
        return 'laravel';
      }
      return 'php';
    }

    if (filePath.endsWith('.cs')) {
      if (filePath.includes('Godot') || importSources.some(src => src.startsWith('Godot'))) {
        return 'godot';
      }
      return 'csharp';
    }

    if (
      importSources.some(
        src => src === 'next' || src.startsWith('next/') || src.startsWith('@next/')
      )
    ) {
      return 'nextjs';
    }

    return null;
  }

  private isValidationContext(dependency?: ParsedDependency): boolean {
    if (!dependency) {
      return false;
    }

    const toCheck = [
      dependency.to_symbol,
      dependency.from_symbol,
      dependency.qualified_context,
    ].filter(Boolean);

    return this.validationPatterns.some(pattern =>
      toCheck.some(str => str && str.toLowerCase().includes(pattern.toLowerCase()))
    );
  }

  private isRequestContext(dependency?: ParsedDependency): boolean {
    if (!dependency) {
      return false;
    }

    const toCheck = [
      dependency.to_symbol,
      dependency.from_symbol,
      dependency.qualified_context,
    ].filter(Boolean);

    return this.requestPatterns.some(pattern =>
      toCheck.some(str => str && str.toLowerCase().includes(pattern.toLowerCase()))
    );
  }
}
