# Casamento — HTML, CSS, JavaScript e Supabase

Conversão do aplicativo Laravel enviado. Frontend em HTML/CSS/JavaScript puro, backend em Node.js/Express e banco PostgreSQL, autenticação e imagens no Supabase. O backend serve a interface e a API na mesma origem.

## Configuração rápida

### 1. Prepare o Supabase

Use um **projeto Supabase novo ou vazio**. O ZIP original contém código e migrations, sem um dump de dados. Esta entrega não migra registros nem senhas de um banco Laravel existente.

No SQL Editor, execute, nesta ordem:

1. Todo o conteúdo de `supabase/schema.sql`.
2. Todo o conteúdo de `supabase/storage.sql`.

O primeiro cria tabelas, índices, views, funções transacionais, sessões e permissões. O segundo cria o bucket `wedding-gifts`, público somente para leitura das fotos de presentes. A escrita das fotos é feita pelo backend.

### 2. Crie o administrador

Crie uma conta com e-mail e senha no **Supabase Authentication**, pelo painel do seu projeto, e confirme seu e-mail. Copie o UUID dessa conta. Depois execute no SQL Editor, substituindo o UUID e o nome:

```sql
insert into public.admin_users (id, name)
values ('UUID-DA-CONTA-CRIADA-NO-AUTH', 'Seu nome');
```

Para autorizar outro administrador, repita a operação com o UUID dele. A existência de uma conta no Auth, sozinha, não concede acesso ao painel. Não há cadastro público de administradores.

### 3. Configure o aplicativo

Instale Node.js **22.9 ou superior**. Abra o terminal na pasta do projeto e rode:

```bash
npm ci
```

Copie `.env.example` para `.env`:

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

No Linux/macOS:

```bash
cp .env.example .env
```

Edite o `.env`:

```dotenv
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000
SUPABASE_URL=https://emwpxetqmzzxvoslgwqn.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_wpGMVGpFawZfbAe1yQUaQQ_csTHqgE2
SUPABASE_SECRET_KEY=sb_secret_0GewQI0V9c1admJKeoYvvw_QIifKFU9
STORAGE_BUCKET=wedding-gifts
TRUST_PROXY=0
```

Copie a URL e as chaves no painel do seu projeto Supabase. As chaves legadas `anon` e `service_role` também são aceitas: coloque `anon` em `SUPABASE_PUBLISHABLE_KEY` e `service_role` em `SUPABASE_SECRET_KEY`.

**A chave secreta fica somente no `.env` do servidor.** Não copie essa chave para `public/app.js`, HTML, navegador ou repositório. O `.env` está excluído pelo `.gitignore`.

### 4. Inicie

```bash
npm start
```

Acesse:

- Administração: `http://localhost:3000/admin/login`
- Página inicial: `http://localhost:3000`
- Convidados: o link `/i/…` gerado no painel.

Durante desenvolvimento, `npm run dev` reinicia o backend quando seus arquivos mudam. A interface usa o servidor Node para acessar `/api`; abra pelo endereço acima.

## Como utilizar

1. Entre com o administrador cadastrado no Supabase Auth.
2. Em **Categorias**, cadastre as categorias de presentes.
3. Em **Presentes**, cadastre cada item: nome, categoria, descrição, foto, valor estimado opcional e link de referência. Cada item representa uma unidade.
4. Em **Convites**, crie uma família/grupo e o limite de pessoas daquele convite.
5. Abra o convite e adicione as pessoas. O limite global inicial é de **95 pessoas cadastradas**, incluindo pendentes e recusas; pessoas removidas deixam de contar.
6. Clique em **Gerar novo QR Code**. Copie o link, salve o PNG ou imprima a página. O link secreto só aparece nesta tela; o banco guarda seu hash SHA-256.
7. Envie o link ou QR Code aos convidados. Eles confirmam a presença de cada pessoa e escolhem um presente para o convite inteiro.
8. Acompanhe confirmações no **Painel** e escolhas em **Reservas**.
9. Em **Configurações**, ajuste os nomes do casal, a data, a mensagem de boas-vindas e o prazo de confirmação. O prazo é exibido e preenchido no horário da Bahia (UTC−03:00), e gravado com fuso explícito.

Se testar o QR pelo celular, `localhost` aponta para o próprio celular. Use o endereço do computador na rede em `APP_URL` (por exemplo, `http://192.168.1.20:3000`) e abra o aplicativo por esse mesmo endereço. Gere o QR novamente após alterar a origem. Para uso real, configure a URL HTTPS pública do backend antes de emitir os convites.

## Funcionalidades preservadas

| Área | Funcionalidades |
| --- | --- |
| Convidados | Entrada pelo link secreto/QR; confirmação individual; prazo; lista de presentes livres; escolher, trocar e cancelar presente; encerrar sessão |
| Convites | Criar/editar; ativar/desativar; limitar pessoas; adicionar/editar/remover nomes; gerar e revogar links |
| Presentes | Categorias; descrição; foto PNG/JPEG/WebP até 2 MB; valor estimado; link externo; ordem; edição; ativar/desativar; arquivamento |
| Reservas | Uma por convite e uma por presente; histórico; liberação administrativa com motivo e auditoria |
| Configurações | Data do casamento; prazo de RSVP; mensagem; nomes do casal |
| Painel | Quantidades e resumo de confirmações de presença |

