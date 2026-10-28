# ORYNEO — formulário progressivo e primeiro contato por e-mail

Data: 12 de outubro de 2026

## Objetivo

Criar um fluxo dedicado, progressivo e mobile-first para as solicitações comerciais da ORYNEO, integrar suas respostas ao CRM e permitir que Guilherme envie o primeiro e-mail personalizado a partir do lead, sem mover automaticamente a oportunidade de etapa.

O resultado deve:

- reduzir distrações e esforço de preenchimento;
- preservar plano, ciclo, complementos e intenção escolhidos na landing;
- registrar múltiplos canais de aquisição e identificar o principal;
- manter a abordagem founder-led: o primeiro e-mail é enviado por ação humana no CRM;
- usar somente ativos oficiais monocromáticos e a paleta aprovada;
- permanecer funcional em celular, teclado, zoom, leitores de tela e conexões instáveis;
- manter o CRM, a landing e o Supabase retrocompatíveis durante o deploy.

## Estado atual verificado

- A landing pública está no repositório `Oryneo_Landing_Page`, publicado diretamente da branch `main` em `https://guilherme-freitas-oryneo.github.io/Oryneo_Landing_Page/`.
- O CRM está no repositório `Oryneo_CRM`, publicado por GitHub Actions na branch `gh-pages` em `https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/`.
- `oryneo.com.br` e `www.oryneo.com.br` ainda exibem a página de domínio estacionado da Hostinger. O lançamento desta entrega não dependerá da troca de DNS.
- A landing já possui um formulário embutido de quatro etapas e envia leads para a Edge Function `lead-intake`.
- O `lead-intake` atualmente aceita apenas `acquisition_channel` como texto único.
- A política de privacidade ainda descreve o fluxo antigo de abertura do aplicativo de e-mail e precisa ser atualizada.
- O CRM possui caixa postal ativa e sincronizada, mas ainda não possui o botão de primeiro contato personalizado.
- A branch `feat/email-template-previews` contém dois modelos mestres, HTML e texto simples, e oito cenários de prévia.

## Decisão de arquitetura

### Abordagens consideradas

1. **Manter o formulário dentro da landing.** Menor mudança, mas preserva distrações e torna o fluxo mais pesado no celular.
2. **Criar uma rota dedicada no mesmo site.** Escolhida. Mantém origem, confiança e publicação simples, sem depender de DNS novo.
3. **Criar um subdomínio ou uma terceira hospedagem.** Pode ser adotada após o domínio principal sair do estado estacionado, mas hoje acrescentaria DNS, CORS e monitoramento sem melhorar o primeiro lançamento.

### Endereço

A nova página será publicada em:

`https://guilherme-freitas-oryneo.github.io/Oryneo_Landing_Page/comecar/`

Quando `oryneo.com.br` for efetivamente publicado, o endereço canônico desejado será `https://oryneo.com.br/comecar/`, sem alterar o contrato de dados do formulário.

Todos os CTAs comerciais da landing apontarão para a rota dedicada. Parâmetros de seleção e atribuição serão transportados na URL, validados contra listas permitidas e nunca tratados como preço confiável.

## Experiência visual

### Direção

- superfície principal Graphite `#0F1115`;
- texto Off White `#F8F7F4`;
- Indigo `#4F6BFF` apenas para progresso, foco e ações;
- tipografia Inter, com fallback seguro;
- wordmark oficial totalmente branco no cabeçalho;
- nenhum logo ou “Y” colorido;
- painel de pergunta com largura confortável e uma decisão principal por tela.

### Marca d’água

O fundo usará o wordmark oficial monocromático reverso como marca d’água ampliada e parcialmente recortada, com opacidade entre 3% e 5%. O recurso será decorativo, terá `aria-hidden="true"`, não receberá eventos e não poderá reduzir o contraste do conteúdo.

Em telas estreitas, a posição será ajustada para manter o formulário limpo. A página continuará compreensível se a imagem não carregar. Não será criado ou redesenhado um símbolo de marca.

### Interação

- indicador “Etapa X de Y” e barra de progresso real;
- botões Voltar e Continuar previsíveis;
- foco transferido para o título de cada etapa;
- Enter avança somente quando a resposta estiver válida;
- erros aparecem junto ao campo e em região anunciável;
- nenhuma transição obrigatória para compreender o conteúdo;
- estado preservado em `sessionStorage` durante a sessão;
- estado temporário removido após o envio concluído;
- resumo editável antes do envio definitivo.

