import { FrameworkEntity } from '../base';

export interface VueApiCall extends FrameworkEntity {
  type: 'api_call';
  url: string;
  normalizedUrl: string;
  method: string;
  requestType?: string;
  responseType?: string;
  location: {
    line: number;
    column: number;
  };
  framework: 'vue';
}

export interface VueTypeInterface extends FrameworkEntity {
  type: 'type_interface';
  properties: Array<{
    name: string;
    type: string;
    optional: boolean;
  }>;
  usage: 'request' | 'response' | 'generic';
  framework: 'vue';
}
