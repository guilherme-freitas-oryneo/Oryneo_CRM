# Direção visual para a futura inbox ORYNEO

Data: 2026-10-24 UTC. Fonte: README do Brand Kit oficial v1.1 no Drive ORYNEO, atualizado em 2026-10-11, e assets presentes no repositório do CRM. Ainda não há mockup ou UI WhatsApp aprovada.

- Manual institucional vigente: `ORYNEO_Brand_System_v1_1_CORRIGIDO.pdf`, na pasta `01_Brand_System/`; prancha visual de referência: `05_Reference/ORYNEO_Direcao_Visual_Aprovada_MASTER.png` no Brand Kit.
- Para lockup/wordmark, usar PNGs aprovados. O Brand Kit informa que não há master vetorial autêntico aprovado para essas variantes; não reconstruir letras com fonte ou SVG aproximado.
- Para símbolo e Y isolado, os SVGs aprovados podem ser usados. Inter é a família de produção indicada; ORYNEO Sans Draft é experimental e não está homologada para produção.
- O repositório contém `public/oryneo-wordmark*.png`, `public/oryneo-symbol.svg` e tokens CSS existentes. Qualquer componente novo deverá comparar esses arquivos com o acervo oficial antes de usá-los; não assumir equivalência só pelo nome.
- Direção funcional: lista de conversas, thread e painel de contexto somente quando houver backend real; estados de loading, sem permissão, desconectado e falha devem refletir recursos efetivos. Não exibir “conectado” antes de health verificado.
- Responsividade e WCAG 2.2 AA serão validadas na interface implementada em desktop/mobile. Nenhum layout foi criado neste lote. O rebranding da landing page está fora de escopo.
