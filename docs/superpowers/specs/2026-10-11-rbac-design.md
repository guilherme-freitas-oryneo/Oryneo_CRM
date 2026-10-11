# ORYNEO CRM — identidade, papéis e isolamento de dados

## Objetivo e estado encontrado

Cada pessoa entra com sua própria conta Supabase Auth. O UUID autenticado identifica a pessoa para regras aplicadas no PostgreSQL, e um papel persistido no banco determina operações permitidas. A conta `guilherme.freitas@oryneo.com.br`, única entrada atual de `crm_members` e único usuário Auth correspondente, será a administradora inicial. A caixa postal com esse endereço permanece privada da conta administradora até delegação explícita.

Hoje `crm_members` contém apenas `user_id`. As políticas RLS de `crm_records`, `crm_companies` e `crm_events` permitem que qualquer membro leia tudo; `crm_mutate`, `crm_add_note`, `crm_set_action` e `crm_undo` verificam apenas associação. O frontend chama `crm_records.select('*')` e passa o objeto JSON inteiro a `crm_mutate`. Portanto esconder botões ou colunas na interface não protegeria os dados.

O UUID não é uma segunda senha. Supabase Auth valida a sessão; PostgreSQL recebe a identidade e executa autorização por papel e por recurso. Papéis não ficam em `user_metadata`, que o usuário pode editar. Revogação e mudança de papel devem valer na consulta seguinte, consultando `crm_members` no banco, sem depender de JWT antigo.

## Modelo de acesso

Papéis iniciais fixos: `admin`, `commercial`, `support`, `viewer`. Administração é uma responsabilidade de configuração e auditoria; suporte é um papel operacional distinto. A interface mostra uma matriz legível de capacidades, e a administradora atribui papéis, status e oportunidades. Permissões individuais arbitrárias ficam fora deste lote para evitar exceções difíceis de auditar.

| Recurso/ação | Admin | Comercial | Suporte | Leitura |
| --- | --- | --- | --- | --- |
| Diretório, convites, papéis e revogações | Gerencia | Própria conta | Própria conta | Própria conta |
| Etapas, calendário e metas | Gerencia | Lê | Lê | Lê |
| Oportunidades | Todas | Atribuídas | Atribuídas | Atribuídas |
| Valor e proposta comercial | Lê/edita | Lê/edita nas atribuídas | Ocultos | Ocultos |
| Contatos, notas e próxima ação | Todas | Lê/edita nas atribuídas | Lê e registra nas atribuídas | Lê resumo atribuído |
| Caixa de e-mail pessoal | Própria; delegação explícita futura | Nenhuma por padrão | Nenhuma por padrão | Nenhuma |
| Administração de integrações | Gerencia | Nenhuma | Nenhuma | Nenhuma |

Uma oportunidade sem responsável, inclusive a recebida da landing page, é visível apenas à administradora até ser atribuída. Etapas do funil são estrutura compartilhada, sem contatos ou dados privados. O fluxo de atribuição de oportunidades será uma ação administrativa auditada. A política de visibilidade entre colegas depende da resposta do usuário à pergunta já apresentada; o padrão desta especificação é isolamento por responsável.

## Dados e fronteiras de segurança

