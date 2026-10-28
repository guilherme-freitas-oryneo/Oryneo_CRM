# Caixa de e-mail ORYNEO — design

## Objetivo

Adicionar ao CRM ORYNEO uma caixa operacional completa para `contato@oryneo.com.br`, usando o Supabase existente como backend e o GitHub Pages como frontend. A caixa deve enviar imediatamente, receber e reconciliar alterações no máximo a cada minuto, continuar consistente após falhas e nunca expor a credencial do e-mail ao navegador, ao bundle ou ao GitHub.

## Arquitetura escolhida

O frontend React permanece estático. Dados normalizados de e-mail ficam no Postgres com RLS; anexos ficam em um bucket privado; alterações chegam à interface por Supabase Realtime. Duas Edge Functions concentram todo acesso ao provedor:

- `mail-sync`: processo interno chamado pelo Supabase Cron a cada minuto. Conecta por TLS ao IMAP 993, descobre pastas, importa mensagens em lotes, reconcilia flags/localizações e registra telemetria. A função não aceita usuários; valida um segredo interno antes de qualquer trabalho.
- `mail-api`: endpoint autenticado do CRM para enviar, salvar rascunhos, responder, encaminhar, mover, arquivar, marcar, excluir e obter anexos. Confirma a sessão e a associação em `crm_members` antes de acessar a caixa.

SMTP usa exclusivamente TLS na porta 465, porque a plataforma Supabase bloqueia saída pelas portas 25 e 587. O envio cria um `Message-ID` determinístico, usa uma chave de idempotência e confirma/repõe a mensagem na pasta Enviados, evitando duplicação em retries. IMAP e SMTP serão implementados sobre conexões TLS do Deno; parsing MIME usa dependência compatível com Web/Deno e fixada por versão.

## Modelo de dados

- `crm_mailboxes`: identidade e configuração não secreta da caixa.
- `crm_mail_folders`: nome remoto, uso especial, `UIDVALIDITY`, cursor de sincronização e contadores.
- `crm_mail_threads`: agrupamento por `References`, `In-Reply-To`, `Message-ID` e assunto normalizado como fallback.
- `crm_mail_messages`: cabeçalhos, participantes, texto, HTML, resumo, direção, datas e estado de processamento.
- `crm_mail_locations`: UID e flags de uma mensagem em cada pasta; separa a mensagem de suas cópias/movimentos IMAP.
- `crm_mail_attachments`: metadados e caminho privado no Storage.
- `crm_mail_drafts`: rascunhos locais/IMAP com autosave e controle de revisão.
- `crm_mail_outbox`: envios idempotentes com estados `pending`, `sending`, `sent` e `failed`.
- `crm_mail_deal_links`: associação automática ou manual entre mensagem e oportunidade.
- `crm_mail_sync_runs`: início, fim, contadores e erro sanitizado de cada ciclo.

Todas as tabelas expostas terão RLS e acesso restrito a membros do CRM. Escritas remotas passam pelas Edge Functions; o frontend recebe apenas leitura e operações explicitamente permitidas. As novas tabelas receberão `GRANT` explícito porque o Supabase deixará de expor tabelas novas automaticamente. Funções privilegiadas terão `EXECUTE` revogado de `PUBLIC`, `anon` e `authenticated` e concedido apenas a `service_role`.

A senha ficará no Supabase Vault. Uma função privilegiada, acessível somente à `service_role`, entregará a credencial à Edge Function. O segredo do Cron ficará em Vault; apenas seu hash ficará na configuração interna consultada pela função. Nenhum segredo entra na migração versionada, nos logs ou nas respostas.

## Sincronização e consistência

1. A primeira execução descobre as pastas e seus atributos especiais, importa todo o histórico progressivamente e dá prioridade à Caixa de entrada e aos itens mais recentes.
2. Cada pasta mantém `UIDVALIDITY` e cursor. Mensagens são únicas por identidade MIME/conteúdo; localizações são únicas por pasta, `UIDVALIDITY` e UID.
3. Novas mensagens são buscadas em lotes limitados. Um lote confirmado avança o cursor na mesma transação lógica; uma falha mantém o ponto recuperável.
4. Flags e movimentos são reconciliados nos dois sentidos. Ações no CRM só atualizam o estado local após confirmação IMAP; mudanças feitas no iPhone/webmail aparecem no ciclo seguinte.
5. Mudança de `UIDVALIDITY` invalida apenas as localizações daquela pasta e inicia reconstrução, preservando as mensagens deduplicadas.
6. Falhas temporárias usam retry com backoff, lock por caixa e telemetria sanitizada. Execuções sobrepostas são ignoradas com segurança.
7. O Realtime invalida/refaz consultas da interface; não substitui o IMAP como fonte de verdade.

