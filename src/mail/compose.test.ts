import {describe,it,expect} from 'vitest';
import {parseAddresses,assertPayloadSize,MAX_REQUEST_BYTES} from './compose';
import {parseStorageQuota} from '../../supabase/functions/_shared/mail/quota';
describe('contratos da caixa',()=>{
 it('não omite endereço inválido em Cc/Cco',()=>{expect(()=>parseAddresses('ana@example.com;bad')).toThrow(/destinatário/);});
 it('conta bytes UTF-8 do corpo antes do envio',()=>{expect(()=>assertPayloadSize({text:'é'.repeat(MAX_REQUEST_BYTES/2)})).toThrow(/25 MiB/);});
 it('interpreta quota STORAGE em KiB sem usar contagem de mensagens',()=>{
  expect(parseStorageQuota(['* QUOTA "" (STORAGE 512 1024 MESSAGE 3 100)'])).toEqual({usedBytes:524288,limitBytes:1048576});
  expect(parseStorageQuota(['* QUOTA "" (MESSAGE 3 100)'])).toBeNull();
  expect(parseStorageQuota(['* QUOTA "" (STORAGE 5 0)'])).toBeNull();
 });
});
