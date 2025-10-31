/**
 * Feature clustering and identification utilities
 */

import { CrossStackGraphData, FeatureCluster, CrossStackNode } from './types';

/**
 * Identify feature clusters from cross-stack graphs
 */
export function identifyFeatureClusters(
  apiCallGraph: CrossStackGraphData,
  dataContractGraph: CrossStackGraphData
): FeatureCluster[] {
  const features: FeatureCluster[] = [];
  const processedNodes = new Set<string>();

  const nodeGroups = new Map<string, CrossStackNode[]>();

  for (const node of apiCallGraph.nodes) {
    if (node.type === 'vue_component') {
      const prefix = extractFeaturePrefix(node.name);
      if (!nodeGroups.has(prefix)) {
        nodeGroups.set(prefix, []);
      }
      nodeGroups.get(prefix)!.push(node);
    }
  }

  for (const [featureName, nodes] of nodeGroups) {
    if (nodes.length > 0) {
      const vueComponents = nodes.filter(n => n.framework === 'vue');
      const laravelRoutes = apiCallGraph.nodes.filter(
        n =>
          n.framework === 'laravel' &&
          apiCallGraph.edges.some(
            e => vueComponents.some(vc => vc.id === e.from) && n.id === e.to
          )
      );

      const sharedSchemas = dataContractGraph.nodes.filter(n =>
        n.name.toLowerCase().includes(featureName.toLowerCase())
      );

      const relatedEdges = [
        ...apiCallGraph.edges.filter(
          e =>
            vueComponents.some(vc => vc.id === e.from) || laravelRoutes.some(lr => lr.id === e.to)
        ),
        ...dataContractGraph.edges.filter(e =>
          sharedSchemas.some(s => s.id === e.from || s.id === e.to)
        ),
      ];

      if (vueComponents.length > 0 || laravelRoutes.length > 0) {
        features.push({
          id: `feature_${featureName}`,
          name: featureName,
          vueComponents,
          laravelRoutes,
          sharedSchemas,
          metadata: {
            apiCallCount: relatedEdges.filter(e => e.relationshipType === 'api_call').length,
            schemaCount: relatedEdges.filter(e => e.relationshipType === 'shares_schema').length,
          },
        });
      }
    }
  }

  return features;
}

/**
 * Extract feature prefix from component/route name
 */
export function extractFeaturePrefix(name: string): string {
  const match = name.match(/^([A-Z][a-z]+)/);
  return match ? match[1] : name;
}
