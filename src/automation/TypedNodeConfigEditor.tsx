/**
 * Typed controls for the automation editor. No provider calls or effects.
 * Dynamic options come only from the authenticated canonical API catalog.
 */
import type { FlowNode } from './flowDefinition';
import { RULE_FIELDS } from './conditionRules';
import type { CatalogChoice, NodeReferenceCatalog } from './api';

type Props={
  node:FlowNode;
  catalog:NodeReferenceCatalog|null;
  onChange:(value:Record<string,unknown>)=>void;
};
export const EVENT_CHOICES:readonly string[]=[
  'opportunity.created','opportunity.updated','opportunity.stage_changed',
  'lead.intake_received','checkout.started','checkout.expired',
  'billing.paid_verified','billing.failed','conversation.inbound',
  'conversation.human_takeover','meeting.scheduled','proposal.sent',
  'onboarding.started','mail.sent',
] as const;
const txt=(x:unknown):string=>typeof x==='string'?x:'';
const num=(x:unknown,fallback:number):number=>typeof x==='number'&&Number.isFinite(x)?x:fallback;
export function TypedNodeConfigEditor({node,catalog,onChange}:Props){
  const cfg=node.config;
  const edit=(key:string,value:unknown)=>onChange({...cfg,[key]:value});
  const input=(key:string,title:string,max=160)=><label key={key}>{title}
    <input aria-label={title} type="text" value={txt(cfg[key])} maxLength={max}
      onChange={event=>edit(key,event.target.value)}/>
  </label>;
  const integer=(key:string,title:string,min:number,max:number,fallback:number)=><label key={key}>{title}
    <input aria-label={title} type="number" min={min} max={max}
      value={String(num(cfg[key],fallback))}
      onChange={event=>{
        const value=Number(event.target.value);
        if(event.target.value.trim()&&Number.isSafeInteger(value)&&value>=min&&value<=max)edit(key,value);
      }}/>
  </label>;
  const choice=(key:string,title:string,options:readonly string[])=><label key={key}>{title}
    <select aria-label={title} value={txt(cfg[key])}
      onChange={event=>edit(key,event.target.value)}>
      {!options.includes(txt(cfg[key]))&&<option value={txt(cfg[key])}>
        {txt(cfg[key])?'Valor não homologado':'Selecione'}</option>}
      {options.map(option=><option key={option} value={option}>{option}</option>)}
    </select>
  </label>;
  const reference=(key:string,title:string,items:readonly CatalogChoice[]|undefined)=><label key={key}>{title}
    <select aria-label={title} value={txt(cfg[key])} disabled={!items}
      onChange={event=>edit(key,event.target.value)}>
      <option value="">Selecione uma referência homologada</option>
      {txt(cfg[key])&&!items?.some(item=>item.id===cfg[key])&&
        <option value={txt(cfg[key])}>Referência não homologada</option>}
      {(items||[]).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {items?.length===0&&<small>Nenhuma referência publicada e habilitada neste workspace.</small>}
  </label>;
  const boolean=(key:string,title:string)=><label key={key} className="ory-auto-toggle">
    <input aria-label={title} type="checkbox" checked={cfg[key]===true}
      onChange={event=>edit(key,event.target.checked)}/>
    <span>{title}</span>
  </label>;

  const approvedTemplateFields=[
    'conversation.customer_name','opportunity.title','opportunity.source',
    'opportunity.plan','opportunity.cycle','opportunity.next_action.title','opportunity.priority',
    'meeting.date','meeting.time','meeting.format',
    'billing.company',
  ];
  const template=catalog?.templates.find(t=>t.id===cfg.template_registry_id);
  const variables=Array.isArray(template?.variable_numbers)
    ?template.variable_numbers:[];
  const bindings=(cfg.bindings&&typeof cfg.bindings==='object'&&
    !Array.isArray(cfg.bindings))?cfg.bindings as Record<string,unknown>:{};

  switch(node.type){
    case 'trigger':return <div className="ory-auto-typed-config">
      {choice('event_type','Evento canônico',EVENT_CHOICES)}
      <small>A origem e a autorização do evento serão verificadas pelo servidor.</small>
    </div>;
    case 'intent_classifier':return <div className="ory-auto-typed-config">
      {reference('dictionary_release_id','Versão publicada do dicionário',catalog?.dictionaries)}
      <label>Confiança mínima
        <input aria-label="Confiança mínima" type="number" min="0.5" max="0.99" step="0.01"
          value={String(num(cfg.min_confidence,0.8))}
          onChange={event=>{const value=Number(event.target.value);
            if(value>=0.5&&value<=0.99)edit('min_confidence',value);}}/>
      </label>
    </div>;
    case 'knowledge_lookup':return <div className="ory-auto-typed-config">
      {reference('knowledge_release_id','Conhecimento aprovado',catalog?.knowledge)}
      {choice('question_field','Campo consultado',RULE_FIELDS)}
    </div>;
    case 'ai_generate':return <div className="ory-auto-typed-config">
      {input('prompt_ref','Referência do prompt aprovado',256)}
      {integer('max_tokens','Limite de saída em tokens',64,1200,400)}
      <small>O servidor deve comprovar o prompt e os guardrails. Sem isso, a publicação é bloqueada.</small>
    </div>;
    case 'whatsapp_template':return <div className="ory-auto-typed-config">
      {reference('template_registry_id','Template aprovado com componentes verificados',catalog?.templates)}
      {choice('locale','Idioma',['pt_BR'])}
      {variables.map(index=><label key={index}>
        {'Variável oficial {{'+index+'}}'}
        <select aria-label={'Origem da variável '+index}
          value={txt(bindings[index])}
          onChange={event=>edit('bindings',{...bindings,[index]:event.target.value})}>
          <option value="">Selecione um campo canônico</option>
          {approvedTemplateFields.map(field=><option key={field} value={field}>{field}</option>)}
        </select>
      </label>)}
      {template&&variables.length===0&&<small>Nenhum parâmetro posicional validado pelo catálogo. A publicação permanece bloqueada até a verificação.</small>}
      <small>O servidor exige a origem explícita de cada variável. Não são criados valores presumidos.</small>
    </div>;
    case 'whatsapp_reply':return <div className="ory-auto-typed-config">
      {input('text_ref','Referência do texto aprovado',256)}
      <small>Envios livres exigem janela válida e revisão do adaptador antes da ativação.</small>
    </div>;
    case 'email':return <div className="ory-auto-typed-config">
      {input('template_id','Identificador do template de e-mail',36)}
      {choice('recipient_field','Origem do destinatário',['lead.email','opportunity.email'])}
      <small>Somente templates registrados no backend poderão ser publicados.</small>
    </div>;
    case 'crm_stage_change':return <div className="ory-auto-typed-config">
      {reference('target_stage_id','Etapa comercial de destino',catalog?.stages)}
      <small>A verificação de pagamento e os marcos comerciais são regras do servidor.</small>
    </div>;
    case 'crm_task':return <div className="ory-auto-typed-config">
      {input('title','Título da tarefa',160)}
      {integer('due_offset_minutes','Prazo após o evento (minutos)',1,43200,60)}
    </div>;
    case 'crm_update':return <div className="ory-auto-typed-config">
      {choice('allowed_field','Campo autorizado',['next_action.title','due_date','notes'])}
      {input('value_ref','Origem do valor autorizado',256)}
    </div>;
    case 'billing_read':return <p className="ory-auto-typed-info">
      Somente leitura do estado financeiro canônico. A configuração não permite alterar pagamentos.
    </p>;
    case 'wait':return <div className="ory-auto-typed-config">
      {integer('duration_minutes','Tempo de espera (minutos)',1,43200,60)}
      {boolean('cancel_on_reply','Cancelar espera quando houver resposta')}
      <small>Espera durável somente após implantação do scheduler e homologação de cancelamento.</small>
    </div>;
    case 'human_handoff':return <div className="ory-auto-typed-config">
      {input('reason_code','Código do motivo de transferência',64)}
    </div>;
    case 'notify':return <div className="ory-auto-typed-config">
      {input('event_code','Código de notificação interna',64)}
    </div>;
    case 'stop':
    case 'end':return <p className="ory-auto-typed-info">Bloco terminal sem parâmetros.</p>;
    case 'condition':return null; // Dedicated nested rule form.
    default:return <p className="ory-auto-typed-info">Tipo de nó não configurável.</p>;
  }
}