## Experiência da caixa

O novo item **E-mail** ocupa o espaço reservado entre Pipeline e Atividades. No desktop, a tela usa três painéis: pastas, lista de conversas e leitura. Em telas médias usa dois painéis; no celular cada nível ocupa a tela inteira com navegação de retorno.

Características inspiradas em Gmail, Outlook, Superhuman e Front:

- pastas Caixa de entrada, Favoritos, Enviados, Rascunhos, Arquivados, Spam e Lixeira, com contadores;
- lista compacta com remetente, assunto, preview, anexos, data, não lido e estrela;
- conversa agrupada, participantes recolhíveis e ações responder/encaminhar;
- composição com Para, Cc/Cco, assunto, editor, anexos e autosave;
- busca textual paginada e filtros por pasta, não lido, favorito, anexo e oportunidade;
- atalhos essenciais, estados vazios, skeletons, mensagens de erro acionáveis e indicador de última sincronização;
- vínculo automático por correspondência exata de e-mail com oportunidades, mais vínculo manual;
- ação para abrir a oportunidade associada sem perder o contexto da conversa.

HTML recebido é sanitizado e exibido em contexto isolado. Imagens remotas ficam bloqueadas inicialmente para impedir rastreamento; o usuário pode liberá-las por mensagem. Links externos são tratados como conteúdo não confiável. Anexos são servidos por URL assinada de curta duração.

## Busca e desempenho

A listagem é paginada no servidor por cursor, nunca carrega toda a caixa no navegador. Postgres mantém índices para pasta/flags/data, thread/data, endereços normalizados e busca textual. Corpos e anexos são importados em lotes com limites de tamanho; mensagens maiores continuam visíveis por metadados e podem ser baixadas sob demanda quando suportado.

## Erros e observabilidade

A interface distingue: offline, sincronização em andamento, autenticação recusada pelo provedor, erro temporário e envio falho. Erros persistidos não contêm senha, token, corpo ou cabeçalhos sensíveis. O rodapé informa última sincronização válida e backlog. O envio falho permanece recuperável no outbox e pode ser tentado novamente sem criar outro e-mail.

## Testes e homologação

- testes unitários do parser de protocolo, framing de literais IMAP, normalização, threading, idempotência, MIME e sanitização;
- testes de banco para RLS, grants, constraints, deduplicação, busca e funções privilegiadas;
- testes de componentes e fluxo responsivo para pastas, leitura, busca, composição e erros;
- teste real controlado da Edge Function contra a Hostinger: autenticar, sincronizar, enviar para a própria caixa, confirmar em Enviados e receber de volta sem duplicidade;
- build, linters/testes, Advisors de segurança/desempenho, logs das funções, Cron e smoke do GitHub Pages após o deploy.

## Critérios de aceite

1. Nenhuma credencial aparece no repositório, bundle, rede do navegador, banco exposto ou logs.
2. Um membro autenticado lê e opera a caixa; usuário anônimo ou autenticado sem associação não lê nem altera nada.
3. Mensagem recebida aparece no CRM em até 90 segundos em operação normal; envio retorna confirmação e aparece em Enviados sem duplicidade.
4. Lido/não lido, estrela, arquivo, spam, lixeira e movimentos convergem entre CRM, iPhone e webmail.
5. Threads, anexos, Unicode, HTML e respostas mantêm conteúdo e cabeçalhos corretos.
6. A interface funciona em desktop e celular, mantém o padrão visual ORYNEO e não degrada Pipeline/Atividades.
7. Após falha ou reinício, a sincronização retoma do cursor seguro e o usuário vê o estado real.

## Fora do escopo inicial

Múltiplas caixas, calendário, campanhas, automações de marketing, resposta por IA e endereços aliases administráveis. O modelo aceita expansão futura sem incluir essas funções na primeira homologação.
