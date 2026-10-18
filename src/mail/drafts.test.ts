import {describe,it,expect} from 'vitest';
import {sameSavedDraft,validateDraftBody} from '../../supabase/functions/mail-api/drafts';
describe('validação dos rascunhos',()=>{
 it('preserva anexos vazios e rejeita Base64 malformado',()=>{
  expect(()=>validateDraftBody({attachmentManifest:[{filename:'vazio.txt',mimeType:'text/plain',contentBase64:''}]})).not.toThrow();
  expect(()=>validateDraftBody({attachmentManifest:[{filename:'a.txt',mimeType:'text/plain',contentBase64:'?!?='}]})).toThrow('INVALID_ATTACHMENT');
 });
 it('rejeita cabeçalhos injetados e metadados excessivos',()=>{
  expect(()=>validateDraftBody({attachmentManifest:[{filename:'a\r\nBcc:x',mimeType:'text/plain',contentBase64:'YQ=='}]})).toThrow('INVALID_ATTACHMENT');
  expect(()=>validateDraftBody({composeMeta:{text:'a'.repeat(10001)}})).toThrow('INVALID_MESSAGE');
 });
 it('recupera insert sem resposta apenas com payload idêntico e revisão inicial',()=>{
  const values={mailbox_id:'box',created_by:'author',subject:'A',attachment_manifest:[],compose_meta:{locked:false}};
  expect(sameSavedDraft({...values,state:'active',revision:1},values,1)).toBe(true);
  expect(sameSavedDraft({...values,compose_meta:{locked:false,inReplyTo:'x'},state:'active',revision:2},{...values,compose_meta:{inReplyTo:'x',locked:false}},2)).toBe(true);
  expect(sameSavedDraft({...values,state:'active',revision:2},values,1)).toBe(false);
  expect(sameSavedDraft({...values,state:'active',revision:1,subject:'B'},values,1)).toBe(false);
  expect(sameSavedDraft({...values,state:'discarded',revision:1},values,1)).toBe(false);
 });
});
