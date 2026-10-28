# ORYNEO / Playbook Comercial — homologação antes do deploy

## Escopo implementado nesta branch
- 64 slides executivos em 5 partes, com conteúdo institucional adaptado à oferta ORYNEO.
- Tela de espera, navegação manual, player automático opcional (22 segundos/slide), atalhos, tela cheia e progresso de leitura.
- Marca-texto com três cores, notas vinculadas a trechos e visualização de comentários compartilhados.
- Revisão de notas, exclusão própria e indicador de trecho alterado após nova versão editorial.
- Integração em menu `CONHECIMENTO > Playbook Comercial` por carregamento lazy.
- Migração SQL versionada com RLS e controle individual de progresso.
- Identidade a partir do Brand Kit v1.1 oficial, obtido do Google Drive ORYNEO em 28/10/2026.

## Origem e integridade dos ativos
- `src/playbook/brandAssets.ts` incorpora arte oficial, sem recriar geometria ou gerar novo wordmark.
- Wordmark de superfície clara: `oryneo_wordmark_master_800w.png` (Drive file: `1d4DxYziJZyTEr63vqZ_GhTF0WSIoBDIn`).
- Wordmark de superfície escura: `oryneo_wordmark_mono_reverse_800w.png` (Drive file: `1YU8mPsHqQ9Yq5xnCmJ2Jai5YqhD3ARjS`).
- Símbolo e Y vetoriais originais: `oryneo_symbol_app.svg` e `oryneo_y_mark.svg` (Drive files `1_fw72wUHKK5ta5FaR7uMdpyU4mskBRU6`, `1xyYjBbOd2nlOQtImGxuaJsylQuWHcaQt`).
- Cores do Brand Kit: graphite `#0F1115`, indigo `#4F6BFF`, off-white `#F8F7F4`. Fonte de produção: Inter.
- Os ativos estão embutidos como data URLs exclusivamente para preservação offline e isolamento; não há dependência de CDN ou redistribuição de fontes.

## Contrato de conteúdo
- `src/playbook/content.ts` guarda textos, metadados, visuais e referências; não são dados financeiros de produção.
- Identificadores `01`–`64` são estáveis; alterações que impactem trechos deverão atualizar `CONTENT_VERSION`.
- As marcações guardam slide, bloco, início, fim e texto exato. Se um trecho mudar, a nota permanece mas o destaque não é aplicado incorretamente.
- As condições comerciais citadas são referências da proposta vigente para piloto; confirmar com catálogo/checkout/contrato antes de usar em vendas.
- Cursos e métodos citados são referências para aprendizagem, não certificações concedidas à ORYNEO.

## Segurança e privacidade
- `crm_playbook_annotations`: RLS — leitura própria e de notas `team` por membro autenticado; escrita e exclusão somente pelo autor.
- `crm_playbook_progress`: RLS — leitura e escrita estritamente por usuário.
- Sem chamada service-role no navegador; sem scripts externos embutidos ou HTML arbitrário.
- Nenhuma alteração na produção até migração, code review, smoke test e aprovação formal.
- O usuário escolhe `private` por padrão ao criar uma nota. Não compartilhar implicitamente.

## Cenários de aceite
1. O menu aparece e abre a tela de espera sem regressão nos menus atuais.
2. A capa mostra wordmark branco oficial, sem distorção e com posição consistente.
3. Iniciar, voltar, avançar, pausar, retomar e fullscreen funcionam por mouse, toque e teclado.
4. Todos os 64 slides carregam sem corte perceptível em 375px, 768px, 1440px e tela cheia.
5. O sistema respeita `prefers-reduced-motion`.
6. Após migração em ambiente seguro, uma marcação privada sobrevive ao reload e só o autor a vê.
7. Ao compartilhar uma marcação, outro membro autenticado a lê, mas não consegue editá-la/excluí-la.
8. Ao editar/excluir como autor, o estado de tela e banco continuam coerentes.
9. Um trecho que mudou na versão seguinte permanece como nota mas deixa de ser destacado sem correspondência.
10. O último slide lido é restaurado corretamente após novo login.
11. O pipeline, WhatsApp, IA e SDR, e-mail, pagamentos e fluxos críticos existentes seguem funcionando.
12. Testes de TypeScript, Vitest, CI, RLS e revisão de acessibilidade devem ser aprovados.

## Pendências / gates obrigatórios
- Executar a migração em ambiente de homologação e rodar testes de acesso com dois usuários distintos.
- Validar visualmente desktop/mobile, seleção de texto e comportamento do modo tela cheia.
- Revisar conteúdo, condições comerciais e links de referências com responsável editorial.
- Confirmar que CI está verde e obter aprovação de revisão de código.
- **Não fazer merge, não publicar nem aplicar migration no Supabase de produção neste PR.**

## Fontes de leitura
- https://www.huthwaiteinternational.com/spin-selling/
- https://winningbydesign.com/spiced-framework/
- https://meddicc.com/resources
- https://academy.hubspot.com/courses/inbound-sales
- https://trailhead.salesforce.com/pt-BR/content/learn/modules/customer-centric-discovery-strategies
- https://www.gong.io/blog/best-discovery-call-tips
- https://business.whatsapp.com/policy


## Homologação técnica atualizada — 28/10/2026

- Conteúdo: 64 slides, cinco partes, matrizes e fluxos; fontes referenciadas no próprio módulo.
- Identidade: wordmarks PNG e símbolos SVG originais do Drive/Brand Kit v1.1; tagline e frase-chave conferidas no `VOICE_AND_COPY.md` oficial.
- Testes de navegador: Chromium desktop/tablet/mobile e WebKit mobile; apresentação, navegação, autoplay, retomada, marcações, notas e nenhuma chamada ao Supabase de produção.
- Auditoria integral de 64 slides no Chromium desktop e mobile com verificações de transbordamento, área 'Decisão em campo' e rodapé.
- RLS: execução com PostgreSQL 16 descartável, dois usuários, terceiro não membro e papel anon. Leitura compartilhada permitida apenas a membros, escrita limitada ao autor, progresso individual.
- Verificação de catálogo: mensalidades e implantação coincidem com `supabase/functions/_shared/billing/catalog.ts`.
- Melhoria de robustez: erro de sincronização visível no cabeçalho, com tentativa explícita de recuperação.
- QA adicional: seleção real de trecho de texto em navegador, além do atalho para destacar a decisão.

### Limites do aceite

- **Não foi aplicado SQL no projeto de produção `ucikrafwfzamxvweuvgk`.** Consultada ausência das tabelas `crm_playbook_annotations` e `crm_playbook_progress`.
- **Nenhuma branch de staging disponível.** A tentativa de criar a branch foi bloqueada pela exigência de confirmação de custo do Supabase; não devemos contornar essa autorização.
- **Não há teste de persistência com GoTrue/PostgREST reais em projeto de staging.** Os testes existentes cobrem RLS SQL e UI com mock, separadamente.
- **Não fazer merge enquanto essa validação integrada não for concluída**: o workflow `publicar-crm-pages.yml` publica automaticamente o CRM em produção a cada push na main que modifique `src/**`.
- Recomenda-se revisão editorial por responsável antes do deploy, inclusive dos limites comerciais e franquias citados.

**Status:** homologação técnica automatizada aprovada no commit indicado no PR, integração staging pendente e produção protegida.
