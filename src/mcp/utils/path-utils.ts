export function getClassNameFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop() || '';
  return fileName.replace(/\.(cs|js|ts|php|vue)$/, '');
}

export function getFrameworkPath(framework: string): string {
  switch (framework) {
    case 'laravel':
      return 'app/';
    case 'vue':
      return '.vue';
    case 'react':
      return 'components/';
    case 'node':
      return 'server/';
    case 'godot':
      return 'scenes/';
    default:
      return '';
  }
}

export function determineTestType(filePath: string): string {
  if (filePath.includes('.test.') || filePath.includes('test/')) return 'unit';
  if (filePath.includes('.spec.') || filePath.includes('spec/')) return 'spec';
  if (filePath.includes('e2e') || filePath.includes('integration')) return 'integration';
  if (filePath.includes('cypress') || filePath.includes('playwright')) return 'e2e';
  return 'unknown';
}
