import {describe,it,expect} from 'vitest';
import {commercialStageList,LEGACY_IMPLEMENTATION_STAGE_ID} from './postSaleStage';
import type {StageRow,DealRow} from '../data';
const stage=(id:string,name:string):StageRow=>({
 id,kind:'stage',data:{name,color:'#123456',position:1,outcome:'open'},
 deleted:false,revision:1,created_at:'',updated_at:'',
});
const deal=(id:string,stageId:string):DealRow=>({
 id,kind:'deal',data:{stage_id:stageId} as DealRow['data'],
 deleted:false,revision:1,created_at:'',updated_at:'',
});
const original=[
 stage('11111111-1111-4111-8111-111111111111','Ganha'),
 stage(LEGACY_IMPLEMENTATION_STAGE_ID,'Implantação'),
 stage('33333333-3333-4333-8333-333333333333','Perdida'),
];
describe('Separação comercial e pós-venda sem perda',()=>{
 it('preserva todo o pipeline quando flag não está ativa',()=>{
  expect(commercialStageList(original,[],false)).toEqual(original);
 });
 it('nao oculta Implantação apenas com a flag de UI',()=>{
  expect(commercialStageList(original,[],true)).toEqual(original);
 });
 it('oculta exclusivamente a antiga coluna vazia depois da migração',()=>{
  expect(commercialStageList(original,[],true,true).map(x=>x.data.name)).toEqual(['Ganha','Perdida']);
 });
 it('reexibe a coluna legada quando existe oportunidade histórica',()=>{
  const d=deal('a',LEGACY_IMPLEMENTATION_STAGE_ID);
  expect(commercialStageList(original,[d],true,true)).toEqual(original);
 });
 it('não altera stage_id, objetos de entrada nem resultados comerciais',()=>{
  const copy=structuredClone(original),d=deal('a','11111111-1111-4111-8111-111111111111');
  commercialStageList(original,[d],true);
  expect(original).toEqual(copy);
  expect(d.data.stage_id).toBe('11111111-1111-4111-8111-111111111111');
 });
});
