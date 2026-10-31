# ORYNEO — Automações: checkpoint de implementação (30/10/2026)

## Estado original

Base GitHub main: 9fb514e7e3f831dee8861176ba7435ba23ba91d4 (PR #71 mesclado). Supabase ORYNEO-CRM ativo (ucikrafwfzamxvweuvgk).

PRESERVAR: SDR IA atualmente funcional, webhook WhatsApp, filas crm_wa_ai_jobs e crm_wa_ai_outbox, worker, cron, controle por conversa, interface WhatsApp, Playbook Comercial v1.0 e automações legadas crm_automation_jobs. Nenhuma alteração nesses componentes é necessária para a fundação inicial.

PENDENTE: engine durável versionada, persistência de grafos, editores visuais separados de pipeline e SDR, integração de templates Meta em tempo de execução, intenções configuráveis, conhecimento homologado e observabilidade.

A sidebar atualmente contém AUTOMAÇÃO > IA e SDR; não contém o centro de automações solicitado. As etapas comerciais ainda incluem Qualificada, Em decisão e Implantação.

## Segurança desta primeira entrega

- Adições exclusivamente em src/automation/flowDefinition.ts e testes novos; sem importar essas funções para o aplicativo atual.
- validateFlow é apenas uma pré-validação do grafo: verifica tipo, estrutura, nós e conexões, ramos, ciclos e alcançabilidade. Não valida regras comerciais, permissões, versões de conhecimento ou consentimento de envio.
- simulateFlow não possui adaptadores de escrita ou rede. A marca planned significa apenas que um efeito seria planejado; nenhum efeito é executado.
- Exemplos do pacote original são conceituais e podem conter referências ou ramos incompletos. Não são fluxos implantáveis.
- Nenhuma tabela, migração, cron, Edge Function, arquivo do SDR existente ou configuração Stripe/Meta foi alterada.
- O histórico de migrations tem nomes correspondentes mas timestamps diferentes entre GitHub e Supabase; reconciliar antes de novo DDL.

## A implementar até completar o pacote

1. Condições compostas AND/OR, classificador, conhecimento, múltiplas saídas tipadas, timeout/else/error e validação profunda da configuração de cada nó.
2. Banco versionado, isolamento de workspaces, RLS, papéis, publicação atômica, rollback e audit log.
3. Motor durável com inbox idempotente, trace por nó, timers, outbox, kill switch e execução de eventos legados inicialmente apenas em modo espelho.
4. Centro de Automações: menu nativo, canvas pipeline, canvas SDR, inspector, zoom, busca, drag, hover, context menu, touch, undo/redo e acessibilidade.
5. Integrações com catálogo, Playbook e templates Meta oficiais; lançamento progressivo sem conflito com SDR atual.
6. QA integrado dos 47 cenários do ZIP, testes de regressão, build, CI, testes visuais, RLS e verificação de efeitos externos.

## Publicação

ESTE CHECKPOINT NÃO HOMOLOGA O ZIP. É um incremento isolado para revisão. Não executar a engine no CRM em produção até que a implementação integral tenha sido testada e autorizada. A conta Stripe conectada está em modo live: não gerar cobranças para testes.
