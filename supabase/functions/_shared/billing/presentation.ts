import type {buildBillingQuote} from './catalog.ts';

type Quote=ReturnType<typeof buildBillingQuote>;

export type ProposalPresentationItem={
 key:'platform'|'implementation'|'landing-page'|'traffic';
 eyebrow:string;
 title:string;
 summary:string;
 bullets:string[];
 commercial_detail:string;
};

export type ProposalPresentation={
 schema:'oryneo.proposal-presentation.v1';
 primary_goal:string;
 items:ProposalPresentationItem[];
 journey:Array<{key:'acceptance'|'payment'|'implementation'|'additional-services';title:string;description:string}>;
};

const clean=(value:unknown,max=180)=>String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const cycleLabel=(cycle:Quote['cycle'])=>cycle==='annual'?'Assinatura anual antecipada':'Assinatura mensal';

export function buildProposalPresentation(quote:Quote,primaryGoal?:string|null):ProposalPresentation{
 const goal=clean(primaryGoal);
 const selected=new Set(quote.items.map(item=>item.key));
 const items:ProposalPresentationItem[]=[
  {
   key:'platform',eyebrow:'PLATAFORMA CRM',title:`Plano ${quote.plan}`,
   summary:goal?`Estrutura para apoiar a prioridade informada: ${goal}.`:'Ambiente comercial para organizar oportunidades, contexto e próximos passos.',
   bullets:[
    'Pipeline comercial para organizar oportunidades por etapa.',
    'Ficha de cada oportunidade com histórico e próximo passo.',
    'Atividades e caixa de e-mail compartilhada no mesmo ambiente.',
    `Até ${quote.userLimit} usuários no plano contratado.`,
   ],
   commercial_detail:`${cycleLabel(quote.cycle)} · até ${quote.userLimit} usuários`,
  },
  {
   key:'implementation',eyebrow:'COLOCAÇÃO EM OPERAÇÃO',title:'Implantação',
   summary:'Preparação inicial do ambiente para a empresa começar a operar com a configuração contratada.',
   bullets:[
    'Configuração inicial do ambiente e do funil comercial.',
    'Preparação dos acessos previstos no plano.',
    'Orientação inicial para começar a operação.',
    'Início após pagamento confirmado e recebimento das informações necessárias.',
   ],
   commercial_detail:'Cobrança única',
  },
 ];
 if(selected.has('landing-page'))items.push({
  key:'landing-page',eyebrow:'PROJETO DIGITAL',title:'Landing page de conversão',
  summary:'Projeto individual com etapa de conferência antes da publicação final.',
  bullets:[
   'Projeto individual de landing page de conversão.',
   'Versão segura para revisão e aprovação.',
   'Publicação da versão aprovada em endereço verificado.',
   'Escopo final vinculado à versão aceita da proposta.',
  ],
  commercial_detail:'Projeto de cobrança única',
 });
 if(selected.has('traffic'))items.push({
  key:'traffic',eyebrow:'GESTÃO CONTÍNUA',title:'Gestão de tráfego pago',
  summary:'Ciclo inicial de gestão contratado por três meses, com renovação trimestral independente.',
  bullets:[
   'Período inicial de gestão correspondente a três meses.',
   'Renovação trimestral independente da assinatura do CRM.',
   'A verba de mídia é paga separadamente e não integra este valor.',
   'Canais e condições operacionais seguem o escopo validado com a empresa.',
  ],
  commercial_detail:'Primeiros 3 meses antecipados · renovação a cada 3 meses',
 });
 const hasAdditional=items.length>2;
 return{
  schema:'oryneo.proposal-presentation.v1',primary_goal:goal,items,
  journey:[
   {key:'acceptance',title:'Aceite desta versão',description:'Confirmação dos itens, valores e ciclos apresentados.'},
   {key:'payment',title:'Preparação do pagamento',description:'O link de pagamento é liberado após o aceite da proposta.'},
   {key:'implementation',title:'Início da implantação',description:'A equipe inicia a preparação após a confirmação do pagamento.'},
   ...(hasAdditional?[{key:'additional-services' as const,title:'Execução dos adicionais',description:'Cada serviço adicional segue seu próprio fluxo de preparação, revisão e entrega.'}]:[]),
  ],
 };
}
