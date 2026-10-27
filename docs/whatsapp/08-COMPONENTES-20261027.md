# Decisão de componentes para o WhatsApp ORYNEO — 27/10/2026

Stack observada: React 19.2, Vite 7.1, CSS próprio, Radix e Lucide já no `package.json`. Pesquisa direta no npm e nas páginas oficiais nesta data; versões abaixo são referências de mercado, **não dependências instaladas**. Identidade oficial conferida no `BRAND_LOCK.md` do Drive institucional: wordmark e Y não podem ser reconstruídos; Inter e masters existentes governam a UI.

| Opção | Versão/licença/atualização observadas | Compatibilidade e decisão |
| --- | --- | --- |
| [21st CLI/MCP](https://21st.dev/mcp) | `@21st-dev/cli` 1.18.0, MIT, publicado em 06/10/2026 | Catálogo e CLI exigem login para pesquisa efetiva; nenhuma peça foi importada sem confirmar autor/licença/dependências. Usar apenas para candidatas específicas, não tema completo. |
| [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) | `@radix-ui/react-dialog` 1.3.1, MIT, atualização 14/10/2026; peer React 19 aceito | Já presente (versão fixada 1.1.15). Preferir para drawer/modal com foco e teclado; não atualizar somente por estética. |
| [shadcn/ui](https://ui.shadcn.com/docs/installation/vite) | CLI `shadcn` 4.23.0, MIT, atualização 27/10/2026 | Instala código local e costuma pedir Tailwind/alias. Não migrar o CRM inteiro; portar apenas padrões necessários ao CSS atual após avaliação. |
| [TanStack Virtual](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual) | `@tanstack/react-virtual` 3.14.23, MIT, atualização 26/10/2026; peer React 19 aceito | Candidata para lista de 1.000+ conversas, condicionada a profiling, alturas variáveis e restauração de scroll. Ainda não instalar. |
| [Motion](https://motion.dev/docs/react) | `motion` 14.7.1, MIT, atualização 27/10/2026; peer React 19 aceito | CSS cobre transições atuais. Só adicionar quando houver ganho mensurável, com `prefers-reduced-motion`. |
| [React Bits](https://www.reactbits.dev/) | Repositório público atualizado 19/10/2026; licença do repositório não identificada automaticamente pelo GitHub | Repertório visual, sem adoção até conferir licença por componente e remover efeitos decorativos incompatíveis. |
| [Lucide](https://lucide.dev/) | `lucide-react` 0.468.0 fixado no CRM | Reusar ícones funcionais já presentes; rótulos e alvos de toque validados no módulo. |

## Shortlist funcional, sem importação prematura

| Peça | Fonte principal | Por que cabe na ORYNEO | Gate de adoção |
| --- | --- | --- | --- |
| Drawer de contexto e atribuição | Radix Dialog já instalado | Foco preso, Escape, semântica e teclado | Operação de atribuição auditada no backend |
| Menu de ações por conversa | Radix Dropdown já instalado | Evita botões falsos na thread | Permissões reais por ação |
| Lista longa de conversas | TanStack Virtual, se necessário | Reduz DOM em carteira grande | Medir 100/1.000 registros e scroll ancorado |
| Transição mobile lista→thread | CSS próprio | Preserva stack/tokens e reduz bundle | Teste em 320/390 px e movimento reduzido |
| Attachment preview | Componente próprio atual | Mídia exige autenticação, MIME e expiração específicos | E2E de mídia e revisão visual |

Composição escolhida: shell CRM existente, três áreas no desktop e fluxo lista→conversa→contexto no celular. Duas alternativas comparadas no [benchmark](07-BENCHMARK-20261027.md). A adoção de componentes 21st permanece **não verificável sem pesquisa autenticada no catálogo**; não há substituto inventado nem dependência adicional neste PR.
