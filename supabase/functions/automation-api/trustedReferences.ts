/**
 * Resolve publication references from trusted database reads on EACH request.
 * Never accept a browser-provided allowlist or a browser-supplied validation report.
 * Catalog status alone is not enough: Meta components require verification.
 */
import type { TrustedReferences } from './graphGuard.ts';

type QueryClient = {
  from: (table: string) => any;
};
const EVENTS = [
  'opportunity.created','opportunity.updated','opportunity.stage_changed',
  'lead.intake_received','checkout.started','checkout.expired',
  'billing.paid_verified','billing.failed','conversation.inbound',
  'conversation.human_takeover','meeting.scheduled','proposal.sent','onboarding.started','mail.sent',
] as const;

export async function loadTrustedReferences(
  db: QueryClient, workspaceId: string,
): Promise<TrustedReferences> {
  const [stages,templates,knowledge,dictionaries]=await Promise.all([
    db.from('crm_records').select('id').eq('kind','stage').eq('deleted',false).limit(100),
    db.from('automation_template_registry')
      .select('id,provider_status,parameter_schema').eq('workspace_id',workspaceId).limit(200),
    db.from('automation_knowledge_release')
      .select('id').eq('workspace_id',workspaceId).eq('status','published').limit(100),
    db.from('automation_intent_dictionary')
      .select('id').eq('workspace_id',workspaceId).eq('status','published').limit(100),
  ]);
  if(stages.error||templates.error||knowledge.error||dictionaries.error)
    throw new Error('CANONICAL_REFERENCES_UNAVAILABLE');
  const verified=(templates.data||[]).filter((t:{
    id:string;provider_status:string;parameter_schema:unknown;
  })=>{
    const schema=t.parameter_schema;
    if(t.provider_status!=='APPROVED'||!schema||typeof schema!=='object'
      ||Array.isArray(schema))return false;
    const props=schema as Record<string,unknown>;
    const indices=props.variable_numbers;
    return props.components_verified===true && Array.isArray(indices)
      && indices.length<=20
      && indices.every(x=>typeof x==='string'&&/^[1-9][0-9]?$/.test(x))
      && new Set(indices).size===indices.length;
  });
  return {
    eventTypes:[...EVENTS],
    stageIds:(stages.data||[]).map((x:{id:string})=>x.id),
    templateIds:verified.map((t:{id:string})=>t.id),
    templateVariables:Object.fromEntries(verified.map((t:{id:string;parameter_schema:{
      variable_numbers:string[];
    }})=>[t.id,t.parameter_schema.variable_numbers])),
    knowledgeIds:(knowledge.data||[]).map((x:{id:string})=>x.id),
    dictionaryIds:(dictionaries.data||[]).map((x:{id:string})=>x.id),
  };
}
