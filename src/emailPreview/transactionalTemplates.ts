/**
 * ORYNEO · Biblioteca visual transacional
 *
 * MODELOS DE APRESENTAÇÃO (não são gatilhos de envio).
 * Dados financeiros reais devem vir do pedido/fatura verificados no servidor.
 * Links de identidade devem vir do Supabase Auth; nunca gerar tokens aqui.
 */
export type TransactionalId =
 | 'confirm_email' | 'reset_password' | 'invite_user' | 'password_changed' | 'email_changed'
 | 'payment_pending' | 'payment_failed' | 'checkout_expired'
 | 'renewal_paid' | 'renewal_failed' | 'subscription_canceled' | 'refund_confirmed'
 | 'request_received' | 'proposal_sent' | 'payment_link' | 'implementation_started';

export type TemplateKind = 'auth' | 'finance' | 'security';

export type TransactionalInput = {
 firstName:string;
 company:string;
 email:string;
 newEmail?:string;
 plan?:string;
 cycle?:string;
 orderReference?:string;
 amountCents?:number;
 renewalAmountCents?:number;
 deadline?:string;
 maskedPaymentMethod?:string;
 actionUrl?:string;
 whatsappUrl?:string;
 supportEmail?:string;
};

export type RenderedTransactionalEmail = {
 subject:string;
 preheader:string;
 text:string;
 html:string;
};
type TemplateDefinition = {
 id:TransactionalId; category:TemplateKind; label:string; description:string;
 subject:(d:TransactionalInput)=>string;
 preheader:string; eyebrow:string; headline:string;
 paragraphs:(d:TransactionalInput)=>string[];
 details?:(d:TransactionalInput)=>Array<[string,string]>;
 cta?:string;
 whatsappLabel?:string;
 footnote?:string;
};

