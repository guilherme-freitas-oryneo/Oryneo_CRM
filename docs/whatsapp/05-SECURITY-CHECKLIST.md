# Segurança do futuro canal WhatsApp

Data: 2026-10-24. Estado: **itens de liberação, não aprovação**.

| Controle | Estado | Evidência ou teste exigido antes de ativar |
| --- | --- | --- |
| Segredos Meta no servidor | BLOQUEADO | OAuth/ativos não verificados; criar secrets somente no ambiente certo e provar ausência no bundle/log. |
| GET verification | PARCIAL | `verifyChallenge` testado localmente; falta rota HTTP real e token de verificação em secret. |
| POST HMAC | PARCIAL | `verifyPostSignature` testado com bytes brutos sintéticos; falta handler que leia `request.arrayBuffer()` antes de parsing, compare assinatura e rejeite 401 sem registrar conteúdo. |
| Persistência/deduplicação | NÃO INICIADO | Inbox transacional, chave por provider/account/event ID, replay e dead-letter; testar duplicatas e falha entre ACK/processamento. |
| Autorização de envio | PARCIAL | Política pura testada; falta leitura fresca e transacional de lock/opt-out/consentimento/janela no momento da emissão. |
| Acesso de operador e RLS | NÃO INICIADO | `crm_members` só tem `user_id`; definir personas e escopo real, então provar que outro operador/equipe não lê conversa ou mídia indevida. |
| Storage de mídia | NÃO INICIADO | Buckets privados, URL curta, MIME/size e autorização por objeto; nenhum upload WhatsApp foi criado. |
| Envio real e janela 24h | BLOQUEADO | Teste somente com conta/número/destinatário autorizados após leitura Meta e revisão de políticas atuais. |
| Logs e LGPD | NÃO INICIADO | Redigir payload, telefone e conteúdo; retenção/apagamento compatíveis com política ORYNEO. |

Uma função pura testada não protege o runtime até ser chamada no limite de confiança. Este PR draft não altera produção.
