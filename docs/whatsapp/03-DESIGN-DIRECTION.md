# Direção visual para a futura inbox ORYNEO

Data: 2026-10-24 UTC. Fonte: README do Brand Kit oficial v1.1 no Drive ORYNEO, atualizado em 2026-10-11, e assets presentes no repositório do CRM. Ainda não há mockup ou UI WhatsApp aprovada.

- Manual institucional vigente: `ORYNEO_Brand_System_v1_1_CORRIGIDO.pdf`, na pasta `01_Brand_System/`; prancha visual de referência: `05_Reference/ORYNEO_Direcao_Visual_Aprovada_MASTER.png` no Brand Kit.
- Para lockup/wordmark, usar PNGs aprovados. O Brand Kit informa que não há master vetorial autêntico aprovado para essas variantes; não reconstruir letras com fonte ou SVG aproximado.
- Para símbolo e Y isolado, os SVGs aprovados podem ser usados. Inter é a família de produção indicada; ORYNEO Sans Draft é experimental e não está homologada para produção.
- O repositório contém `public/oryneo-wordmark*.png`, `public/oryneo-symbol.svg` e tokens CSS existentes. Qualquer componente novo deverá comparar esses arquivos com o acervo oficial antes de usá-los; não assumir equivalência só pelo nome.
- Direção funcional: lista de conversas, thread e painel de contexto somente quando houver backend real; estados de loading, sem permissão, desconectado e falha devem refletir recursos efetivos. Não exibir “conectado” antes de health verificado.
- Responsividade e WCAG 2.2 AA serão validadas na interface implementada em desktop/mobile. Nenhum layout foi criado neste lote. O rebranding da landing page está fora de escopo.

## Especificação da central de conversas

**Intenção visual:** sóbria, rápida de ler, densa onde há operação e espaçosa onde há decisão. Continuar a navegação lateral escura do CRM; dentro do módulo usar superfícies claras, Inter do Brand Kit, bordas discretas, azul ORYNEO para ações e cores semânticas apenas para estados reais. Evitar imitar o WhatsApp Web, gradientes decorativos ou um conjunto de cartões genéricos.

### Estrutura por largura

- **Desktop amplo:** navegação existente (216 px), lista de conversas (320–360 px), thread flexível (mínimo confortável de 440 px) e contexto do lead em painel lateral (280–320 px) recolhível. Cabeçalho do módulo mostra canal/qualidade real, fila pendente e atualização recente.
- **Desktop compacto/tablet:** contexto abre como painel lateral sobre a thread; lista e thread permanecem lado a lado enquanto couberem sem comprimir o compositor.
- **Celular:** lista → thread → contexto em telas sequenciais com volta explícita. Cabeçalho e compositor permanecem utilizáveis com teclado virtual e safe areas. Não reduzir três colunas até ficarem ilegíveis.

### Hierarquia funcional

1. **Lista:** busca, filtros Todos / Não lidos / Em revisão / Em atendimento / Resolvidas, nome/identidade, prévia sanitizada, horário, não lidas, responsável e marcador de estado. Paginação e resultado vazio distinto de erro de conexão.
2. **Thread:** cabeçalho com contato, número/canal, dono, vínculo com oportunidade e estado SDR/humano. Mensagens agrupadas por dia, direção inequivocamente marcada, hora e confirmação `enviando / enviado / entregue / lido / falhou` apenas quando persistida pelo backend. Mídia privada com carregamento, erro, alternativa textual e autorização própria.
3. **Compositor:** campo acessível, anexos e template em fluxo guiado. Antes de permitir envio, consultar política do servidor: janela de atendimento, consentimento, template aprovado, permissão e lock. Bloqueio explica a causa e a ação disponível; não sugerir que o cliente pode destravar um opt-out. Falha de envio preserva rascunho e mostra retry seguro com a mesma chave de idempotência.
4. **Contexto:** oportunidade do CRM, estágio, próxima ação, origem do lead, consentimento e histórico de atribuições/handoff. Vincular contato requer confirmação quando houver homônimos ou telefones ambíguos; não criar oportunidade automaticamente por cada inbound.

### Estados obrigatórios

- `não configurado`: explicar que não há app/número oficial, sem mostrar conversas fictícias ou status “online”.
- `conectado`, `sincronizando`, `degradado`, `fila pendente`, `falha`: derivados de health e backlog reais, com horário da última confirmação.
- `review`, `human_locked`, `opt_out`, `fora da janela`, `resolvida`: rótulo persistido, causa legível e controles condicionados à permissão. `human_locked` deve continuar após refresh e bloquear SDR no servidor.
- `carregando`, `sem resultados`, `sem permissão`, `offline` e `erro`: cada um com ação de recuperação adequada. A UI nunca converte sozinha `enviado` em `entregue` nem `lido`.

### Integração com o CRM atual

- Criar item **WhatsApp** em Comercial, ao lado de E-mail, somente quando houver API de leitura e RLS testadas; preservar a ação externa `wa.me` até homologação do canal oficial.
- Abrir conversa a partir do card do lead por identidade de canal/contato, com resolução server-side e dedupe; se não houver canal configurado, manter o fluxo externo atual.
- Reusar linguagem de navegação, ícones e foco do CRM. O módulo terá CSS próprio e componentes pequenos; não duplicar a lógica de e-mail, cujos conceitos de pasta/assunto não se aplicam a chat.

**Status:** especificação e [protótipo visual isolado](prototype/README.md), sem UI publicada. O protótipo usa dados sintéticos e envio desativado; passou por inspeção visual e interação em 390/768/1024/1440 px. A validação do produto depende de backend com eventos reais, teste em 375 px, teclado virtual, leitor de tela e sessão autenticada.