const trim=(v:unknown,max=180)=>String(v??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const money=(cents=0)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const client=(d:TransactionalInput)=>trim(d.firstName,60)||'cliente';
const company=(d:TransactionalInput)=>trim(d.company,120)||'sua empresa';
const order=(d:TransactionalInput)=>trim(d.orderReference,80)||'—';
const plan=(d:TransactionalInput)=>trim(d.plan,35)||'ORYNEO';
const help=(d:TransactionalInput)=>trim(d.supportEmail,120)||'contato@oryneo.com.br';
const price=(d:TransactionalInput)=>money(d.amountCents);
const defaultDetails=(d:TransactionalInput)=>[['Empresa',company(d)],['Referência',order(d)]] as Array<[string,string]>;

export const transactionDefinitions:TemplateDefinition[]=[
 {
  id:'confirm_email',category:'auth',label:'Confirmar e-mail',description:'Ativação · confirmação do endereço após aprovação da conta',
  subject:()=> 'Confirme seu e-mail para ativar o acesso à ORYNEO',
  preheader:'Uma etapa de segurança antes de criar sua senha.',eyebrow:'CONFIRMAÇÃO DE IDENTIDADE',
  headline:'Confirme que este e-mail é seu.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'Estamos preparando seu acesso à ORYNEO. Para proteger sua conta, precisamos confirmar que este endereço de e-mail pertence a você.',
   'Depois da confirmação, você poderá definir sua senha e acessar o CRM quando sua empresa estiver habilitada.',
  ],
  cta:'Confirmar meu e-mail',
  footnote:'Se você não solicitou esse acesso, ignore esta mensagem. O link tem uso único e validade limitada.'
 },
 {
  id:'reset_password',category:'auth',label:'Redefinir senha',description:'Recuperação de acesso por link individual e temporário',
  subject:()=> 'Redefina sua senha de acesso à ORYNEO',
  preheader:'Recebemos uma solicitação de recuperação da sua conta.',eyebrow:'SEGURANÇA DA CONTA',
  headline:'Recupere seu acesso com segurança.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'Recebemos uma solicitação para alterar a senha associada a '+trim(d.email,140)+'.',
   'Use o botão abaixo para criar uma nova senha. Depois disso, volte à tela de login para entrar normalmente.',
  ],
  cta:'Criar nova senha',
  footnote:'Não solicitou a alteração? Ignore este e-mail. Sua senha atual permanece válida até que a redefinição seja concluída.'
 },
 {
  id:'invite_user',category:'auth',label:'Convite de colaborador',description:'Convite de acesso enviado por administrador autorizado',
  subject:d=> 'Convite para participar do CRM da '+company(d),
  preheader:'Você recebeu um convite para participar de um workspace ORYNEO.',
  eyebrow:'CONVITE DE ACESSO',headline:'Seu lugar na equipe está preparado.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'Você recebeu um convite para acessar o CRM utilizado pela '+company(d)+'.',
   'Confirme o convite e defina sua senha para começar. A disponibilidade de funcionalidades depende das permissões concedidas pela empresa.',
  ],
  cta:'Aceitar convite',footnote:'Não reconhece o convite? Ignore esta mensagem ou fale com a equipe da sua empresa.'
 },
 {
  id:'password_changed',category:'security',label:'Senha alterada',description:'Alerta de segurança após mudança efetiva',
  subject:()=> 'Sua senha da ORYNEO foi alterada',
  preheader:'Confira uma alteração recente de segurança na sua conta.',
  eyebrow:'AVISO DE SEGURANÇA',headline:'Sua senha foi atualizada.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'A senha da conta '+trim(d.email,140)+' foi alterada com sucesso.',
   'Se foi você, nenhuma ação é necessária. Se não reconhece essa alteração, recupere o acesso e entre em contato imediatamente com nosso suporte.',
  ],
  cta:'Revisar meu acesso',
  footnote:'Por segurança, a ORYNEO nunca pede a sua senha ou os dados completos do seu cartão por e-mail.'
 },
 {
  id:'email_changed',category:'security',label:'E-mail alterado',description:'Aviso após troca confirmada de endereço',
  subject:()=> 'Seu e-mail de acesso à ORYNEO foi atualizado',
  preheader:'Uma informação de acesso à sua conta foi alterada.',
  eyebrow:'AVISO DE SEGURANÇA',headline:'Seu endereço de acesso mudou.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'O endereço de e-mail associado à sua conta ORYNEO foi alterado.',
   'Novo endereço: '+trim(d.newEmail||'—',140)+'.',
   'Se você não reconhece essa alteração, informe imediatamente nosso suporte.',
  ],
  cta:'Falar com suporte',
  footnote:'Esta notificação é informativa. Nunca compartilhe sua senha ou códigos de segurança.'
 },
 {
  id:'payment_pending',category:'finance',label:'Pagamento em análise',description:'Pagamento iniciado com confirmação ainda pendente',
  subject:d=> 'Seu pagamento está em confirmação · '+order(d),
  preheader:'Recebemos a tentativa de pagamento; aguardamos confirmação do processador.',
  eyebrow:'PAGAMENTO EM CONFIRMAÇÃO',headline:'Seu pedido está em processamento.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'Identificamos a tentativa de pagamento da contratação ORYNEO para '+company(d)+'.',
   'O pagamento ainda não foi confirmado. Avisaremos quando a operação estiver concluída. Nenhum acesso é liberado antecipadamente.',
  ],
  details:d=>[...defaultDetails(d),['Valor do pedido',price(d)]],
  footnote:'Não realize um novo pagamento antes de conferir a situação do pedido, para evitar duplicidades.'
 },
 {
  id:'payment_failed',category:'finance',label:'Pagamento não aprovado',description:'Recusa ou falha confirmada da primeira tentativa',
  subject:d=> 'Não foi possível confirmar seu pagamento · '+order(d),
  preheader:'Seu pedido precisa de uma nova tentativa de pagamento.',
  eyebrow:'PAGAMENTO NÃO CONCLUÍDO',headline:'A contratação ainda não foi concluída.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'A tentativa de pagamento da ORYNEO para '+company(d)+' não foi aprovada.',
   'Se desejar continuar com a contratação, utilize o link atualizado disponibilizado pela equipe. Não é necessário compartilhar dados de cartão conosco.',
  ],
  details:d=>[...defaultDetails(d),['Valor do pedido',price(d)]],
  cta:'Revisar pagamento',footnote:'Acesso ao CRM somente após pagamento confirmado e ativação da conta.'
 },
 {
  id:'checkout_expired',category:'finance',label:'Link de pagamento expirado',description:'Sessão de pagamento encerrada sem conclusão',
  subject:d=> 'Seu link de pagamento expirou · '+order(d),
  preheader:'O prazo para concluir o pagamento terminou.',
  eyebrow:'PRAZO ENCERRADO',headline:'O link anterior não está mais disponível.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'O prazo do link para concluir a contratação da '+company(d)+' terminou sem confirmação de pagamento.',
   'Para continuar, solicite um novo link. Os valores e as condições serão apresentados novamente para sua conferência.',
  ],
  details:d=>defaultDetails(d),cta:'Solicitar novo link',
  footnote:'Não reutilize links expirados. Nossa equipe nunca solicita dados completos de cartão por e-mail.'
 },
 {
  id:'renewal_paid',category:'finance',label:'Renovação confirmada',description:'Fatura recorrente efetivamente liquidada',
  subject:d=> 'Renovação confirmada · '+order(d),
  preheader:'O pagamento do novo período foi confirmado.',
  eyebrow:'RENOVAÇÃO CONFIRMADA',headline:'Seu próximo ciclo foi confirmado.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'Confirmamos o pagamento de renovação dos serviços ORYNEO contratados pela '+company(d)+'.',
   'Seu histórico financeiro permanece disponível para conferência. As condições do serviço seguem o contrato vigente.',
  ],
  details:d=>[...defaultDetails(d),['Valor da renovação',money(d.renewalAmountCents??d.amountCents)]],
  footnote:'Este e-mail é uma confirmação de pagamento; não substitui documento fiscal.'
 },
 {
  id:'renewal_failed',category:'finance',label:'Falha na renovação',description:'Fatura recorrente com tentativa de cobrança não aprovada',
  subject:d=> 'Ação necessária: pagamento da renovação · '+order(d),
  preheader:'Precisamos regularizar o pagamento de um novo período.',
  eyebrow:'PAGAMENTO NÃO APROVADO',headline:'Precisamos regularizar sua renovação.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'Não conseguimos confirmar o pagamento da renovação dos serviços ORYNEO da '+company(d)+'.',
   'Consulte a cobrança pelo canal seguro fornecido pela ORYNEO. A continuidade dos serviços seguirá as condições contratuais aplicáveis.',
  ],
  details:d=>[...defaultDetails(d),['Valor em aberto',money(d.renewalAmountCents??d.amountCents)]],
  cta:'Consultar cobrança',
  footnote:'Por segurança, não informe dados completos de cartão por resposta a este e-mail.'
 },
 {
  id:'subscription_canceled',category:'finance',label:'Cancelamento confirmado',description:'Encerramento efetivamente registrado da assinatura',
  subject:d=> 'Cancelamento confirmado · '+order(d),
  preheader:'Registramos o cancelamento da assinatura.',
  eyebrow:'ASSINATURA CANCELADA',headline:'Seu cancelamento foi registrado.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'A assinatura ORYNEO vinculada à '+company(d)+' foi cancelada, conforme a solicitação e as condições aplicáveis.',
   'A confirmação de cancelamento não significa necessariamente reembolso nem encerramento imediato de todos os serviços complementares. Nossa equipe poderá esclarecer os efeitos previstos em contrato.',
  ],
  details:d=>defaultDetails(d),
  footnote:'Se você não reconhece esse cancelamento, responda imediatamente a esta mensagem.'
 },
 {
  id:'refund_confirmed',category:'finance',label:'Estorno ou reembolso',description:'Reembolso efetivamente confirmado no processador',
  subject:d=> 'Reembolso confirmado · '+order(d),
  preheader:'O reembolso solicitado foi confirmado.',
  eyebrow:'REEMBOLSO CONFIRMADO',headline:'Seu reembolso foi processado.',
  paragraphs:d=>[
   'Olá, '+client(d)+'.',
   'Confirmamos o processamento do reembolso relacionado à contratação ORYNEO da '+company(d)+'.',
   'A visualização do crédito dependerá do prazo da instituição financeira e do meio de pagamento original.',
  ],
  details:d=>[...defaultDetails(d),['Valor reembolsado',price(d)]],
  footnote:'Este aviso é enviado somente após a confirmação efetiva do reembolso no provedor de pagamento.'
 },

 {
  id:'request_received',category:'auth',label:'Solicitação recebida',description:'Recebimento confirmado de uma solicitação comercial',
  subject:()=> 'Recebemos sua solicitação · ORYNEO', preheader:'Sua solicitação foi registrada e a equipe já pode seguir com o próximo passo.',
  eyebrow:'SOLICITAÇÃO RECEBIDA',headline:'Sua solicitação chegou até nós.',
  paragraphs:d=>['Olá, '+client(d)+'.','Recebemos a solicitação da '+company(d)+' e ela foi registrada para análise da equipe ORYNEO.','Se precisar complementar alguma informação, use o WhatsApp oficial abaixo.'],
  whatsappLabel:'FALAR NO WHATSAPP', footnote:'A ORYNEO nunca solicita senha ou dados completos de cartão por e-mail.'
 },
 {
  id:'proposal_sent',category:'finance',label:'Proposta comercial enviada',description:'Proposta comercial disponibilizada para revisão',
  subject:d=> 'Sua proposta ORYNEO está pronta · '+order(d), preheader:'Revise a proposta e fale com a equipe se quiser ajustar algum ponto.',
  eyebrow:'PROPOSTA COMERCIAL',headline:'Sua proposta está pronta para revisão.',
  paragraphs:d=>['Olá, '+client(d)+'.','A proposta para '+company(d)+' está disponível para sua conferência.','Use o botão principal para abrir a proposta. Se quiser ajustar algum ponto, fale diretamente com a equipe no WhatsApp.'],
  details:d=>defaultDetails(d), cta:'Ver proposta', whatsappLabel:'AJUSTAR A PROPOSTA? FALE NO WHATSAPP', footnote:'A proposta válida é sempre a versão apresentada no link seguro fornecido pela ORYNEO.'
 },
 {
  id:'payment_link',category:'finance',label:'Link de pagamento',description:'Link seguro de pagamento disponibilizado para revisão',
  subject:d=> 'Seu link seguro de pagamento · '+order(d), preheader:'Revise o pedido e conclua o pagamento no ambiente seguro.',
  eyebrow:'PAGAMENTO',headline:'Seu pedido está pronto para pagamento.',
  paragraphs:d=>['Olá, '+client(d)+'.','O pedido da '+company(d)+' está pronto para revisão e pagamento.','Use o botão principal para acessar o ambiente seguro. Nunca envie dados completos do cartão por e-mail.'],
  details:d=>[...defaultDetails(d),['Valor do pedido',price(d)]], cta:'Revisar pedido e pagar', whatsappLabel:'FALAR COM O FINANCEIRO NO WHATSAPP', footnote:'Confirme o domínio antes de inserir qualquer dado de pagamento.'
 },
 {
  id:'implementation_started',category:'auth',label:'Implantação iniciada',description:'Início confirmado da etapa de implantação',
  subject:()=> 'Implantação iniciada · ORYNEO', preheader:'A equipe de implantação já iniciou os próximos passos.',
  eyebrow:'IMPLANTAÇÃO INICIADA',headline:'Vamos colocar o plano em operação.',
  paragraphs:d=>['Olá, '+client(d)+'.','A implantação da '+company(d)+' foi iniciada e a equipe responsável seguirá com os próximos passos combinados.','Para falar diretamente com a implantação, use o WhatsApp oficial abaixo.'],
  whatsappLabel:'FALAR COM A IMPLANTAÇÃO NO WHATSAPP', footnote:'A equipe ORYNEO confirmará por canais oficiais qualquer solicitação adicional.'
 },
];

