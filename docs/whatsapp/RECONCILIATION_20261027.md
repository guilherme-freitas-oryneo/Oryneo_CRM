# Reconciliação da retomada WhatsApp — 27/10/2026

Fonte de partida: `ORYNEO_CODEX_WHATSAPP_MASTER_AUTONOMIA_20261027.zip`, confrontado com GitHub, Supabase e Meta nesta sessão. O ZIP é um checkpoint, não uma leitura viva. Este documento não contém credenciais nem conteúdo de conversas.

## Gate G0 — inventário fresco

| Item | Evidência verificada | Estado |
| --- | --- | --- |
| PR [#53](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/pull/53) | Aberto, draft, não mesclado, HEAD `8a5ed2d4f6f37acab42d30daf755fecd800ce7f0` | CONFIRMADO |
| CI do HEAD | [build/Edge](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/40558510403) e [Pix](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/40558510420) passaram; [browser QA](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/40558510062) falhou | PARCIAL |
| Checkout local antigo | `a58b7a5` divergia do PR em 18 commits; preservado em `/workspace/oryneo-whatsapp`. Worktree novo iniciado no HEAD remoto em `/workspace/oryneo-whatsapp-master` | CONFIRMADO |
| Patch não sincronizado do escritório | Sem acesso à máquina do escritório; o HEAD do PR contém o trabalho sincronizado observável | NÃO VERIFICÁVEL |
| Meta | Empresa ORYNEO verificada; app `Oryneo_01` Live; número `+55 21 97451-0932` registrado, callback `messages`, inscrição da conta e pagamento presentes | CONFIRMADO |
| Supabase | `whatsapp-webhook` v4 (JWT off), `whatsapp-inbox` v5 e `whatsapp-media` v2 (JWT on), todas ativas | CONFIRMADO |
| Banco | 1 canal `enabled=false`, 1 evento webhook, 1 conversa, 1 mensagem, 0 tentativas outbox | CONFIRMADO |
| Token sistema | O token fornecido anteriormente acessou via Graph API o usuário de sistema e os ativos corretos; o proprietário informou que salvou o segredo no Supabase. A conexão Supabase não lê o valor nem comprova a execução da função com ele | PARCIAL |
| Frontend publicado | O PR segue draft e sem merge; não há homologação da central publicada | BLOQUEADO |
| E2E mensagem real | Após teste solicitado ao proprietário, chegou um evento `messages` com tipo `text` em 27/10 às 15:50 (São Paulo), processado sem erro e persistido como mensagem `inbound/text`. O evento anterior era `unsupported`. Ainda não há resposta, status de entrega, mídia ou login no frontend publicado | PARCIAL |

## Gate G1 — divergências entre branch e ambiente

| Objeto | Código no PR | Ambiente remoto | Estado |
| --- | --- | --- | --- |
| `supabase/functions/whatsapp-inbox/index.ts` | Usa `evaluateOutboundPolicy` para opt-out, consentimento e janela | v5 não chama `evaluateOutboundPolicy`; hash de bundle `65bd07d45ada657ca13cb8153b2a76c65936f00140a985c3668c172d4fc3f24d` | PARCIAL; não ligar canal antes de implantar/validar correção |
| `supabase/functions/whatsapp-media/index.ts` | Fonte recuperada no PR | v2 ativa; hash `18111a0413d4f7ba4f5f1aee65b1a2498349c3f586f23d96ebe9a1362752fc2e` | CONFIRMADO quanto a versão; mídia real não homologada |
| `supabase/functions/whatsapp-webhook/index.ts` | HMAC/normalização versionados | v4 ativa; hash `02d3b90b315f306ddd2d731bbcc4ada506c9fc4bd6850712f1a5e1d98198fb77` | CONFIRMADO quanto a versão; replay e carga real ainda exigem QA |
| Migrações de entrega/não lidas | Ausentes no HEAD do PR | Versões `20261027003453` e `20261027003948` aplicadas | CORRIGIDO NESTE WORKTREE: SQL original recuperado do histórico remoto, sem DDL novo |
| RBAC WhatsApp | `crm_members` autoriza qualquer membro a ler as três tabelas de inbox | As policies remotas também verificam somente membro | NÃO IMPLEMENTADO por equipe/carteira; bloqueio P0 |
| UI inbox | `src/whatsapp/WhatsAppWorkspace.tsx` lê até 100 conversas e faz polling | Não publicada no CRM principal | PARCIAL |

Os SQLs recuperados são cópias byte a byte de `supabase_migrations.schema_migrations.statements[1]`; MD5 remoto/local: `20261027003453` = `0ca753710b370ee571603c3ecebb05d9`, `20261027003948` = `5d9f2a7c9f100d2aecdeb78f16c5afa1`. Foram apenas adicionados ao repositório; **não foram reaplicados** no banco.

## Próximo gate

### G2 em andamento — isolamento de acesso

O commit seguinte à reconciliação introduz `crm_wa_access`: o administrador recebe concessão para o canal verificado somente quando existe um único membro do CRM; operadores e leitores recebem concessões por conversa. As policies passam a negar a leitura geral baseada apenas em `crm_members`. `whatsapp-inbox` exige `admin` ou `operator` para envio e confirmação de leitura; `whatsapp-media` exige concessão na conversa antes de acessar o arquivo. Os grants são escritos apenas pelo papel de serviço, e o navegador não recebe o token Meta.

Teste reproduzível: `bash supabase/tests/whatsapp_acl/run.sh` (Postgres 17 descartável). Verifica administrador, membro sem concessão, leitor com acesso somente à conversa atribuída, mensagem associada, tentativa de autopromoção e acesso anônimo negado. `deno check` passou nas três funções. A migração e as alterações de Edge estão **somente na branch**; não há publicação nem ativação do canal. Permanece pendente a operação de atribuição auditada, a política por equipe, o teste de idempotência concorrente e o E2E com número próprio.

O proxy de mídia recebeu validação de MIME permitido e leitura de stream limitada a 16 MB, inclusive quando a Meta não fornece `Content-Length`; `mediaGuard.deno.ts` cobre MIME divergente/HTML e estouro de limite. Também permanece somente na branch.

### G5/G9 em andamento — não lidas e CI

`src/whatsapp/api.ts` e `WhatsAppWorkspace.tsx` agora consultam `unread_count` e exibem o contador real. A confirmação de leitura chama a Edge Function autenticada somente quando o canal estiver habilitado; o teste garante que abrir uma conversa durante a homologação não envia esse sinal à Meta. A UI segue no PR draft.

O workflow de build/Pix do commit `00972d6` falhou porque o Vitest capturou `mediaGuard.test.ts`, escrito para Deno (`Deno is not defined`). O teste foi movido para `mediaGuard.deno.ts` e passou com `deno test`; a suíte completa voltou a passar com 305 testes. O browser QA continuou falhando em `getByLabel('E-mail corporativo')`, um seletor antigo. Apenas `.github/scripts/qa-direct-checkout.mjs` foi alinhado aos campos atuais `E-mail`, `WhatsApp` e `CNPJ` e aos dois passos `draft`/`checkout`; o checkout não foi alterado. Chromium desktop/mobile passaram localmente. Aguardando resultado de WebKit e CI do novo commit.

Fechar G2 antes de habilitar envio. Depois validar entrada/saída controlada com número próprio e somente então avaliar ativação do canal e publicação da UI. Landing page, checkout, financeiro e e-mail permanecem fora do lote WhatsApp, exceto correção isolada do script de QA já presente no PR.
