import type { Demand, PipelineFlow } from './schema';
import { demandNodes, demandStations } from './templates';

const DEMAND_STATUS_LADDER: Demand["status"][] = ["demand.drafting", "demand.reviewed", "demand.scheduled", "demand.developing", "demand.validating"];
export const deriveDemandStatus = (flow: PipelineFlow, demand: Demand): Demand["status"] => {
  if (demand.status === "demand.paused" || demand.status === "demand.cancelled") return demand.status;
  const allNodes = demandNodes(flow, demand);
  if (!allNodes.length) return demand.status;
  if (allNodes.some((node) => node.kind === "gate" && node.status === "waiting_human")) return "demand.pending_review";
  if (allNodes.every((node) => node.status === "done" || node.status === "skipped")) return "demand.released";
  const stationList = demandStations(flow, demand);
  const nodeStatusOf = (id: string) => allNodes.find((candidate) => candidate.id === id)?.status;
  const firstIncomplete = stationList.findIndex((station) => !(station.nodeIds || []).every((id) => {
    const status = nodeStatusOf(id);
    return status === "done" || status === "skipped";
  }));
  if (firstIncomplete === -1) return "demand.released";
  return DEMAND_STATUS_LADDER[Math.min(firstIncomplete, DEMAND_STATUS_LADDER.length - 1)];
};
