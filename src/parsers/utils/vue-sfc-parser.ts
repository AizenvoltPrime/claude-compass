import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('vue-sfc-parser');

export interface SFCSections {
  template?: string;
  script?: string;
  scriptSetup?: string;
  style?: string;
  styleScoped?: boolean;
  styleModules?: boolean;
  styleLang?: string;
  scriptLang?: string;
}

export class VueSFCParser {
  extractSections(content: string): SFCSections {
    const sections: SFCSections = {};

    sections.template = this.extractTemplate(content);
    sections.script = this.extractScript(content);
    sections.scriptSetup = this.extractScriptSetup(content);
    sections.scriptLang = this.extractScriptLang(content);
    sections.style = this.extractStyle(content);
    sections.styleScoped = this.hasStyleScoped(content);
    sections.styleModules = this.hasStyleModules(content);
    sections.styleLang = this.extractStyleLang(content);

    this.validateExtraction(sections, content);

    return sections;
  }

  getCombinedScript(sections: SFCSections): string {
    const scriptParts: string[] = [];

    if (sections.scriptSetup) {
      scriptParts.push(sections.scriptSetup);
    }

    if (sections.script) {
      scriptParts.push(sections.script);
    }

    return scriptParts.join('\n');
  }

  private extractTemplate(content: string): string | undefined {
    const match = content.match(/<template[^>]*>([\s\S]*)<\/template>/);
    return match?.[1];
  }

  private extractScriptSetup(content: string): string | undefined {
    const match = content.match(/<script\s+setup[^>]*>([\s\S]*?)<\/script>/);
    return match?.[1];
  }

  private extractScript(content: string): string | undefined {
    const match = content.match(/<script(?!\s+setup)[^>]*>([\s\S]*?)<\/script>/);
    return match?.[1];
  }

  private extractScriptLang(content: string): string | undefined {
    const match = content.match(/<script[^>]*\s+lang=["']([^"']+)["']/);
    return match?.[1];
  }

  private extractStyle(content: string): string | undefined {
    const match = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    return match?.[1];
  }

  private hasStyleScoped(content: string): boolean {
    return /<style[^>]*\s+scoped/.test(content);
  }

  private hasStyleModules(content: string): boolean {
    return /<style\s+module/.test(content);
  }

  private extractStyleLang(content: string): string | undefined {
    const match = content.match(/<style\s+[^>]*lang=["']([^"']+)["']/);
    return match?.[1];
  }

  private validateExtraction(sections: SFCSections, content: string): void {
    const combined = this.getCombinedScript(sections);

    if (combined && !this.isValidJavaScript(combined)) {
      logger.warn('Suspicious script extraction detected', {
        scriptLength: combined.length,
        hasSetup: !!sections.scriptSetup,
        hasRegular: !!sections.script,
        hasLeakage: combined.includes('</script>') || combined.includes('</template>')
      });
    }

    if (sections.scriptSetup && sections.script) {
      logger.debug('Multiple script blocks detected', {
        setupLength: sections.scriptSetup.length,
        regularLength: sections.script.length
      });
    }
  }

  private isValidJavaScript(code: string): boolean {
    let braceDepth = 0;

    for (const char of code) {
      if (char === '{') braceDepth++;
      if (char === '}') braceDepth--;
      if (braceDepth < 0) return false;
    }

    if (code.includes('</script>') || code.includes('</template>')) {
      return false;
    }

    return braceDepth === 0;
  }
}