## Fluxo do formulário

O fluxo terá seis etapas lógicas. Algumas perguntas condicionais aparecem apenas quando necessárias, sem alterar artificialmente o progresso.

### 1. Contato

- nome;
- e-mail obrigatório;
- WhatsApp com DDD;
- consentimento explícito para contato;
- link para a política de privacidade.

O envio ao CRM ainda não ocorre nesta etapa. Os dados permanecem somente na sessão do navegador até a confirmação final. Isso evita criar leads incompletos, armazenar dados sem necessidade ou poluir o pipeline.

### 2. Empresa

- nome da empresa;
- CNPJ obrigatório apenas para a intenção `contract`;
- consulta opcional à BrasilAPI;
- preenchimento manual sempre disponível;
- tamanho da operação comercial.

### 3. Aquisição

Pergunta múltipla: “Por quais canais chegam oportunidades hoje?”

Opções:

- Indicações e parcerias;
- Instagram e Facebook;
- Google;
- Prospecção ativa;
- Portais e marketplaces;
- Loja física e eventos;
- Ainda não temos um canal previsível;
- Outro canal.

Regras:

- pelo menos uma resposta;
- “Ainda não temos um canal previsível” é exclusiva;
- se houver dois ou mais canais específicos, surge a pergunta “Qual deles gera mais oportunidades atualmente?”;
- com apenas um canal, ele se torna o principal automaticamente;
- “Outro canal” pode coexistir; texto livre não será exigido nesta versão.

### 4. Prioridades

- objetivos atuais em seleção múltipla;
- se houver mais de um objetivo, indicação da prioridade principal;
- as opções atuais da landing serão preservadas para retrocompatibilidade.

### 5. Configuração comercial

- intenção: conversar ou contratar;
- plano Start, Growth ou Scale;
- ciclo mensal ou anual;
- landing page e/ou gestão de tráfego;
- valores recalculados no servidor pelo catálogo oficial.

Quando esses dados vierem de um CTA da landing, aparecem preenchidos e editáveis. Parâmetros inválidos são descartados silenciosamente e nunca alteram preços.

### 6. Revisão e envio

- resumo completo e editável;
- aviso de que nenhuma cobrança ocorre na página;
- confirmação única e idempotente;
- sucesso somente após resposta positiva do Supabase;
- falha mantém todos os dados e oferece nova tentativa segura;
- página final informa que a solicitação foi recebida e oferece o link `wa.me` da ORYNEO apenas como alternativa de contato, sem prometer atendimento imediato.

## Contrato de dados

O payload completo continuará usando `request_id` UUID para idempotência e acrescentará:

```json
{
  "acquisition_channels": ["Indicações e parcerias", "Instagram e Facebook"],
  "primary_acquisition_channel": "Indicações e parcerias",
  "goals": ["Organizar contatos e negociações no CRM"],
  "primary_goal": "Organizar contatos e negociações no CRM",
  "attribution": {
    "utm_source": "...",
    "utm_medium": "...",
    "utm_campaign": "...",
    "utm_content": "...",
    "utm_term": "...",
    "referrer": "...",
    "entry_url": "..."
  }
}
```

Compatibilidade:

- `acquisition_channel` continuará sendo aceito pelo backend;
- registros novos gravarão também `acquisition_channel` com o canal principal enquanto o CRM antigo ainda existir;
- `acquisition_channels` será deduplicado, limitado às opções permitidas e terá no máximo oito itens;
- o canal principal deverá pertencer à lista selecionada;
- valores de atribuição serão truncados e sanitizados;
- dados comerciais serão recalculados no servidor.

Não será criada uma tabela de sessões parciais nesta entrega. A persistência parcial ficará restrita ao navegador; somente a solicitação completa e consentida entrará no CRM.

## Pipeline e SLA

As etapas existentes serão renomeadas sem trocar seus IDs, preservando as oportunidades atuais:

1. Diagnóstico pendente;
2. Diagnóstico agendado;
3. Qualificada;
4. Proposta enviada;
5. Em decisão;
6. Ganha;
7. Perdida.

