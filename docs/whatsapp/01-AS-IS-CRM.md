# Baseline verificável do CRM ORYNEO

Data: 2026-10-24 UTC. Não houve login de operador nem teste visual autenticado; esta é uma auditoria de código e metadados remotos.

## Código e publicação

Repositório canônico: `guilherme-freitas-oryneo/Oryneo_CRM`, `main` em `62e05be4701c07adf4896ca5904864f7d19e94c6`. React 19, Vite 7, TypeScript e Supabase JS. GitHub Pages serve a branch `gh-pages` no endereço declarado em `docs/GITHUB_PAGES_CRM.md`; o commit de deploy `8cf8e895805a303e16cb7d69cc8e08f9705e0016` declara origem `62e05be`, o workflow de publicação concluiu com sucesso e o endereço respondeu HTTP 200 na nova verificação. Isso prova publicação do bundle, não um smoke test autenticado. O Site ORYNEO CRM v1 visto no conector Sites é uma superfície distinta e mais antiga; não há prova de que represente o commit publicado em Pages.

`src/firstContact/LeadQuickActions.tsx` constrói um link `wa.me` para o telefone do lead e abre uma aba externa. Templates de e-mail incluem CTA para o WhatsApp comercial. Esses recursos não guardam thread, mensagens, status ou anexos no CRM. Não há rota de inbox WhatsApp em `src/App.tsx`, adapter Cloud API nem webhook Meta em `supabase/functions`.

Nova conferência em 2026-10-24: `main` continua em `62e05be`, a branch `gh-pages` continua servindo esse commit, o projeto Supabase continua com 44 migrations (a última de cobrança, `20261022000841`) e nenhuma tabela ou Edge Function WhatsApp. O PR draft #53 contém preparação e testes, mas não foi mesclado nem publicado. Portanto, o WhatsApp disponível no CRM publicado é a ação externa `wa.me`, não uma conversa integrada.

## Banco e autorização atuais

Projeto Supabase `ucikrafwfzamxvweuvgk` ativo. Inventário `public`: 31 tabelas, todas com RLS habilitada. Não há tabela de canal/conversa/mensagem WhatsApp; `crm_mail_messages` é e-mail. Há 44 migrations e 21 Edge Functions ativas, nenhuma com slug WhatsApp.

`crm_records` contém `id`, `kind`, `data` JSONB, `revision`, `deleted` e timestamps. `crm_members` contém `user_id`. Policies `member_records` e `crm_automation_jobs_member_read` liberam leitura a qualquer membro autenticado presente em `crm_members`; não há coluna de equipe/carteira em `crm_members`. Isso parece um CRM de organização única no esquema atual. É inadequado prometer isolamento entre carteiras/equipes para o novo módulo sem modelo e testes específicos. Não modificar policies existentes sem mapear as personas e a operação atual.

`crm_automation_jobs` e suas funções de claim/finish são para e-mails existentes; não equivalem a fila de WhatsApp nem têm estado `human_locked`. Não conectar SDR de WhatsApp a esse worker por nome parecido.

## Testes e limites

Checkout limpo no início. `npm ci` e `npm test -- --run`: 255/255 testes antes de alterações. Falta sessão autenticada para reproduzir as hipóteses históricas de avatar, unread, áudio, direção e duplicação; no CRM ORYNEO remoto não há inbox WhatsApp integrado onde reproduzi-las. Essas hipóteses podem pertencer a outro ambiente ou trabalho local ainda não sincronizado. Não foram marcadas como defeitos presentes.
