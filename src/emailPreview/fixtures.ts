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
    note: '3 canais · principal: Indicações e parcerias · ciclo anual',
    input: { intent: 'conversation', firstName: 'Rafael', company: 'Empresa X', plan: 'Growth', cycle: 'annual', addOns: ['landing-page', 'traffic'], goals: ['Atrair contatos com páginas e anúncios', 'Organizar contatos e negociações no CRM'], primaryGoal: 'Atrair contatos com páginas e anúncios', acquisitionChannels: ['Indicações e parcerias', 'Instagram e Facebook', 'Google'], primaryAcquisitionChannel: 'Indicações e parcerias', logoUrl },
  },
  {
    id: 'contract-social',
    label: 'Contratação · Scale + LP + Tráfego',
    note: 'Instagram e Facebook · ciclo anual',
    input: { intent: 'contract', firstName: 'Marina', company: 'Lumina', plan: 'Scale', cycle: 'annual', addOns: ['landing-page', 'traffic'], goals: ['Organizar marketing e vendas em um fluxo único'], primaryGoal: 'Organizar marketing e vendas em um fluxo único', acquisitionChannels: ['Instagram e Facebook'], primaryAcquisitionChannel: 'Instagram e Facebook', logoUrl },
  },
  {
    id: 'conversation-google',
    label: 'Conversa · Start',
    note: '4 frentes · principal: Google · ciclo mensal',
    input: { intent: 'conversation', firstName: 'Caio', company: 'Norte Consultoria', plan: 'Start', cycle: 'monthly', addOns: [], goals: ['Gerar oportunidades comerciais com previsibilidade'], primaryGoal: 'Gerar oportunidades comerciais com previsibilidade', acquisitionChannels: ['Indicações e parcerias', 'Instagram e Facebook', 'Google', 'Prospecção ativa'], primaryAcquisitionChannel: 'Google', logoUrl },
  },
  {
    id: 'contract-outbound',
    label: 'Contratação · Growth + LP',
    note: '2 canais · principal: Prospecção ativa · ciclo mensal',
    input: { intent: 'contract', firstName: 'Amanda', company: 'Vértice', plan: 'Growth', cycle: 'monthly', addOns: ['landing-page'], goals: ['Melhorar a conversão da prospecção'], primaryGoal: 'Melhorar a conversão da prospecção', acquisitionChannels: ['Prospecção ativa', 'Indicações e parcerias'], primaryAcquisitionChannel: 'Prospecção ativa', logoUrl },
  },
  {
    id: 'conversation-marketplaces',
    label: 'Conversa · Scale + Tráfego',
    note: 'Portais e marketplaces · ciclo anual',
    input: { intent: 'conversation', firstName: 'Felipe', company: 'Atlas Imóveis', plan: 'Scale', cycle: 'annual', addOns: ['traffic'], goals: ['Centralizar e priorizar novos contatos'], primaryGoal: 'Centralizar e priorizar novos contatos', acquisitionChannels: ['Portais e marketplaces'], primaryAcquisitionChannel: 'Portais e marketplaces', logoUrl },
  },
  {
    id: 'contract-offline',
    label: 'Contratação · Start',
    note: 'Loja física e eventos · ciclo anual',
    input: { intent: 'contract', firstName: 'Bianca', company: 'Casa Uno', plan: 'Start', cycle: 'annual', addOns: [], goals: ['Acompanhar melhor cada oportunidade'], primaryGoal: 'Acompanhar melhor cada oportunidade', acquisitionChannels: ['Loja física e eventos'], primaryAcquisitionChannel: 'Loja física e eventos', logoUrl },
  },
  {
    id: 'conversation-no-channel',
    label: 'Conversa · Growth + LP',
    note: 'Sem canal previsível · ciclo mensal',
    input: { intent: 'conversation', firstName: 'Lucas', company: 'Clínica Horizonte', plan: 'Growth', cycle: 'monthly', addOns: ['landing-page'], goals: ['Construir uma aquisição previsível'], primaryGoal: 'Construir uma aquisição previsível', acquisitionChannels: ['Ainda não temos um canal previsível'], primaryAcquisitionChannel: 'Ainda não temos um canal previsível', logoUrl },
  },
  {
    id: 'contract-other',
    label: 'Contratação · Scale + Tráfego',
    note: '3 canais · principal: Outro canal · ciclo mensal',
    input: { intent: 'contract', firstName: 'Renata', company: 'Mova Educação', plan: 'Scale', cycle: 'monthly', addOns: ['traffic'], goals: ['Ganhar clareza sobre o processo comercial'], primaryGoal: 'Ganhar clareza sobre o processo comercial', acquisitionChannels: ['Outro canal', 'Instagram e Facebook', 'Google'], primaryAcquisitionChannel: 'Outro canal', logoUrl },
  },
];
