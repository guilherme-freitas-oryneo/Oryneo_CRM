# Controle do SDR por conversa — design

## Intenção
Permitir que o administrador ligue e desligue o SDR diretamente na conversa do WhatsApp no CRM, sem painel externo e sem alteração manual no banco.

## Comportamento
- O estado aparece no cabeçalho da conversa como `SDR ativo` ou `SDR pausado`.
- Ativar exige uma confirmação explícita de que o contato autorizou o atendimento automatizado. A confirmação registra `consent_granted=true`, muda a conversa para `sdr_active` e enfileira a última mensagem de texto somente se ela estiver dentro da janela de 24 horas.
- Pausar muda a conversa para `review`, preserva o consentimento já registrado e cancela jobs ou envios automáticos ainda aguardando. Um envio já reservado pelo worker pode terminar porque a Meta não oferece cancelamento transacional depois do início do POST.
- Opt-out impede ativação. O modo global de IA continua sendo o segundo disjuntor: uma conversa ativa só responde se o modo global estiver em `auto`.
- O backend exige usuário autenticado e acesso administrativo ao canal. O navegador nunca atualiza a conversa diretamente.
- Toda mudança gera evento de auditoria com ator, estado anterior, estado seguinte e horário, sem conteúdo de mensagens.

## Interface
Controle compacto e textual no cabeçalho, com alvo de toque adequado. Ao solicitar ativação, uma faixa de confirmação aparece abaixo do cabeçalho com `Confirmo e ativar` e `Cancelar`. Durante a operação, o controle fica desabilitado; sucesso atualiza a conversa e falha apresenta mensagem sem ocultar o estado atual.

## Abordagens consideradas
1. Alteração direta pelo Supabase no navegador: rejeitada porque permitiria contornar autorização e cancelamento atômico.
2. Controle apenas em Ajustes Gerais: rejeitado porque o estado é por conversa e ficaria distante do contexto operacional.
3. Ação autenticada no backend e controle contextual: escolhida por manter autorização, auditoria e cancelamento transacional no mesmo fluxo.

## Limites
Não ativa conversas em massa, não altera a configuração global da IA e não modifica billing, propostas, e-mail, pipeline ou landing page. Chamadas ao provedor de IA podem consumir créditos quando uma mensagem elegível chegar após a ativação.
