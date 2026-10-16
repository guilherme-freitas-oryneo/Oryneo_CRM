import {assertEquals} from 'jsr:@std/assert@1';
import {parseOryneoPreviewUrl} from '../_shared/landing/verified-html.ts';
Deno.test('aceita somente páginas publicadas no repositório Oryneo',()=>{
 const good='https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/preview/v1/index.html';
 assertEquals(parseOryneoPreviewUrl(good),good);
});
Deno.test('bloqueia SSRF, domínios parecidos, query, protocolos e redirects no URL inicial',()=>{
 for(const bad of [
  'http://guilherme-freitas-oryneo.github.io/Oryneo_CRM/x',
  'https://localhost/Oryneo_CRM/x',
  'https://127.0.0.1/Oryneo_CRM/x',
  'https://guilherme-freitas-oryneo.github.io.evil.com/Oryneo_CRM/x',
  'https://guilherme-freitas-oryneo.github.io@evil.com/Oryneo_CRM/x',
  'https://guilherme-freitas-oryneo.github.io/another-project',
  'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/x?unsafe=true',
  'javascript:alert(1)'
 ])assertEquals(parseOryneoPreviewUrl(bad),null);
});