- Evoluir `crm_members` com `role`, `status`, nome de exibição, e-mail de diretório e carimbos de criação/alteração. Bootstrap por consulta única ao e-mail confirmado em `auth.users`; abortar se a conta ou associação não for única. Nenhum UUID fixo em código.
- Adicionar proprietário da oportunidade como coluna tipada `owner_user_id` em `crm_records`, restrita a `kind='deal'`; etapas não têm proprietário. Não colocar autorização dentro do JSON enviado pelo cliente. Índices por proprietário e registros ativos. Oportunidades históricas ficam sem responsável, sem atribuição inventada.
- A associação de suporte a oportunidade, quando necessária além do responsável comercial, usa tabela de concessões explícitas por usuário e oportunidade. Uma pessoa revogada/inativa perde acesso mesmo que a concessão permaneça no histórico.
- `crm_records.data` hoje contém valor, proposta, contatos e outros campos na mesma coluna JSONB. RLS decide linhas, não partes desse JSON. Antes de permitir suporte/leitura ver oportunidades, revogar SELECT direto da tabela base para `authenticated` e oferecer uma API de leitura que aplica escopo e remove campos financeiros; ou separar os campos financeiros em tabela protegida. A implementação deve escolher uma solução que prove ausência de vazamento por REST, RPC e Edge Function, inclusive em erros e exportações.
- Restringir `crm_events` ao escopo da oportunidade; o detalhe de eventos financeiros precisa da mesma proteção de campos. `crm_companies.profile` pode incluir contatos e QSA e também exige escopo. `crm_history` permanece para auditoria do ator e ganha visão administrativa, sem exposição global.
- Auditar todas as funções `SECURITY DEFINER` existentes. Cada operação deve verificar `auth.uid()`, associação ativa, papel e acesso à oportunidade sob a mesma transação da escrita. `crm_mutate` exige regras diferentes para etapa e oportunidade; `crm_undo` só desfaz se o ator ainda puder alterar aquele registro. Não confiar em papel enviado pela UI.
- `company-enrich` usa service role: sua verificação de associação atual não basta após isolamento. Vincular a solicitação a uma oportunidade visível e verificar autorização antes de usar privilégios de serviço. `lead-intake` cria oportunidades sem proprietário para triagem da administradora.
- A lista de usuários e convites passa por API administrativa no backend. Somente depois de confirmar o papel atual no banco a função usa Auth Admin API; service role nunca chega ao browser. Alteração de papel/status é transacional e auditada. Impedir autopromoção e remoção/rebaixamento do último administrador ativo.

## Experiência no CRM

`Configurações` fica no rodapé da sidebar. Todos os usuários veem `Meu perfil` e suas preferências; apenas admin vê `Equipe e permissões`, `Funil e prazos` e `Integrações`. `Equipe e permissões` mostra nome, e-mail, papel, status e matriz de acesso, permite convite, troca de papel, suspensão e atribuição; não exibe senhas. Botões indisponíveis são acompanhados por enforcement no banco. Usuários de suporte e leitura veem valores/propostas omitidos, sem placeholder que sugira dados zerados.

## Rollout e testes

1. Criar migração aditiva e testes locais de papéis/atribuição; preservar a conta administradora e as oportunidades atuais. Preparar rollback que restaura a política anterior somente se for necessário reverter todo o frontend; não apagar dados nem histórico.
2. Adicionar API de leitura com projeção segura e endurecer RLS/RPC/Edge Functions. Testar acesso autenticado como admin, comercial, suporte, leitura, suspenso e usuário não membro. Testar REST direto, chamada RPC forjada, reatribuição e revogação.
3. Adicionar Configurações e diretório. Usar usuários e oportunidades simulados em QA; não convidar pessoas reais como teste. Publicar backend antes do frontend dependente e verificar a conta administradora na URL pública.
4. Nenhuma caixa postal é compartilhada automaticamente por papel. Permissões de e-mail serão uma integração separada.

## Critérios de aceite

- A administradora atual continua acessando os dois negócios existentes; nenhum dado histórico é sobrescrito.
- Um usuário comum não consegue consultar ou alterar oportunidade de outro por REST ou RPC, mesmo com UUID conhecido. Usuário suspenso perde acesso imediatamente.
- Suporte e leitura não recebem valor, proposta nem detalhes financeiros pela API ou pelos eventos.
- Apenas admin gerencia usuários, etapas, calendário, integrações e atribuições; último admin não pode ser removido ou rebaixado.
- A lista de usuários e a matriz de permissões correspondem às regras reais do backend; erros não revelam dados de terceiros.
