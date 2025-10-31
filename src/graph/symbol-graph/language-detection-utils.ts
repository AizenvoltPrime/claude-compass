import { stripGenericParameters } from './name-parsing-utils';

export function getLanguageFromPath(filePath: string): string {
  if (filePath.endsWith('.php')) return 'php';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
  if (filePath.endsWith('.vue')) return 'vue';
  if (filePath.endsWith('.cs')) return 'csharp';
  if (filePath.endsWith('.py')) return 'python';
  return 'unknown';
}

export function areLanguagesCompatible(lang1: string, lang2: string): boolean {
  if (lang1 === lang2) return true;

  const frontendLanguages = new Set(['typescript', 'javascript', 'vue']);
  if (frontendLanguages.has(lang1) && frontendLanguages.has(lang2)) {
    return true;
  }

  return false;
}

export function isInstanceMemberAccess(name: string): boolean {
  if (!name.includes('.')) {
    return false;
  }

  const dotIndex = name.indexOf('.');
  const firstPart = name.substring(0, dotIndex);

  return firstPart.length > 0 && (
    firstPart[0] === firstPart[0].toLowerCase() ||
    firstPart.startsWith('_')
  );
}

export function isExternalReference(name: string): boolean {
  const externalNamespaces = [
    'Godot', 'System', 'Variant', 'FileAccess', 'Json', 'Error',
    'SceneTree', 'List', 'Dictionary', 'HashSet', 'Queue', 'Stack',
    'Exception', 'ArgumentException', 'InvalidOperationException',
    'DateTime', 'TimeSpan', 'Guid', 'Uri', 'Task', 'Thread',
    'Node', 'Node2D', 'Node3D', 'Control', 'Resource', 'Object',
    'Vector2', 'Vector3', 'Color', 'Transform2D', 'Transform3D',
    'AnimationPlayer', 'AnimationTree', 'AudioStreamPlayer', 'AudioStreamPlayer2D', 'AudioStreamPlayer3D',
    'Camera2D', 'Camera3D', 'CollisionShape2D', 'CollisionShape3D',
    'Label', 'Button', 'TextureRect', 'Sprite2D', 'Sprite3D',
    'Timer', 'Area2D', 'Area3D', 'CharacterBody2D', 'CharacterBody3D',
    'RigidBody2D', 'RigidBody3D', 'StaticBody2D', 'StaticBody3D',
    'TileMap', 'NavigationAgent2D', 'NavigationAgent3D'
  ];

  const strippedName = stripGenericParameters(name);

  if (!strippedName.includes('.')) {
    return externalNamespaces.includes(strippedName);
  }

  const parts = strippedName.split('.');
  const firstPart = parts[0];

  return externalNamespaces.includes(firstPart) ||
         parts.some(part => part === 'Type' || part === 'ModeFlags' || part === 'SignalName');
}
