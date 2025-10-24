import { FrameworkEntity } from '../base';

export interface LaravelRoute extends FrameworkEntity {
  type: 'route';
  path: string;
  method: string;
  controller?: string;
  action?: string;
  middleware: string[];
  routeGroup?: string;
  routeName?: string;
  framework: 'laravel';
}

export interface LaravelController extends FrameworkEntity {
  type: 'controller';
  actions: string[];
  middleware: string[];
  resourceController: boolean;
  framework: 'laravel';
}

export interface EloquentModel extends FrameworkEntity {
  type: 'model';
  tableName?: string;
  fillable: string[];
  relationships: Array<{
    name: string;
    type: string;
    relatedModel: string;
    foreignKey?: string;
    localKey?: string;
  }>;
  framework: 'laravel';
}

export interface LaravelMiddleware extends FrameworkEntity {
  type: 'middleware';
  handleMethod?: string;
  parameters: string[];
  framework: 'laravel';
}

export interface LaravelJob extends FrameworkEntity {
  type: 'job';
  handleMethod?: string;
  queueConnection?: string;
  attempts?: number;
  timeout?: number;
  framework: 'laravel';
}

export interface LaravelServiceProvider extends FrameworkEntity {
  type: 'service_provider';
  registerMethod?: string;
  bootMethod?: string;
  bindings: string[];
  framework: 'laravel';
}

export interface LaravelCommand extends FrameworkEntity {
  type: 'command';
  signature?: string;
  description?: string;
  handleMethod?: string;
  framework: 'laravel';
}

export interface LaravelFormRequest extends FrameworkEntity {
  type: 'form_request';
  rules: Record<string, string>;
  messages: Record<string, string>;
  authorize: boolean;
  framework: 'laravel';
}

export interface LaravelEvent extends FrameworkEntity {
  type: 'event';
  shouldBroadcast: boolean;
  broadcastType: 'ShouldBroadcast' | 'ShouldBroadcastNow';
  channels: string[];
  broadcastWith: Record<string, any>;
  framework: 'laravel';
}

export interface LaravelMail extends FrameworkEntity {
  type: 'mail';
  shouldQueue: boolean;
  view: string;
  subject: string;
  markdown: boolean;
  framework: 'laravel';
}

export interface LaravelPolicy extends FrameworkEntity {
  type: 'policy';
  methods: string[];
  model: string;
  usesHandlesAuthorization: boolean;
  framework: 'laravel';
}

export interface LaravelListener extends FrameworkEntity {
  type: 'listener';
  event: string;
  handleMethod: string;
  shouldQueue: boolean;
  framework: 'laravel';
}

export interface LaravelService extends FrameworkEntity {
  type: 'service';
  methods: string[];
  dependencies: string[];
  namespace: string;
  framework: 'laravel';
}

export interface LaravelFactory extends FrameworkEntity {
  type: 'factory';
  model: string;
  states: string[];
  definition: Record<string, any>;
  framework: 'laravel';
}

export interface LaravelTrait extends FrameworkEntity {
  type: 'trait';
  methods: string[];
  properties: string[];
  uses: string[];
  framework: 'laravel';
}

export interface LaravelResource extends FrameworkEntity {
  type: 'resource';
  toArrayMethod: string;
  withMethod: string;
  additionalData: Record<string, any>;
  framework: 'laravel';
}

export interface LaravelObserver extends FrameworkEntity {
  type: 'observer';
  model: string;
  observedEvents: string[];
  methods: string[];
  framework: 'laravel';
}

export interface LaravelApiSchema extends FrameworkEntity {
  type: 'api_schema';
  controllerMethod: string;
  route: string;
  httpMethod: string;
  requestValidation?: ValidationRule[];
  responseSchema?: any;
  location: {
    line: number;
    column: number;
  };
  framework: 'laravel';
}

export interface ValidationRule {
  field: string;
  rules: string[];
  typeScriptEquivalent: string;
  required: boolean;
  nullable: boolean;
}

export interface LaravelResponseSchema extends FrameworkEntity {
  type: 'response_schema';
  controllerAction: string;
  responseType: 'json' | 'resource' | 'collection' | 'custom';
  structure: any;
  framework: 'laravel';
}
