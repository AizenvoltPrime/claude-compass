import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize Godot Engine framework symbols
 */
export function initializeGodotSymbols(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

  const coreNodeTypes = [
    'Node', 'Node2D', 'Node3D', 'RefCounted', 'Resource', 'Object'
  ];

  for (const type of coreNodeTypes) {
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
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
    symbols.push({
      name: constant,
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `class ${constant}`,
      description: `Godot.${constant}`
    });
  }

  symbols.push({
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
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `Variant.${method}()`,
      description: `Godot Variant method ${method}`
    });
  }

  symbols.push({
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
    symbols.push({
      name: member,
      symbol_type: SymbolType.VARIABLE,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `Variant.Type.${member}`,
      description: `Godot Variant.Type.${member} enum value`
    });
  }

  symbols.push({
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
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `FileAccess.${method}()`,
      description: `Godot FileAccess method ${method}`
    });
  }

  symbols.push({
    name: 'ModeFlags',
    symbol_type: SymbolType.CLASS,
    visibility: Visibility.PUBLIC,
    framework: 'Godot',
    signature: 'enum FileAccess.ModeFlags',
    description: 'Godot FileAccess.ModeFlags enum'
  });

  const modeFlags = ['Read', 'Write', 'ReadWrite', 'WriteRead'];
  for (const flag of modeFlags) {
    symbols.push({
      name: flag,
      symbol_type: SymbolType.VARIABLE,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `FileAccess.ModeFlags.${flag}`,
      description: `Godot FileAccess.ModeFlags.${flag} enum value`
    });
  }

  symbols.push({
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
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `Json.${method}()`,
      description: `Godot Json method ${method}`
    });
  }

  symbols.push({
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
    symbols.push({
      name: error,
      symbol_type: SymbolType.VARIABLE,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `Error.${error}`,
      description: `Godot Error.${error} enum value`
    });
  }

  symbols.push({
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
    symbols.push({
      name: signal,
      symbol_type: SymbolType.VARIABLE,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `SceneTree.SignalName.${signal}`,
      description: `Godot SceneTree.SignalName.${signal} signal`
    });
  }

  symbols.push({
    name: 'AudioStreamPlayer',
    symbol_type: SymbolType.CLASS,
    visibility: Visibility.PUBLIC,
    framework: 'Godot',
    signature: 'class AudioStreamPlayer : Node',
    description: 'Godot.AudioStreamPlayer'
  });

  const audioStreamPlayerMethods = ['Play', 'Stop', 'constructor'];
  for (const method of audioStreamPlayerMethods) {
    symbols.push({
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
    symbols.push({
      name: prop,
      symbol_type: SymbolType.PROPERTY,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `AudioStreamPlayer.${prop}`,
      description: `Godot AudioStreamPlayer property ${prop}`
    });
  }

  symbols.push({
    name: 'SceneTreeTimer',
    symbol_type: SymbolType.CLASS,
    visibility: Visibility.PUBLIC,
    framework: 'Godot',
    signature: 'class SceneTreeTimer : RefCounted',
    description: 'Godot.SceneTreeTimer'
  });

  symbols.push({
    name: 'SignalName',
    symbol_type: SymbolType.CLASS,
    visibility: Visibility.PUBLIC,
    framework: 'Godot',
    signature: 'class SceneTreeTimer.SignalName',
    description: 'Godot SceneTreeTimer.SignalName'
  });

  const sceneTreeTimerSignals = ['Timeout'];
  for (const signal of sceneTreeTimerSignals) {
    symbols.push({
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
    symbols.push({
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
    symbols.push({
      name,
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `class Godot.Collections.${name}`,
      description: `Godot.Collections.${name}`
    });

    for (const method of methods) {
      symbols.push({
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
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'Godot',
      signature: `${method}()`,
      description: `Godot utility method ${method}`
    });
  }

  return symbols;
}
