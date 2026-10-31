/**
 * An operator selects a strictly hypothetical and non-identifying scenario.
 * No real CRM, WhatsApp, Stripe or Meta data is fetched or stored.
 */
export const SIMULATION_CASES = [
  {id:'unknown',title:'Sem dados — bloquear com segurança',
   description:'Mostra como condições não verificadas são interrompidas.'},
  {id:'sdr_active',title:'Atendimento SDR permitido (fictício)',
   description:'Conversa automatizada e consentimento hipotético; não autoriza envio.'},
  {id:'human_locked',title:'Atendente assumiu a conversa (fictício)',
   description:'Conversa protegida contra respostas automáticas.'},
  {id:'payment_pending',title:'Pagamento ainda pendente (fictício)',
   description:'Checkout iniciado sem comprovação de pagamento.'},
  {id:'payment_verified',title:'Webhook de pagamento válido (somente hipótese)',
   description:'Simula true/false no grafo sem criar ou verificar pagamento real.'},
  {id:'opportunity_present',title:'Oportunidade com etapa (fictícia)',
   description:'Verifica a presença de uma etapa sem usar dados de clientes.'},
] as const;
export type SimulationCaseId=typeof SIMULATION_CASES[number]['id'];
export function buildSimulationCase(id:SimulationCaseId):Record<string,unknown>{
 switch(id){
  case 'unknown':return {};
  case 'sdr_active':return {conversation:{mode:'sdr_active',
    opted_out:false,consent_granted:true}};
  case 'human_locked':return {conversation:{mode:'human_locked',
    opted_out:true,consent_granted:false}};
  case 'payment_pending':return {billing:{status:'pending',paid_verified:false}};
  case 'payment_verified':return {billing:{status:'paid',paid_verified:true}};
  case 'opportunity_present':return {opportunity:{stage_id:'hypothetical-stage'}};
  default:throw Error('UNKNOWN_SIMULATION_CASE');
 }
}