Todo lead novo entra em **Diagnóstico pendente** e recebe a próxima ação “Realizar primeiro contato”. O prazo será calculado em horário comercial:

- entrada entre 08h e 16h em dia útil: duas horas;
- entrada após 16h ou fora de dia útil: 10h do próximo dia útil;
- fuso: America/Sao_Paulo.

Nesta versão, “dia útil” significa segunda a sexta. Feriados não serão calculados automaticamente; quando necessário, o prazo poderá ser ajustado manualmente no CRM.

O envio do primeiro e-mail não move o lead. Após o envio, a próxima ação passa a ser “Acompanhar resposta do diagnóstico”, com prazo de um dia útil. A mudança para “Diagnóstico agendado” continua sendo uma decisão humana.

## Modelos de primeiro contato

Continuarão existindo somente dois modelos mestres:

- **Quero conversar:** abordagem consultiva, valida o contexto e propõe um diagnóstico breve;
- **Quero contratar:** reconhece a configuração escolhida, mas esclarece que escopo e condições ainda serão validados.

Cada mensagem terá HTML e texto simples no mesmo envio multipart. Não haverá PDF, banner promocional ou imagem de conteúdo. O único recurso visual será o wordmark monocromático, e o e-mail continuará completo com imagens bloqueadas.

### Personalização por canais

- um canal: frase específica para esse canal;
- dois ou três canais: canal principal como eixo e demais canais como complemento;
- quatro ou mais: expressão “diferentes frentes de aquisição”, sem lista pesada;
- ausência de previsibilidade: copy própria, sem afirmar que já existe um canal principal;
- nenhum texto atribuirá ao lead informações que ele não forneceu.

Exemplo para indicações + Instagram:

> Você comentou que as indicações ainda são a principal fonte de oportunidades, com Instagram e Facebook complementando a aquisição. No diagnóstico, vamos observar como esses contatos entram, são atendidos e avançam comercialmente, preservando o que já funciona e identificando onde existe espaço para ganhar previsibilidade.

### Ação no CRM

Nos leads em Diagnóstico pendente:

- botão “Enviar primeiro e-mail” quando houver e-mail válido;
- botão “Abrir WhatsApp” quando houver telefone válido;
- o botão de e-mail abre uma confirmação com assunto, destinatário e prévia;
- a confirmação envia pela caixa `contato@oryneo.com.br` usando o backend de e-mail existente;
- uma chave de idempotência impede duplo envio por clique repetido;
- após aceitação SMTP, o card mostra “E-mail enviado” com data e hora;
- o envio é registrado no histórico e vinculado ao lead;
- reenvio fica disponível somente nos detalhes do lead, com nova confirmação;
- erro não marca o contato como enviado e exibe orientação acionável.

O primeiro contato não será disparado automaticamente na entrada do lead. Essa decisão preserva o atendimento humano definido para a fase founder-led.

## Supabase e segurança

O `lead-intake` continuará sendo o único ponto público de gravação. Ele deve:

- manter allowlist estrita de origens;
- exigir token público válido e consentimento;
- validar tamanho do corpo antes de interpretar JSON;
- validar enums, arrays, limites e relações entre campos;
- manter honeypot e idempotência;
- não confiar em preço, total, nome de serviço ou etapa enviados pelo navegador;
- não armazenar senha, segredo ou conteúdo sensível;
- responder sem revelar se determinado e-mail já existe;
- produzir mensagens de erro neutras e rastreáveis nos logs.

As tabelas continuam com RLS. Nenhuma tabela nova será exposta diretamente ao visitante. Mudanças de banco serão aplicadas por migração versionada e verificadas pelos advisors de segurança e desempenho.

O envio do primeiro e-mail exigirá sessão autenticada e participação em `crm_members`, usando as rotas existentes do `mail-api` e nunca expondo a senha da caixa ao navegador.

## Privacidade

`privacidade.html` será atualizado para refletir o fluxo real:

- envio direto ao backend da ORYNEO;
- categorias de dados coletados;
- finalidade de contato e preparação comercial;
- consulta opcional de CNPJ;
- atribuição de origem;
- ausência de cobrança no formulário;
- canais para acesso, correção, exclusão e revogação do consentimento;
- armazenamento local temporário da sessão do formulário.

