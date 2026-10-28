# Central de conversas — protótipo visual

Este protótipo é **isolado do CRM de produção**. Os nomes, conversas, status e oportunidades são sintéticos. O botão de envio fica desabilitado; não existe conexão Meta ou acesso a dados reais aqui.

Prévia: [desktop](preview-desktop.png) · [lista no celular](preview-mobile-list.png) · [conversa no celular](preview-mobile-thread.png).

Para abrir localmente, na raiz do repositório execute `python3 -m http.server 4317` e visite `http://127.0.0.1:4317/docs/whatsapp/prototype/`. O logo usa o PNG versionado em `public/`; a fonte Inter é carregada quando a rede permite, com fallback local.

Os controles de seleção, busca, filtros, volta e contexto servem para avaliação de fluxo. O código é um ensaio de layout; a implementação no CRM será feita com componentes React e dados do backend, após modelo de conversa, autorização e testes de envio/recebimento. Não se deve copiar os dados ilustrativos para produção.

Validação local: renderização e interação em Chromium a 390, 768, 1024 e 1440 px; sem overflow horizontal nesses tamanhos; filtro, seleção de conversa, painel de contexto e retorno no celular exercitados. Capturas preservadas nesta pasta. Ainda faltam teste com leitor de tela, contraste medido, dados extensos, teclado virtual real e feedback de operadores.
