import { normalizeCnpj } from './direct-checkout.ts';

const text=(value:unknown,max=200)=>typeof value==='string'?value.trim().slice(0,max):typeof value==='number'&&Number.isFinite(value)?String(value):'';
const digits=(value:unknown)=>text(value,50).replace(/\D/g,'');
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

export function normalizeBrasilApiCompany(value:unknown,expectedCnpj:string){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('CNPJ_LOOKUP_INVALID');
 const data=value as Record<string,unknown>;
 if(normalizeCnpj(data.cnpj)!==normalizeCnpj(expectedCnpj))throw new Error('CNPJ_LOOKUP_MISMATCH');
 const legalName=text(data.razao_social,220);
 if(!legalName)throw new Error('CNPJ_LOOKUP_INVALID');
 const tradeName=text(data.nome_fantasia,220);
 const secondary=(Array.isArray(data.cnaes_secundarios)?data.cnaes_secundarios:[]).slice(0,100).map(item=>{
  const entry=record(item);return {code:text(entry.codigo,20),description:text(entry.descricao,240)};
 }).filter(item=>item.code||item.description);
 const partners=(Array.isArray(data.qsa)?data.qsa:[]).slice(0,80).map(item=>{
  const entry=record(item);return {name:text(entry.nome_socio,180),qualification:text(entry.qualificacao_socio,120),joined_at:text(entry.data_entrada_sociedade,25)};
 }).filter(item=>item.name);
 const taxRegime=(Array.isArray(data.regime_tributario)?data.regime_tributario:[]).slice(0,30).map(item=>{
  const entry=record(item),year=Number(entry.ano);return {year:Number.isInteger(year)?year:null,label:text(entry.forma_de_tributacao,160)};
 }).filter(item=>item.year||item.label);
 const profile={
  legal_name:legalName,trade_name:tradeName,status:text(data.descricao_situacao_cadastral,100),status_date:text(data.data_situacao_cadastral,25),
  status_reason:text(data.descricao_motivo_situacao_cadastral,180),special_status:text(data.situacao_especial,120),special_status_date:text(data.data_situacao_especial,25),
  opened_at:text(data.data_inicio_atividade,25),capital:typeof data.capital_social==='number'&&Number.isFinite(data.capital_social)?data.capital_social:null,
  size:text(data.porte,100),legal_form:text(data.natureza_juridica,180),legal_form_code:text(data.codigo_natureza_juridica,30),
  branch_type:text(data.descricao_identificador_matriz_filial,80),main_activity:text(data.cnae_fiscal_descricao,240),main_cnae:text(data.cnae_fiscal,30),
  secondary_activities:secondary,email:text(data.email,254).toLowerCase(),phone:text(data.ddd_telefone_1,40),secondary_phone:text(data.ddd_telefone_2,40),fax:text(data.ddd_fax,40),
  address:{street_type:text(data.descricao_tipo_de_logradouro,60),street:text(data.logradouro,180),number:text(data.numero,40),complement:text(data.complemento,160),district:text(data.bairro,120),city:text(data.municipio,120),city_code:text(data.codigo_municipio_ibge||data.codigo_municipio,30),state:text(data.uf,2),zip:digits(data.cep).slice(0,8),country:text(data.pais,80)},
  simples:{enabled:data.opcao_pelo_simples===true,since:text(data.data_opcao_pelo_simples,25),excluded_at:text(data.data_exclusao_do_simples,25)},
  mei:{enabled:data.opcao_pelo_mei===true,since:text(data.data_opcao_pelo_mei,25),excluded_at:text(data.data_exclusao_do_mei,25)},
  tax_regime:taxRegime,qsa:partners,source:'BrasilAPI',
 };
 return {cnpj:normalizeCnpj(expectedCnpj),legalName,displayName:tradeName||legalName,profile};
}
