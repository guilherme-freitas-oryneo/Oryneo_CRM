# ORYNEO CRM — Pipeline de Oportunidades

## Objetivo

Entregar o primeiro corte funcional do CRM ORYNEO: autenticação segura e um pipeline comercial persistente, fiel ao Figma aprovado, que organize oportunidades desde a entrada até a negociação sem perder o próximo passo.

## Referências aprovadas

- Figma: `ORYNEO CRM — Pipeline de Oportunidades`, arquivo `xIRj2eI4Kt14xgEAjlKEmp`, página `3:2`.
- Frames de implementação: `3:10` (pipeline principal) e `3:382` (configuração das etapas).
- Identidade: grafite `#0F1115`, índigo `#4F6BFF`, off-white `#F8F7F4`, slate `#6B7280`, cinza `#A1A1AA`, cinza-claro `#E5E7EB` e tipografia Inter.
- Marca publicada: reutilizar o wordmark oficial da landing page V32. Não usar os logos `CANDIDATE_*` do Brand Kit v0.9.

## Escopo funcional

### Autenticação e organização

- Login e encerramento de sessão por e-mail e senha usando Supabase Auth.
- Cada usuário pertence a uma organização; toda consulta é limitada à organização ativa.
- O primeiro usuário cria automaticamente perfil, organização, associação, pipeline e etapas padrão.
- Não haverá cadastro público de usuários na primeira entrega. Novos usuários serão criados administrativamente no Supabase.

### Pipeline

- Exibir o pipeline `Pipeline comercial` com cinco etapas padrão, nesta ordem:
  1. Nova oportunidade — probabilidade 10%, entrada padrão da landing.
  2. Contato pendente — probabilidade 20%, SLA padrão de 2 horas.
  3. Em qualificação — probabilidade 30%.
  4. Proposta apresentada — probabilidade 60%.
  5. Em negociação — probabilidade 80%.
- Cards mostram origem, empresa, contato, valor, temperatura, responsável, próxima atividade e tempo desde a última atualização.
- Arrastar um card entre etapas persiste a nova etapa e posição, registra atividade e atualiza métricas.
- Criar e editar oportunidade em painel lateral. Campos obrigatórios: empresa, contato e etapa. Valor é não negativo; próxima ação e data são opcionais.
- Pesquisa e filtros atuam sobre empresa, contato, origem, responsável, temperatura e presença de próximo passo.

### Métricas

- Pipeline total: soma dos valores das oportunidades abertas.
- Previsão: soma de `valor × probabilidade da etapa`.
- Oportunidades: quantidade de oportunidades abertas.
- Sem próximo passo: oportunidades abertas sem descrição ou data da próxima atividade.
- Variações percentuais exibidas no Figma não serão inventadas; ficam ausentes até existir histórico comparável.

### Configuração de etapas

- Abrir painel lateral igual ao frame `3:382`.
- Criar, renomear, recolorir, alterar probabilidade e SLA e reordenar etapas.
- A ordem é persistida por posições inteiras normalizadas.
- Excluir uma etapa com oportunidades exige escolher uma etapa de destino antes da operação.
- A primeira etapa pode receber oportunidades capturadas pela landing, mas a integração pública da landing fica fora deste corte; apenas o contrato de dados é preparado.

### Resultados

- Ganho e perdido são resultados da oportunidade, não colunas fixas do pipeline.
- Marcar como ganha ou perdida remove a oportunidade das colunas abertas, preserva histórico e valor.
- A interface permite reabrir uma oportunidade encerrada para uma etapa escolhida.

## Arquitetura

### Frontend

- React 19, Vite e TypeScript.
- React Router para `/login` e `/pipeline`.
- TanStack Query para cache, carregamento e mutações.
- `@dnd-kit` para mover cards e reordenar etapas com teclado e ponteiro.
- React Hook Form e Zod para formulários e validação.
- Lucide React para ícones; os símbolos textuais do protótipo não serão usados como ícones finais.
- CSS modularizado por tokens e componentes, sem Tailwind. O layout adapta o Figma de 1600 px para desktop e usa rolagem horizontal do Kanban em telas estreitas.

### Supabase

- Tabelas: `profiles`, `organizations`, `organization_members`, `pipelines`, `pipeline_stages`, `opportunities` e `opportunity_activities`.
- Chaves UUID, timestamps UTC e `organization_id` explícito em entidades de negócio.
- Funções SQL transacionais para mover oportunidade, reordenar etapas e excluir etapa com realocação.
- RLS em todas as tabelas de negócio: apenas membros ativos da organização podem ler e alterar seus dados.
- Service-role key nunca é usada no navegador. O frontend aceita somente URL e chave pública/anon via variáveis `VITE_SUPABASE_*` não versionadas.

### Estado e consistência

- A leitura inicial carrega pipeline, etapas e oportunidades da organização ativa.
- Movimentação usa atualização otimista; falha reverte o card e exibe mensagem acionável.
- Mutações invalidam consultas de pipeline e métricas.
- Conflitos de ordenação são resolvidos pelo servidor com posições normalizadas.

## Experiência e acessibilidade

- Reproduzir hierarquia, proporções, superfícies, cores e densidade dos frames do Figma.
- Manter foco visível, navegação por teclado, rótulos acessíveis e contraste adequado.
- Drag-and-drop tem alternativa por menu: `Mover para...`.
- Painéis laterais prendem o foco, fecham com Escape e devolvem foco ao acionador.
- Estados de carregamento, vazio, erro e sem resultados possuem texto e ação útil.

## Segurança

- `.env`, `.env.local`, tokens, senhas e chaves privadas entram no `.gitignore`.
- O repositório mantém apenas `.env.example` com nomes de variáveis, nunca valores reais.
- SQL aplica RLS antes de qualquer dado real ser inserido.
- Toda mutação valida organização, associação e campos no banco, além da validação do frontend.
- O processo de entrega inclui varredura por segredos antes de commit e push.

## Testes e aceite

- Vitest e Testing Library cobrem login, proteção de rota, métricas, filtros, criação/edição e estados de erro.
- Testes de domínio cobrem cálculo de previsão, ausência de próximo passo, ordenação e validação.
- Teste de interação cobre movimento de card com persistência, rollback em erro e alternativa por teclado.
- Testes SQL/Supabase cobrem bootstrap do usuário, RLS entre organizações, realocação na exclusão de etapa e histórico de movimentação.
- Build de produção deve concluir sem erros ou avisos relevantes.
- A tela será comparada visualmente com os screenshots dos frames `3:10` e `3:382` em desktop; responsividade será verificada em larguras menores.

## Entrega e deploy

- Commitar código e migrações no repositório `guilherme-freitas-oryneo/Oryneo_CRM`.
- Workflow do GitHub Actions executa testes e build em push/PR.
- Workflow de GitHub Pages gera a aplicação com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` vindas de GitHub Actions Secrets.
- O deploy só é considerado concluído após confirmar commit remoto, workflow verde e página carregando sem expor segredo privado.

## Fora do escopo deste corte

- Integração pública automática com a landing page.
- Contatos, atividades e relatórios como módulos independentes.
- WhatsApp, IA, transcrição, arquivos, automações e convites de equipe.
- Funis múltiplos na interface, embora o modelo permita adicioná-los depois.
