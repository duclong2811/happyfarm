/**
 * The signature for the resource-node layer includes whether each selected model is available.
 *
 * A resource row can arrive before its GLB. Keeping the row identity alone in the signature makes
 * the first (empty) rebuild look complete, so the same row is never rebuilt when the model later
 * arrives. Availability is presentation state, not farm state, and belongs in this gate.
 */
export interface ResourceLayerNode {
  readonly id: string;
  readonly definitionId: string;
  readonly modelId: string;
  readonly depletedModelId: string | null;
  readonly available: boolean;
}

export function resourceNodeLayerSignature(
  nodes: readonly ResourceLayerNode[],
  modelReady: (modelId: string) => boolean
): string {
  return nodes
    .map((node) => {
      const depleted = !node.available && node.depletedModelId !== null;
      const modelId = depleted ? node.depletedModelId : node.modelId;
      return `${node.id}:${node.definitionId}:${node.modelId}:${node.depletedModelId ?? ""}:${node.available ? "1" : "0"}` +
        `:${modelId}:${modelReady(modelId) ? "ready" : "pending"}`;
    })
    .join("|");
}
