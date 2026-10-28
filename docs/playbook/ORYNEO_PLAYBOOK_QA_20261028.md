# ORYNEO | Playbook Comercial — evidências de homologação e liberação

**Edição:** 1.0 · **Data:** 28/10/2026 · **Origem:** PR #67

## Escopo
- 64 slides executivos, em cinco partes: Estratégia, Diagnóstico, Conversão, Operação e Performance.
- Início em tela de espera, navegação, reprodução automática opcional, atalhos e tela cheia.
- Marca-texto em três cores, notas pessoais e compartilháveis, edição e exclusão pelo autor.
- Progresso individual no CRM, versão de conteúdo e proteção contra aplicação incorreta de destaques quando um trecho muda.
- Menu autenticado `CONHECIMENTO > Playbook Comercial`.
- Conteúdo e imagens versionados; nenhuma chamada à IA ou serviço faturável adicional.

## Identidade oficial
- Arquivos autênticos obtidos do Drive ORYNEO / Brand Kit v1.1 em 28/10/2026, sem redesenho.
- Wordmark principal: `oryneo_wordmark_master_800w.png` (Drive `1d4DxYziJZyTEr63vqZ_GhTF0WSIoBDIn`).
- Wordmark reverso: `oryneo_wordmark_mono_reverse_800w.png` (Drive `1YU8mPsHqQ9Yq5xnCmJ2Jai5YqhD3ARjS`).
- Símbolo SVG original: `oryneo_symbol_app.svg` (Drive `1_fw72wUHKK5ta5FaR7uMdpyU4mskBRU6`).
- Cores: graphite `#0F1115`, indigo `#4F6BFF`, off-white `#F8F7F4`. Tipografia de produção: Inter.
- Copy institucional conferida no `VOICE_AND_COPY.md` do Drive: “Crescimento em sistema.” e “Mais conexões. Mais resultado. Um só sistema.”
- Não reproduzir ou reconstruir wordmark em SVG ou com fonte; master vetorial do wordmark não disponível.

## Homologação automatizada aprovada
- Vitest, compilação, TypeScript e Edge Functions.
- Regressão Pix, checkout e QA preexistente do CRM em Chromium e WebKit.
- QA dedicado em Chromium desktop (1440px), tablet (1024px), mobile (390px) e WebKit mobile; capturas publicadas pelo GitHub Actions.
- Inspeção individual dos 64 slides em Chromium desktop e mobile: sem transbordamento detectado de conteúdo, decisão e rodapé.
- Navegação, capa, autoplay, leitura de progresso, seleção real de texto, marcação, edição, exclusão e compartilhamento (fixture isolada).
- RLS com dois membros distintos, um não membro e papel anon em PostgreSQL descartável, com tentativas de leitura, inserção, alteração e exclusão não autorizadas.
- Mensalidades e implantação dos slides 7–8 conferidas com o catálogo de billing versionado. A versão editorial pode requerer revisões futuras, de forma controlada.

## Supabase sem nova contratação
- O usuário recusou custo adicional de staging; nenhuma branch paga foi criada.
- Migração registrada no projeto Supabase existente `ucikrafwfzamxvweuvgk`, versão `20261028194251_crm_playbook_annotations`.
- Duas tabelas adicionadas: `public.crm_playbook_annotations` e `public.crm_playbook_progress`, ambas com RLS e quatro políticas por tabela.
- Segunda migração de endurecimento `20261028194349_crm_playbook_restrict_member_privileges`: `authenticated` tem exclusivamente SELECT, INSERT, UPDATE, DELETE; papel `anon` sem privilégios.
- Verificações SQL de leitura/escrita com transação revertida e asserts sob JWT simulado no projeto real; nenhuma anotação ou progresso de teste persistido.
- O projeto existente possuía um membro CRM no momento da auditoria. Compartilhamento entre dois membros foi provado em banco descartável, não em duas sessões de usuários reais do Supabase.
- As duas migrações foram alinhadas pelo número exato de versão do histórico Supabase e estão versionadas no GitHub. O QA de RLS executa as duas.

## Critérios de liberação
1. Toda execução de CI da versão candidata com sucesso.
2. PR sem conflitos com a branch main no momento do merge.
3. Supabase com ambas as migrações registradas, tabelas e políticas ativas e permissões mínimas.
4. Merge somente após o banco estar pronto: `publicar-crm-pages.yml` dispara deploy automático ao receber alteração em `src/**`.
5. Confirmar sucesso do workflow de deploy em `main` e disponibilidade HTTP da URL publicada antes de comunicar recarregamento.
6. Após deploy, validar manualmente em uma sessão real do CRM o fluxo de salvar anotação e retornar após recarregar (recomendação de verificação pós-publicação).

## Não incluído nesta etapa
- Nenhuma nova assinatura de serviço, branch paga ou plano de Supabase.
- Nenhuma submissão de templates à Meta.
- Nenhuma alteração nas condições comerciais do CRM.

## Fontes de estudo
- https://www.huthwaiteinternational.com/spin-selling/
- https://winningbydesign.com/spiced-framework/
- https://meddicc.com/resources
- https://academy.hubspot.com/courses/inbound-sales
- https://trailhead.salesforce.com/pt-BR/content/learn/modules/customer-centric-discovery-strategies
- https://www.gong.io/blog/best-discovery-call-tips
- https://business.whatsapp.com/policy
