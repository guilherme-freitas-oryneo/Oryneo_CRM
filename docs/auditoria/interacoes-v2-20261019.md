# Matriz de evidências e gaps — 19/10/2026

Fonte deste checkpoint: GitHub PR #37 e workflows `39229276278`/`39229276367`; repositório no SHA `c91b231bc87a69ddb86afeeeeca5d70f3b52122a`; leitura das funções e migrations do Supabase `ucikrafwfzamxvweuvgk`; consultas agregadas SQL; leitura das contas Stripe sandbox `acct_1UQ90aCi4hhgz3b9` e LIVE `acct_1UQ90LCY6VeI5KIZ`. Nenhuma transação real nem envio externo foi disparado para esta coleta.

Referências de escopo recuperadas no Drive: [plano PM50 E01–E45/F01–F05](https://docs.google.com/document/d/1SA1tqQ-GlnHLv8tmaGZACth6NhKzvkatRgn27Nus1wY/edit), [controle de release de 16/10](https://docs.google.com/document/d/1_ErvSzCFy-yYjc5JzTr-quQYp03NucPsb6Ro_JdvN3k/edit), [inventário Canva](https://docs.google.com/document/d/1Sl3l05bOKOzpk7PP_ps3NqgH5yvGAQJF1Ntt5bw7Jjc/edit) e [índice de estudos 45/45](https://docs.google.com/document/d/1eof4uFt4l1TP6btK31S74R16Hp7rPYqSEoCX9I4D-S4/edit). Estes documentos são históricos e distinguem estudo visual, HTML, gatilho, envio e aceite. Não foram usados para inferir homologação atual.

| Interação/gate | Evidência positiva | Falta para homologação |
| --- | --- | --- |
| E13, boas-vindas pós-pagamento | Código de fulfillment no webhook; PR #29 ainda aberta | Reconciliar falha da renovação de tráfego e provar envio após pagamento confirmado sem duplicidade |
| E14/E15, primeiro contato | PR #30 integrada; teste de template e MIME presente | Homologação controlada em Apple Mail, Gmail e Outlook e confronto com Canva/Drive |
| E16, confirmação de entrada | PR #31 integrada; worker/outbox implantados; 1 pendente, 11 suprimidos | Cron desativado; teste controlado de renderização, retry e observabilidade antes da ativação |
| E01–E12 e E17–E45 | Definição e gatilho previstos no PM50; estudos 45/45 indexados no Drive | Confrontar aprovações, templates, eventos e aceites atuais por interação; não atribuir estado por inferência |
| Checkout direto | PRs #33–#35 integradas; PR #37 aberta; 24 combinações exercitadas por teste de catálogo | Métodos cartão/Pix/boleto, assinatura, renovação, expiração e reembolso E2E ainda sem evidência suficiente |
| Webhook test/LIVE | Endpoint LIVE habilitado para 8 eventos; segredo LIVE no Vault; funções publicadas correspondem ao head #37 | CI remoto do código corrigido, reconciliação financeira controlada e replay/duplicidade por ambiente |
| Consulta pública | PR #28 integrada; estado `paid` gravado por webhook | Verificação E2E dos métodos assíncronos |
| Proposta, implantação, aprovação LP, portal, saída | Rotas e Edge Functions existem no repositório | Evidência de identidade, isolamento, links, permissões, documentos, mobile e operação real por jornada |

## Gaps priorizados

- **P0 resolvido no código** — PR #37 integrada em `59552bf` após checks verdes. O bundle Edge em execução ainda é a versão anterior às correções de tipagem, por isso qualquer futuro redeploy deve usar a main atual e comparar o pacote completo.
- **P0** — Checkout LIVE financeiro não homologado: 0 sessões, 0 assinaturas, 0 pedidos e 0 eventos LIVE observados. Não liberar comercialização irrestrita ou produzir cobrança real para testar.
- **P0** — E13 versus renovação de tráfego permanece na PR #29; precisa prova de que falha de renovação não suprime boas-vindas de um pedido pago.
- **P1** — E16 pendente e cron inativo; falta renderização em três clientes e homologação controlada do worker/retry. Preservar 11 históricos suprimidos.
- **P1** — Pix/boleto, renovação mensal/anual/trimestral, duplicatas, retries, expirados, estornos e cancelamentos sem cobertura E2E documentada.
- **P1** — ZIP original, relatório de gaps, runbook e conversa anterior indisponíveis. PM50 oferece denominador 50 e permite dizer que 0/50 tem aceite E2E integral comprovado neste checkpoint; não permite converter os ~65% externos em progresso de implementação comparável.
- **P2** — README e documentos antigos contêm checkpoints históricos; reconciliar com este mapa antes de usá-los para operação.

Rollback seguro: preservar migration aditiva e funções atuais; qualquer reversão de Edge Function exige comparar o pacote completo publicado e o SHA de origem antes de substituir. Não reverter estados financeiros nem suprimidos por script genérico.
