export interface ImpactItem {
  id: number;
  name: string;
  type: string;
  file_path: string;
  impact_type:
    | 'direct'
    | 'indirect'
    | 'cross_stack'
    | 'interface_contract'
    | 'implementation'
    | 'delegation';
  relationship_type?: string;
  relationship_context?: string;
  direction?: 'dependency' | 'caller';
  framework?: string;
  call_chain?: string;
  depth?: number;
  line_number?: number;
  to_qualified_name?: string;
}

export interface TestImpactItem {
  id: number;
  name: string;
  file_path: string;
  test_type: string;
}

export interface RouteImpactItem {
  id: number;
  path: string;
  method: string;
  framework: string;
}

export interface JobImpactItem {
  id: number;
  name: string;
  type: string;
}
