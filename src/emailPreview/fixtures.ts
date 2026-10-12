import type { FirstContactInput } from '../mail/firstContactTemplates';

export interface FirstContactScenario {
  id: string;
  label: string;
  note: string;
  input: FirstContactInput;
}

const logoUrl = '/oryneo-wordmark-mono.png';

export const firstContactScenarios: FirstContactScenario[] = [
  {
    id: 'conversation-referrals',
    label: 'Conversa · Growth + LP + Tráfego',
    note: 'Indicações e parcerias · ciclo anual',
    input: { intent: 'conversation', firstName: 'Rafael', company: 'Empresa X', plan: 'Growth', cycle: 'annual', addOns: ['landing-page', 'traffic'], primaryGoal: 'Atrair contatos com páginas e anúncios', acquisitionChannel: 'Indicações e parcerias', logoUrl },
  },
  {
    id: 'contract-social',
    label: 'Contratação · Scale + LP + Tráfego',
    note: 'Instagram e Facebook · ciclo anual',
    input: { intent: 'contract', firstName: 'Marina', company: 'Lumina', plan: 'Scale', cycle: 'annual', addOns: ['landing-page', 'traffic'], primaryGoal: 'Organizar marketing e vendas em um fluxo único', acquisitionChannel: 'Instagram e Facebook', logoUrl },
  },
  {
    id: 'conversation-google',
    label: 'Conversa · Start',
    note: 'Google · ciclo mensal',
    input: { intent: 'conversation', firstName: 'Caio', company: 'Norte Consultoria', plan: 'Start', cycle: 'monthly', addOns: [], primaryGoal: 'Gerar oportunidades comerciais com previsibilidade', acquisitionChannel: 'Google', logoUrl },
  },
  {
    id: 'contract-outbound',
    label: 'Contratação · Growth + LP',
    note: 'Prospecção ativa · ciclo mensal',
    input: { intent: 'contract', firstName: 'Amanda', company: 'Vértice', plan: 'Growth', cycle: 'monthly', addOns: ['landing-page'], primaryGoal: 'Melhorar a conversão da prospecção', acquisitionChannel: 'Prospecção ativa', logoUrl },
  },
  {
    id: 'conversation-marketplaces',
    label: 'Conversa · Scale + Tráfego',
    note: 'Portais e marketplaces · ciclo anual',
    input: { intent: 'conversation', firstName: 'Felipe', company: 'Atlas Imóveis', plan: 'Scale', cycle: 'annual', addOns: ['traffic'], primaryGoal: 'Centralizar e priorizar novos contatos', acquisitionChannel: 'Portais e marketplaces', logoUrl },
  },
  {
    id: 'contract-offline',
    label: 'Contratação · Start',
    note: 'Loja física e eventos · ciclo anual',
    input: { intent: 'contract', firstName: 'Bianca', company: 'Casa Uno', plan: 'Start', cycle: 'annual', addOns: [], primaryGoal: 'Acompanhar melhor cada oportunidade', acquisitionChannel: 'Loja física e eventos', logoUrl },
  },
  {
    id: 'conversation-no-channel',
    label: 'Conversa · Growth + LP',
    note: 'Sem canal previsível · ciclo mensal',
    input: { intent: 'conversation', firstName: 'Lucas', company: 'Clínica Horizonte', plan: 'Growth', cycle: 'monthly', addOns: ['landing-page'], primaryGoal: 'Construir uma aquisição previsível', acquisitionChannel: 'Ainda não temos um canal previsível', logoUrl },
  },
  {
    id: 'contract-other',
    label: 'Contratação · Scale + Tráfego',
    note: 'Outro canal · ciclo mensal',
    input: { intent: 'contract', firstName: 'Renata', company: 'Mova Educação', plan: 'Scale', cycle: 'monthly', addOns: ['traffic'], primaryGoal: 'Ganhar clareza sobre o processo comercial', acquisitionChannel: 'Outro canal', logoUrl },
  },
];
