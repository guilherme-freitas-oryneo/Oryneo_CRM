import assert from 'node:assert/strict';
import { normalizeBrasilApiCompany } from '../_shared/billing/company-profile.ts';

Deno.test('BrasilAPI é normalizada para a ficha empresarial sem confiar em campos inesperados',()=>{
 const source={
  cnpj:'11222333000181',razao_social:'Acme Comércio Ltda.',nome_fantasia:'Acme',descricao_situacao_cadastral:'ATIVA',
  data_situacao_cadastral:'2020-01-10',descricao_motivo_situacao_cadastral:'SEM MOTIVO',data_inicio_atividade:'2017-04-03',
  capital_social:250000,porte:'MICRO EMPRESA',natureza_juridica:'Sociedade Empresária Limitada',cnae_fiscal:6201501,
  cnae_fiscal_descricao:'Desenvolvimento de programas',cnaes_secundarios:[{codigo:6202300,descricao:'Consultoria em tecnologia'}],
  logradouro:'Rua Exemplo',numero:'100',complemento:'Sala 2',bairro:'Centro',municipio:'Rio de Janeiro',uf:'RJ',cep:'20000-000',
  email:'CONTATO@ACME.EXAMPLE',ddd_telefone_1:'2133334444',ddd_telefone_2:'',qsa:[{nome_socio:'Marina Costa',qualificacao_socio:'Sócio-Administrador',data_entrada_sociedade:'2017-04-03'}],
  opcao_pelo_simples:true,data_opcao_pelo_simples:'2018-01-01',opcao_pelo_mei:false,regime_tributario:[{ano:2025,forma_de_tributacao:'SIMPLES'}],
  payload_nao_mapeado:'não deve entrar',
 };
 const company=normalizeBrasilApiCompany(source,'11222333000181');
 assert.equal(company.legalName,'Acme Comércio Ltda.');
 assert.equal(company.displayName,'Acme');
 assert.equal(company.profile.email,'contato@acme.example');
 assert.equal(company.profile.address?.zip,'20000000');
 assert.deepEqual(company.profile.secondary_activities,[{code:'6202300',description:'Consultoria em tecnologia'}]);
 assert.deepEqual(company.profile.tax_regime,[{year:2025,label:'SIMPLES'}]);
 assert.equal('payload_nao_mapeado' in company.profile,false);
});

Deno.test('resposta da BrasilAPI precisa corresponder exatamente ao CNPJ consultado',()=>{
 assert.throws(()=>normalizeBrasilApiCompany({cnpj:'00999999000100',razao_social:'Outra empresa'},'11222333000181'));
 assert.throws(()=>normalizeBrasilApiCompany({cnpj:'11222333000181',razao_social:''},'11222333000181'));
});
