import type {DealRow,StageRow} from '../data';

/**
 * Transitional display only: never deletes a stage or moves an opportunity.
 * Enable ONLY after the verified-paid delivery->legacy-mail bridge is deployed.
 * The legacy stage becomes visible again if ANY deal still references it.
 */
export const LEGACY_IMPLEMENTATION_STAGE_ID='a623469a-34c8-4c21-9a44-7e20cc7df502';
export function commercialStageList(
  stages:readonly StageRow[],deals:readonly DealRow[],splitEnabled:boolean,
):StageRow[]{
 if(!splitEnabled)return [...stages];
 const hasLegacyDeal=deals.some(d=>!d.deleted&&d.data.stage_id===LEGACY_IMPLEMENTATION_STAGE_ID);
 return stages.filter(s=>s.id!==LEGACY_IMPLEMENTATION_STAGE_ID||hasLegacyDeal);
}
