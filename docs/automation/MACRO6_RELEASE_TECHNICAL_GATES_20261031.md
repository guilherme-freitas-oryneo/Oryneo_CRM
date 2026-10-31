# ORYNEO — Macroetapa 6: Implementação técnica isolada e gates de release

**Data-base:** 31/10/2026  
**PR:** [#80](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/pull/80) (DRAFT, base PR #79)  
**Natureza:** código preparatório, testes e política de segurança; **sem autorização implícita para cutover de produção.**

## 1. Escopo implementado no PR #80

- Planejamento live **exclusivo para CRM** a partir do diário canônico: cursor manual inicializado com runtime parado, ingestão idempotente, lease com token, versões publicadas imutáveis, verificações de arestas/nós e chave SHA-256, compromisso transacional na outbox.
- Adaptadores CRM e continuação após recibo: tarefas e mudanças de etapa com controle de concorrência; execução até nó terminal; recuperação de recibos após queda sem repetir a mutação, backoff e quarentena.
- Pre-arm de fluxo CRM exclusivamente com workspace/runtimes desligados, papel de publicador, hash de snapshot e CAS; **não** é um comando de ativação.
- Telemetria sem PII com duração/resultado, contagem e custos de provedor **somente quando comprovados**. Custos desconhecidos permanecem nulos.
- Contrato de variáveis da Meta: posições oficiais, origem explícita de campos canônicos e recusa de valores ausentes; mapeamento visual no inspetor. Dados de reunião só com comprovação canônica de agendamento.
- Executor Meta **preparatório e opt-in**, restrito a templates existentes e aprovados, sem resposta livre. Confere aprovação atual do provedor (não apenas cache), componentes e texto oficial, canal vinculado, consentimento de conversa, opt-in de marketing separado, owner exclusivo, lease e kill switch. Há preflight imediatamente antes do POST.
- Resultado de transporte Meta: confirmação com ID, recusa definida ou resultado incerto. **Timeout não produz retry automático**. Recibo confirmado e histórico WhatsApp do CRM são persistidos na mesma transação.
- Provas isoladas: PostgreSQL 17 descartável, testes de política Deno sem chamadas externas, navegador responsive e bridge entre compilador Deno e transações SQL.

## 2. O que permanece explicitamente desativado

1. Nenhuma alteração em `main`, nenhum merge de PR, nenhuma migração SQL deste pack aplicada em produção e nenhum deploy/cron do novo worker.
2. Nenhum envio da Meta, e-mail ou cobrança real. O atual WhatsApp e o SDR IA legados continuam com ownership original.
3. O planejador live deste PR só emite `crm_task` e `crm_stage_change`. **Não há geração live homologada de ações WhatsApp/e-mail pela nova engine**, mesmo que o executor Meta já esteja preparado para futura integração.
4. Esperas e disparos de IA não são liberados em modo live até o scheduler, reconciliação de consentimento e instrumentos de rollback terem homologação específica.
5. Os 47 IDs de aceitação do ZIP estão mapeados em evidências isoladas da etapa anterior; não equivale a 47 testes live com provedores.
6. Meta: aprovar o texto não é opt-in de marketing. A tabela de evidências de consentimento não autoriza inserção por browser, e nenhum registro de consentimento deve ser presumido.

## 3. Gates obrigatórios para publicação operacional futura

- Revisar cada SQL `*.preview.sql` e converter em migrações auditadas, somente após revisão de DDL, ACL/RLS, índices e assinaturas existentes.
- Confirmar backup e reversão do banco, versão do frontend, Edge Functions e scripts da integração legada.
- Validar que o PR #79 consolidado é a base correta, sem duplicar a PR #73; resolver conflitos e homologar a cadeia antes de um merge controlado.
- Executar CI integral em commit fixo (5/5 jobs verdes), TypeScript/Deno, browser e PostgreSQL com relatórios, e revalidar contra o schema hospedado sem mudanças de produção.
- Verificar contas, números, permissões de API e estados de templates direto do provedor; provar opt-in e políticas de frequência. **Nenhum template de marketing pode ser enviado com consentimento desconhecido.**
- Preparar canal por canal com **um único proprietário**; desligar o dispatcher legado apenas quando a ação substituta estiver pronta, reversível e aprovada. Ativar primeiro em canário não financeiro.
- Testar situações de queda/timeout, reconciliação de recibos, takeover humano, opt-out, reentrada, entrega duplicada, custo real/latência e rollback completo.
- Liberar `AUTOMATION_*_ENABLED` e configurar cron apenas sob gate operacional explícito, nunca por instalação/merge.
- Registrar evidências live dos 47 IDs relevantes, conforme aplicabilidade, antes de declarar 100% operacional.

## 4. Critério de término

**Concluído tecnicamente nesta PR** significa código e testes isolados verificados no SHA final. **Não** significa produção ativa, cliente contatado ou integração live comprovada. Um runner verde não substitui homologação dos provedores.

Para auditar a branch, executar o workflow `.github/workflows/qa-oryneo-automations.yml` e consultar o run associado ao SHA atual do PR #80. Se falhar qualquer job, manter DRAFT e não ativar.

## 5. Rollback e interlocks

- `automation_runtime_settings.mode='disabled'` e `emergency_stop=true`: estado seguro.
- Reversão de ownership primeiro, observando a reconciliação de mensagens incertas; **nunca** executar automaticamente duas rotas de envio para o mesmo canal.
- A confirmação de uma mensagem já aceita pelo provedor deve permanecer possível mesmo depois da parada; nunca reenviar por ausência de ack local.
- Não sobrescrever versões publicadas, originais do ZIP, dicionário SDR ou os templates Meta existentes.