export const transactionScenarios=transactionDefinitions.map(def=>({
 id:def.id,label:def.label,note:def.description,category:def.category,
}));

export function renderTransactionalEmail(id:TransactionalId,input:TransactionalInput):RenderedTransactionalEmail{
 const def=transactionDefinitions.find(item=>item.id===id);
 if(!def)throw Error('UNKNOWN_ORyNEO_EMAIL_TEMPLATE');
 const subject=trim(def.subject(input),170);
 const preheader=trim(def.preheader,210);
 const paragraphs=def.paragraphs(input).map(p=>trim(p,900));
 const details=def.details?.(input)||[];
 const target=trim(input.actionUrl,2000);
 // CTA only when a trusted server-provided URL is available; no invented token or payment link.
 const hasCta=Boolean(def.cta && /^(https:\/\/[^<>"'\s]+|mailto:[^\s<>"']+)$/i.test(target));
 const whatsapp=trim(input.whatsappUrl,2000);
 const hasWhatsapp=Boolean(def.whatsappLabel && /^https:\/\/wa\.me\/[0-9]+(?:\?[^<>"'\s]+)?$/i.test(whatsapp));
 const isAuth=def.category==='auth'||def.category==='security';
 const notice=isAuth?'Se não reconhece esta operação, ignore a mensagem ou entre em contato com o suporte.':
    'Esta é uma comunicação transacional referente à sua relação com a ORYNEO.';
 const copy=paragraphs.join('\n\n');
 const detailText=details.map(([k,v])=>k+': '+trim(v,240)).join('\n');
 const text=[copy,detailText,hasCta?(def.cta+': '+target):'',hasWhatsapp?(def.whatsappLabel+': '+whatsapp):'',
   def.footnote||'', 'Dúvidas? '+help(input),'Equipe ORYNEO · Crescimento em sistema.']
   .filter(Boolean).join('\n\n');
 const rows=details.length?'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:28px 0;border-top:1px solid #e6e9ef">'+
  details.map(([key,val])=>'<tr><td style="padding:13px 8px 13px 0;color:#687383;font-size:13px;border-bottom:1px solid #e6e9ef">'+escapeHtml(key)+'</td>'+
     '<td align="right" style="padding:13px 0 13px 8px;color:#0F1115;font-size:13px;font-weight:700;border-bottom:1px solid #e6e9ef">'+escapeHtml(val)+'</td></tr>').join('')+'</table>':'';
 const action=hasCta?'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td style="background:#4357E8;border-radius:8px">'+
  '<a href="'+escapeHtml(target)+'" style="display:inline-block;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;padding:15px 24px;border-radius:8px">'+escapeHtml(def.cta)+'</a></td></tr></table>'+
  '<p style="font-size:12px;line-height:1.6;overflow-wrap:anywhere;color:#828b9a;margin:0 0 20px">Se o botão não funcionar, copie este endereço no navegador: '+escapeHtml(target)+'</p>':'';
 const whatsappAction=hasWhatsapp?'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 28px"><tr><td style="border:1px solid #25D366;border-radius:8px"><a href="'+escapeHtml(whatsapp)+'" style="display:inline-block;color:#128C4A;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:13px 20px;border-radius:8px">'+escapeHtml(def.whatsappLabel||'Falar no WhatsApp')+'</a></td></tr></table>':'';
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
  escapeHtml(subject)+'</title><style>@media(max-width:600px){.ory-pad{padding:28px 23px!important}.ory-h1{font-size:27px!important}.ory-outer{padding:12px!important}}</style></head>'+
  '<body style="margin:0;padding:0;background:#F8F7F4;color:#172133;font-family:Arial,Helvetica,sans-serif">'+
  '<div style="display:none;opacity:0;max-height:0;overflow:hidden">'+escapeHtml(preheader)+'</div>'+
  '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F8F7F4"><tr><td class="ory-outer" align="center" style="padding:40px 16px">'+
  '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e9ebf0;border-collapse:separate;border-spacing:0">'+
  '<tr><td class="ory-pad" style="padding:33px 42px 25px;background:#0F1115;color:#fff">'+
  '<table role="presentation" width="100%"><tr><td><img src="https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono-reverse.png" width="172" height="32" alt="ORYNEO" style="display:block;width:172px;max-width:100%;height:auto;border:0"></td>'+
  '<td align="right" style="font-size:10px;color:#b5bdcc;letter-spacing:1.6px">CRESCIMENTO EM SISTEMA</td></tr></table></td></tr>'+
  '<tr><td class="ory-pad" style="padding:37px 42px 39px">'+
  '<p style="font-size:11px;color:#4357E8;letter-spacing:1.6px;font-weight:bold;margin:0 0 15px">'+escapeHtml(def.eyebrow)+'</p>'+
  '<h1 class="ory-h1" style="font-size:32px;font-weight:700;letter-spacing:-1.2px;line-height:1.18;color:#0F1115;margin:0 0 23px">'+escapeHtml(def.headline)+'</h1>'+
  paragraphs.map(p=>'<p style="font-size:15px;line-height:1.77;color:#6B7280;margin:0 0 17px">'+escapeHtml(p)+'</p>').join('')+
  rows+action+whatsappAction+
  (def.footnote?'<p style="padding:15px 17px;border-left:3px solid #4F6BFF;background:#F1F3FF;color:#5d657a;font-size:12px;line-height:1.7;margin:27px 0">'+escapeHtml(def.footnote)+'</p>':'')+
  '<p style="font-size:13px;color:#5d6676;line-height:1.8;margin:30px 0 0">Dúvidas? Responda este e-mail ou escreva para <a style="color:#4357E8" href="mailto:'+escapeHtml(help(input))+'">'+escapeHtml(help(input))+'</a>.<br>'+
  '<strong style="color:#0F1115">Equipe ORYNEO</strong></p>'+
  '</td></tr><tr><td class="ory-pad" style="padding:20px 42px;background:#f9fafb;border-top:1px solid #e9ebf0;color:#8992a0;font-size:11px;line-height:1.7">'+
  escapeHtml(notice)+'<br>ORYNEO · Marketing, vendas e tecnologia.</td></tr></table>'+
  '</td></tr></table></body></html>';
 return {subject,preheader,text,html};
}
