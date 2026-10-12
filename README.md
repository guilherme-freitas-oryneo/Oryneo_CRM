# ORYNEO CRM

CRM comercial da ORYNEO com Pipeline, Atividades e caixa de e-mail compartilhada integrada.

## E-mail no CRM

- Sincronização bidirecional da caixa corporativa pela Hostinger (IMAP/SMTP) via Supabase Edge Functions.
- Pastas, busca, filtros, leitura por conversa, respostas, anexos privados e atualização em tempo real.
- HTML sanitizado e imagens externas bloqueadas até autorização explícita.
- Credencial guardada no Supabase Vault; o navegador nunca recebe a senha do e-mail.

Primeira operação comercial baseada no Figma `xIRj2eI4Kt14xgEAjlKEmp`, frame `3:10`.

## Desenvolvimento

`npm ci` · `npm run dev` · `npm run build`

Frontend React/TypeScript estático. O Supabase público é configurado em `src/data.ts`; a chave publicável não concede acesso aos registros sem sessão e associação em `crm_members`. Senhas e chaves administrativas não fazem parte deste repositório.

## Operação

- Busca por título, empresa, contato, telefone, e-mail, origem e notas; busca individual por coluna.
- Etapas editáveis, cores, ordem via menu, duplicação vazia e exclusão de etapas vazias.
- Oportunidades com valor em centavos, contato, notas, retorno e origem; arraste entre etapas ou use o menu acessível.
- Desfazer última mutação na sessão, via botão ou Ctrl/Cmd+Z; conflitos posteriores são rejeitados. Campos de texto mantêm seu próprio desfazer.
- Atualização ao voltar à janela e a cada 30 segundos; sem dados de demonstração.
- Oportunidades da landing entram na primeira etapa aberta com valor zero, a qualificar. Preços informados pelo navegador ficam nas notas, não nos totais negociados.

## Banco e captação

Projeto exclusivo: `ucikrafwfzamxvweuvgk`. Migração em `supabase/migrations`. RLS protege os dados; leitura exige associação explícita e mutações passam por funções transacionais com controle de revisão. Exclusão é lógica e recuperável; histórico registra antes/revisão/ator.

A Edge Function `lead-intake` exige JWT público válido, valida campos e consentimento, limita tamanho e frequência, aceita apenas origens da landing no navegador e usa idempotência por UUID. A chave administrativa fica no ambiente da função. Os limites são 5 envios por telefone/hora e 150 envios globais/hora. Esses limites são uma barreira básica; não constituem CAPTCHA.

A conta inicial foi provisionada via API administrativa, e a função temporária `crm-bootstrap` foi substituída por resposta 410. Nenhuma rota de cadastro é exibida; usuários não associados não acessam o CRM.

## Publicação

O Site e o repositório GitHub do CRM são exclusivos deste produto. `.openai/hosting.json` declara a identidade do Site e `dist` como saída. A landing é mantida no repositório separado `Oryneo_Landing_Page`. Command Center não participa desta implementação.

Veja `docs/superpowers/plans/2026-10-10-crm.md` para decisões e referências. A compilação TypeScript/Vite foi executada; não foram adicionados testes automatizados nem realizada revisão em navegador nesta sessão.