A troca funciona em uma transação: se o novo presente não estiver disponível ou ocorrer erro, a escolha anterior é mantida. Assim como no Laravel enviado, quem já tem uma reserva pode trocar mesmo depois de marcar todos os participantes como “não vou comparecer”. Uma nova reserva exige ao menos uma pessoa confirmada.

Presentes reservados podem receber ajustes de descrição, foto, categoria, valor e situação, mas seu nome não pode mudar. É preciso liberar a reserva antes de arquivá-los. Categorias que já possuem presentes, incluindo arquivados, não podem ser arquivadas. Arquivamentos e remoções de pessoas preservam os registros no banco.

Novos links não revogam os antigos automaticamente. Revogar um link também encerra as sessões ligadas a ele nesta versão. Sessões expiram em 8 horas para administradores e 7 dias para convidados. Convites inativos não dão acesso.

## Estrutura do código

```text
casamento-js/
  public/
    index.html          HTML inicial
    styles.css          Aparência e responsividade
    app.js              Telas, formulários e chamadas à API
    favicon.svg
  server/
    index.js            Inicialização e leitura do .env
    app.js              Rotas, autorização, cookies, CSRF e uploads
    supabase.js         Clientes Supabase e tratamento de erros
    validation.js       Validação de campos, links e imagens
  supabase/
    schema.sql          Banco, RPCs, views, índices e RLS
    storage.sql         Bucket para fotos
  tests/
    database.test.js    Regras e transações PostgreSQL
    http.test.js        Fluxos HTTP e controle de acesso
    validation.test.js  Validação de dados e imagens
    frontend.test.js    Interações do frontend no DOM
    helpers.js          Banco embutido e adaptador exclusivos dos testes
  scripts/check.js      Verificação de sintaxe
  .env.example
  package.json
  package-lock.json
  README.md
  VALIDACAO.md
```

Para editar a aparência, altere `public/styles.css`. Para editar as telas, altere as funções correspondentes em `public/app.js`. Não há Blade, PHP, React, Tailwind, Vite nem etapa de compilação do frontend.

As tabelas e RPCs são acessíveis somente ao backend por `service_role`. RLS está habilitado e `anon`/`authenticated` não recebem acesso direto aos dados do casamento. A autenticação administrativa usa um cliente separado do cliente privilegiado. Cookies são `HttpOnly`, `SameSite=Lax`, e `Secure` em produção. O backend verifica origem e token CSRF nas escritas autenticadas.

## Testes

```bash
npm run check
npm test
```

Os testes usam PostgreSQL embutido via PGlite, com dados isolados em memória. **Eles não leem o `.env` e não acessam seu banco Supabase.** As rotas usam um adaptador exclusivo de teste e o login simulado; consultas e funções transacionais executam no motor PostgreSQL. Consulte `VALIDACAO.md` para o que foi verificado e os limites dessa validação.

Para instalar somente dependências de produção em um servidor:

```bash
npm ci --omit=dev
npm start
```

## Hospedagem

Hospede o projeto em um ambiente que execute Node.js continuamente. Configure as mesmas variáveis de ambiente do `.env`, com:

```dotenv
NODE_ENV=production
APP_URL=https://casamento.seu-dominio.com
TRUST_PROXY=1
```

`APP_URL` é a origem completa, sem caminho, e deve ser o endereço pelo qual as pessoas visitam o aplicativo. Ela é usada nos QR Codes e na validação de origem. Em produção, HTTPS é obrigatório. `TRUST_PROXY=1` se aplica quando há exatamente um proxy reverso confiável; ajuste à topologia real ou mantenha `0` se não houver proxy. O provedor pode definir `PORT`.

O backend já serve `public/` e todas as rotas do frontend. O processo de saúde está em `GET /api/health`. Esse endpoint verifica o processo, sem consultar o banco. Sessões ficam no Supabase e sobrevivem ao reinício do Node. O limitador de tentativas fica na memória de cada processo; em várias réplicas, use também limitação no proxy/gateway.

As fotos substituídas são mantidas no bucket; faça limpeza administrativa dos objetos sem referência caso necessário. O projeto permite configurar e usar um banco Supabase, mas não inclui criação ou hospedagem automática na sua conta.

## Problemas comuns

| Sintoma | Verificação |
| --- | --- |
| “Configure … no arquivo .env” | Preencha todas as variáveis obrigatórias e substitua os exemplos |
| Login inválido | Confirme e-mail e senha no Supabase Auth; verifique se o e-mail está confirmado |
| Conta sem acesso administrativo | Cadastre o UUID correto do Auth em `public.admin_users` |
| Erro de banco ou RPC | Execute `schema.sql` inteiro e confira a chave secreta/URL |
| Upload falha | Execute `storage.sql`, use o bucket correto e uma foto válida até 2 MB |
| “Origem da solicitação inválida” | Abra o aplicativo exatamente pela origem configurada em `APP_URL` |
| QR não abre em outro aparelho | Use IP acessível na rede ou domínio público, em vez de `localhost` |
| Presente não aparece para convidados | Verifique se está ativo, sem arquivamento e sem reserva ativa |
| RSVP bloqueado | Confira o prazo em Configurações e o horário da Bahia |
| Muitas tentativas | Aguarde o período indicado; há limite de login e de ações |
