# ORYNEO — CORS do CRM: paridade GitHub ↔ Supabase
Registro: 27/10/2026. Nenhum redeploy de Supabase é feito por este PR.

## Status verificável
A infraestrutura atual usa HTTPS em https://crm.oryneo.com.br, com o legado https://guilherme-freitas-oryneo.github.io mantido. As 15 Edge Functions já foram atualizadas na produção na intervenção anterior. A main, porém, ainda não refletia toda a lista de origens.

## Fontes equivalentes ao código de produção
Inclusão de uma única origem com equivalência textual exata confirmada para: billing-public v17, checkout-intake v22, company-enrich v10, delivery-admin v9, delivery-public v9, landing-admin v9, landing-public v9, offboarding-admin v9, offboarding-public v9 e mail-api/handler.ts v25. proposal-create v12 e proposal-public v9 já coincidiam integralmente com main após PR #57.

## Três exceções — NÃO redeployar cegamente
- billing-center v6: a versão remota é um bundle de ~83 KB, enquanto a main tem código modular ~16 KB. Novo CORS adicionado à fonte modular, sem prova de paridade byte a byte.
- checkout-intake-noncard-test v22: versão remota bundlada; fonte modular contém a origem nova, não foi reimplantada neste PR.
- billing-create-order v16: divergência material anterior à migração. Main contém a guarda que rejeita payment_method diferente de card; a versão remota não continha essa guarda. O arquivo versionado conserva a proteção da main, adicionando somente CORS. A implantação ativa e o código do GitHub ainda não são semanticamente idênticos. EXIGE reconciliação da regra comercial em staging antes de redeploy.

## Evidências
- https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/40583435752: 30/30 preflight HTTP OPTIONS (ambos origins) e 9/9 GET de rotas públicas, sem tocar em dados.
- Publicação GitHub Pages por PR #56; frontend proposta por PR #57, commit ffda428ec0a2365f0383e7b0c48fd99ca7f21e14.
- proposal-create v12 gera URL com https://crm.oryneo.com.br/proposta/; links históricos permanecem acessíveis em /Oryneo_CRM/proposta/.
- Último inventário antes deste PR: cinco propostas; 32 e-mails state=sent; 23 pedidos. Nenhuma transação/e-mail de teste real foi executada.

## Critérios de homologação pendentes
1. Confirmar caixa postal ativa, fila e resposta email_sent com lead fictício previamente autorizado. Verificar inbox do destinatário, links e template, sem enviar e-mail a cliente real.
2. Aceite com versão/hash/consentimento e atualização do CRM em operação autenticada.
3. Fluxo Stripe TEST completo (cartão, Pix, boleto, webhooks, retornos novo/legado); preservar parâmetros e idempotência.
4. Reconciliar billing-create-order, billing-center e checkout-intake-noncard-test antes de qualquer atualização dessas funções.
5. CI, browser QA e teste HTTP devem passar no HEAD exato; só então considerar o merge do PR. PR #55 segue draft e NÃO deve ser mesclado automaticamente.

## Segurança e rollback
Este PR modifica apenas arquivos versionados. Não executa SQL, migrações, env vars, deploy, disparos ou cobranças. Qualquer atualização futura deve preservar verify_jwt e ter backup da versão remota; rollback seletivo, sem DROP nem reprocessamento de pedidos.
