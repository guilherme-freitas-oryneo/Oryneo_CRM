import { RULE_FIELDS, validateRule, type Rule, type FieldName, type Scalar } from './conditionRules';

type Props = { value: unknown; onChange: (next: Rule) => void };
type Change = (path: number[], next: Rule | null) => void;
const makeComparison = (): Rule => ({
  kind: 'compare',field: 'opportunity.intent',op: 'eq',value: 'conversation',
});
const labels: Record<FieldName,string> = {
  'opportunity.intent':'Intenção da oportunidade',
  'opportunity.stage_id':'Etapa comercial',
  'opportunity.source':'Origem do lead',
  'opportunity.plan':'Plano selecionado',
  'opportunity.cycle':'Ciclo de contratação',
  'conversation.mode':'Modo do atendimento',
  'conversation.opted_out':'Opt-out WhatsApp',
  'conversation.consent_granted':'Consentimento registrado',
  'billing.status':'Status financeiro canônico',
  'billing.paid_verified':'Pagamento autenticado',
  'lead.intent':'Intenção declarada do lead',
  'event.type':'Tipo de evento',
};
function replaceAt(root: Rule,path: number[], next: Rule|null): Rule {
  if (!path.length) return next || root;
  if (root.kind!=='group') return root;
  const [head,...tail]=path;
  const children=root.rules.flatMap((child,i) =>
    i!==head ? [child] : tail.length ? [replaceAt(child,tail,next)] : next ? [next] : []);
  return {...root,rules:children.length?children:[makeComparison()]};
}
function countNodes(root: Rule): number {
  return root.kind==='group' ? 1+root.rules.reduce((n,child)=>n+countNodes(child),0) : 1;
}
function inputValue(value: Scalar): string {
  return value===null ? '' : String(value);
}
function typedValue(value: string,kind: string): Scalar {
  if (kind==='number') {
    const n=Number(value);
    return value.trim()!=='' && Number.isFinite(n) ? n : 0;
  }
  if (kind==='boolean') return value==='true';
  if (kind==='null') return null;
  return value.slice(0,256);
}

function RuleRow({rule,path,depth,canRemove,canAdd,onEdit}:
  {rule:Rule;path:number[];depth:number;canRemove:boolean;canAdd:boolean;onEdit:Change}) {
  const id=path.join('-')||'root';
  const change=(next:Rule)=>onEdit(path,next);
  const remove=<button type="button" className="ory-rule-remove" disabled={!canRemove}
    aria-label={'Remover condição '+id} onClick={()=>onEdit(path,null)}>Remover</button>;
  if (rule.kind==='group') return <div className="ory-rule-group" data-depth={depth}>
    <div className="ory-rule-group-head">
      <label>Combinar regras
        <select aria-label={'Operador lógico '+id} value={rule.op}
          onChange={e=>change({...rule,op:e.target.value as 'all'|'any'})}>
          <option value="all">Todas (E)</option><option value="any">Qualquer (OU)</option>
        </select>
      </label>
      {remove}
    </div>
    {rule.rules.map((child,i)=><RuleRow key={i} rule={child}
      path={[...path,i]} depth={depth+1} canRemove={rule.rules.length>1}
      canAdd={canAdd} onEdit={onEdit}/>)}
    <div className="ory-rule-add">
      <button type="button" disabled={!canAdd} onClick={()=>change({...rule,rules:[...rule.rules,makeComparison()]})}>
        + Condição
      </button>
      <button type="button" disabled={!canAdd || depth>=7}
        onClick={()=>change({...rule,rules:[...rule.rules,{kind:'group',op:'all',rules:[makeComparison()]}]})}>
        + Grupo
      </button>
    </div>
  </div>;
  const option=<label>Campo
    <select aria-label={'Campo da condição '+id} value={rule.field}
      onChange={e=>change({...rule,field:e.target.value as FieldName})}>
      {RULE_FIELDS.map(field=><option key={field} value={field}>{labels[field]}</option>)}
    </select>
  </label>;
  return <div className="ory-rule-leaf">
    <div className="ory-rule-leaf-head">
      <label>Tipo de condição
        <select aria-label={'Tipo de condição '+id} value={rule.kind}
          onChange={e=>{
            const type=e.target.value;
            if(type==='exists') change({kind:'exists',field:rule.field});
            else if(type==='one_of') change({kind:'one_of',field:rule.field,values:['']});
            else change({kind:'compare',field:rule.field,op:'eq',value:''});
          }}>
          <option value="compare">Comparar</option>
          <option value="one_of">Pertence à lista</option>
          <option value="exists">Está preenchido</option>
        </select>
      </label>
      {remove}
    </div>
    {option}
    {rule.kind==='compare'&&<div className="ory-rule-pair">
      <label>Operador
        <select aria-label={'Operador da condição '+id} value={rule.op}
          onChange={e=>change({...rule,op:e.target.value as 'eq'|'neq'})}>
          <option value="eq">É igual a</option><option value="neq">É diferente de</option>
        </select>
      </label>
      <label>Tipo do valor
        <select aria-label={'Tipo do valor '+id}
          value={rule.value===null?'null':typeof rule.value}
          onChange={e=>change({...rule,value:typedValue('',e.target.value)})}>
          <option value="string">Texto</option><option value="number">Número</option>
          <option value="boolean">Verdadeiro/Falso</option><option value="null">Nulo</option>
        </select>
      </label>
      {typeof rule.value==='boolean'?<label>Valor
        <select aria-label={'Valor da condição '+id} value={String(rule.value)}
          onChange={e=>change({...rule,value:e.target.value==='true'})}>
          <option value="true">Verdadeiro</option><option value="false">Falso</option>
        </select>
      </label>:rule.value!==null?<label>Valor
        <input aria-label={'Valor da condição '+id} type={typeof rule.value==='number'?'number':'text'}
          value={inputValue(rule.value)} maxLength={256}
          onChange={e=>change({...rule,value:typedValue(e.target.value,typeof rule.value)})}/>
      </label>:null}
    </div>}
    {rule.kind==='one_of'&&<label>Valores permitidos (um por linha, máximo 32)
      <textarea aria-label={'Valores da lista '+id} rows={3} value={rule.values.join('\n')}
        onChange={e=>{
          const next=e.target.value.split(/\r?\n/).slice(0,32).map(v=>v.slice(0,256));
          change({...rule,values:next});
        }}/>
    </label>}
  </div>;
}

/** Pure, form-based editor. It emits only allowlisted structured DSL, never JS/SQL. */
export function ConditionRuleEditor({value,onChange}:Props) {
  const valid=validateRule(value).ok;
  if (!valid) return <div className="ory-rule-invalid" role="alert">
    <p>Esta condição não segue o formato tipado homologável.</p>
    <button type="button" onClick={()=>onChange(makeComparison())}>Criar condição segura</button>
  </div>;
  const root=value as Rule;
  const change:Change=(path,next)=>onChange(replaceAt(root,path,next));
  return <div className="ory-rule-editor">
    <p className="ory-rule-help">Configure condições sem escrever código. Dados ausentes não satisfazem uma regra automaticamente.</p>
    <RuleRow rule={root} path={[]} depth={0} canRemove={false}
      canAdd={countNodes(root)<63} onEdit={change}/>
    {root.kind!=='group'&&<button className="ory-rule-wrap" type="button"
      onClick={()=>onChange({kind:'group',op:'all',rules:[root,makeComparison()]})}>
      + Combinar com outra condição
    </button>}
  </div>;
}
