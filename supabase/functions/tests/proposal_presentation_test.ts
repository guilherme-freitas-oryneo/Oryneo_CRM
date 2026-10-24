import {assert,assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {buildBillingQuote} from '../_shared/billing/catalog.ts';
import {buildProposalPresentation} from '../_shared/billing/presentation.ts';

Deno.test('apresentação materializa plano, implantação e somente os adicionais contratados',()=>{
 const quote=buildBillingQuote({plan:'Growth',cycle:'monthly',addons:['landing-page']});
 const presentation=buildProposalPresentation(quote,'Organizar contatos e negociações no CRM');
 assertEquals(presentation.schema,'oryneo.proposal-presentation.v1');
 assertEquals(presentation.primary_goal,'Organizar contatos e negociações no CRM');
 assertEquals(presentation.items.map(item=>item.key),['platform','implementation','landing-page']);
 assert(presentation.items[0].bullets.includes('Até 10 usuários no plano contratado.'));
 assert(presentation.items[0].summary.includes('Organizar contatos e negociações no CRM'));
 assert(presentation.items[2].bullets.includes('Versão segura para revisão e aprovação.'));
 assert(!JSON.stringify(presentation).includes('Gestão de tráfego'));
});

Deno.test('apresentação de tráfego informa período, renovação e verba de mídia sem prometer resultado',()=>{
 const quote=buildBillingQuote({plan:'Scale',cycle:'annual',addons:['traffic']});
 const presentation=buildProposalPresentation(quote,'Atrair contatos com páginas e anúncios');
 const traffic=presentation.items.find(item=>item.key==='traffic');
 assert(traffic);
 assertEquals(traffic.commercial_detail,'Primeiros 3 meses antecipados · renovação a cada 3 meses');
 assert(traffic.bullets.includes('A verba de mídia é paga separadamente e não integra este valor.'));
 assert(!JSON.stringify(traffic).match(/garantia|resultado garantido|leads garantidos/i));
});

Deno.test('apresentação funciona sem prioridade informada e limita texto livre',()=>{
 const quote=buildBillingQuote({plan:'Start',cycle:'monthly',addons:[]});
 const presentation=buildProposalPresentation(quote,' X '.repeat(300));
 assertEquals(presentation.primary_goal.length,180);
 assertEquals(presentation.items.length,2);
 assert(!presentation.items[0].summary.includes('undefined'));
});
