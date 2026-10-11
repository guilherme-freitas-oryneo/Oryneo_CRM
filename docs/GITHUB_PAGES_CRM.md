# ORYNEO CRM — Publicação via GitHub Pages

## Fonte e integridade
Frontend React/TypeScript/Vite derivado da branch `main`; o pipeline, login e Supabase existentes são reutilizados. Nenhum banco é criado, nenhuma oportunidade é inserida e nenhuma credencial administrativa é enviada ao GitHub.

## Publicação
1. O workflow `.github/workflows/publicar-crm-pages.yml` faz `npm ci`, executa TypeScript + build Vite com base `/Oryneo_CRM/`, valida artefatos e envia exclusivamente os arquivos de `dist/` à branch `gh-pages`.
2. A primeira ativação do GitHub Pages exige entrar em **Settings → Pages** e selecionar **Deploy from a branch**, branch **gh-pages**, pasta **/(root)** e salvar. Essa configuração não é realizada pelo workflow.
3. URL prevista **após a publicação confirmada**: https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/
4. Verificar Actions → "Publicar ORYNEO CRM no GitHub Pages", branch `gh-pages` e então URL pública. Caso o workflow não rode, usar Actions → Run workflow. Não divulgar a URL como ativa antes do teste.

## Autenticação e dados
Login existente via Supabase Auth com `signInWithPassword`. As permissões RLS continuam no projeto `ucikrafwfzamxvweuvgk`. O login do ChatGPT Sites e do GitHub Pages pode solicitar autenticação separada devido ao armazenamento local por domínio.
A mesma oportunidade da landing page é lida da tabela existente `crm_records`; não criar nenhuma oportunidade de teste adicional.

## Observações
A pasta `dist` não é versionada na `main`. O deploy do GitHub Pages usa subcaminho; por isso somente referências visuais relativas e a base do build foram ajustadas. Não é mudança de banco ou de regras comerciais.
GitHub Pages disponibiliza recursos estáticos publicamente; o conteúdo do CRM permanece protegido pela autenticação e RLS do Supabase. No repositório só há uma chave publicável, não `service_role`.