Não será declarado uso de analytics ou publicidade que não esteja efetivamente instalado.

## Estrutura de implementação

### Repositório `Oryneo_Landing_Page`

- `comecar/index.html`: shell semântico e metadados;
- `comecar/form.css`: layout, watermark e responsividade;
- `comecar/form.js`: máquina de estados, validação, acessibilidade e payload;
- ativos monocromáticos oficiais reutilizados do Brand Kit;
- CTAs da landing passam a gerar links para `/comecar/`;
- política, sitemap, testes e documentação atualizados.

### Repositório `Oryneo_CRM`

- integrar o gerador de e-mails já prototipado;
- adaptar o gerador para canais e objetivos múltiplos;
- adicionar prévia/confirmação e ações ao card/detalhes;
- registrar status, horário e histórico;
- acrescentar testes de renderização, idempotência e permissões;
- migrar os nomes das etapas e as regras de próxima ação.

### Supabase

- ampliar e implantar `lead-intake` de forma retrocompatível;
- criar RPC autenticada e idempotente para registrar o primeiro contato e a próxima ação após aceitação SMTP;
- manter o envio real no `mail-api`;
- atualizar testes SQL e testes Deno.

## Sequência segura de deploy

1. Aplicar mudanças de banco retrocompatíveis.
2. Implantar `lead-intake` aceitando formatos antigo e novo.
3. Publicar o CRM com gerador, botões e leitura dos novos campos.
4. Executar envio real controlado para uma caixa de homologação e confirmar SMTP, IMAP, vínculo e idempotência.
5. Publicar `/comecar/` e validar envio real controlado.
6. Alterar os CTAs da landing para o novo fluxo.
7. Executar smoke tests públicos em Chromium e WebKit/mobile.
8. Manter rollback possível por versão do Edge Function e commits anteriores dos dois repositórios.

Essa ordem impede que uma página nova envie dados que o backend ou o CRM ainda não compreendam.

## Homologação

### Automatizada

- validação unitária de cada etapa e combinação condicional;
- payload antigo e novo aceitos pelo `lead-intake`;
- enumeração, limites, exclusividade e canal principal testados;
- 48 combinações comerciais renderizadas pelos dois modelos mestres;
- escaping de dados do lead em HTML;
- HTML e texto simples equivalentes;
- duplo clique não produz dois e-mails;
- envio não muda a etapa;
- próxima ação e histórico atualizados somente após SMTP aceito;
- build dos dois repositórios;
- typecheck das Edge Functions;
- teste de teclado, zoom e ausência de overflow;
- imagens bloqueadas sem perda de conteúdo;
- CTAs preservam seleção e UTM.

### Real controlada

- uma submissão de conversa e uma de contratação;
- recebimento correto no CRM;
- seleção comercial e canais exibidos corretamente;
- envio do primeiro e-mail para endereço de homologação autorizado;
- mensagem presente em Enviados e sincronizada no CRM;
- resposta recebida, sincronizada e vinculada ao mesmo lead;
- botão `wa.me` gerado com telefone normalizado;
- verificação dos logs sem dados sensíveis;
- advisors Supabase sem novos alertas críticos.

## Fora desta entrega

- integração direta com Evolution API;
- automação de WhatsApp;
- agendamento externo de calendário;
- pagamento ou checkout;
- troca de DNS do domínio estacionado;
- nutrição automática ou sequência de e-mails;
- criação de leads no CRM antes da confirmação final do formulário.

Esses itens exigem decisões e contratos próprios e não serão simulados nesta implementação.

## Critérios de conclusão

A entrega só estará concluída quando:

- `/comecar/` estiver publicado e responsivo;
- nenhum logo ou “Y” colorido aparecer no formulário ou nos e-mails;
- a marca d’água for discreta e não prejudicar contraste;
- canais múltiplos e canal principal chegarem corretamente ao CRM;
- o pipeline estiver renomeado sem perda de oportunidades;
- o primeiro e-mail puder ser revisado e enviado pelo CRM;
- o lead permanecer em Diagnóstico pendente após o envio;
- SMTP, Enviados, IMAP, resposta e vínculo tiverem sido homologados;
- testes e builds estiverem verdes;
- a política de privacidade refletir o comportamento real;
- os dois deploys públicos e as Edge Functions estiverem em versões verificadas.
