# TaskControl

Site de controle de tarefas em que **algumas tarefas só podem ser concluídas depois que o
arquivo exigido for enviado e aprovado por uma IA**. A IA lê o arquivo, procura erros, devolve
um parecer com o que precisa melhorar e — quando o arquivo é texto — **entrega a versão já
corrigida**, que pode virar a nova versão da entrega com um clique.

Frontend em **React (Vite)**, backend em **Node/Express**, revisão pela **API da Anthropic**
(`claude-opus-5`).

## Como funciona a trava

Ao criar uma tarefa você marca **"Exigir arquivo com revisão da IA"**, escreve os *critérios de
aceite* (é o checklist que a IA vai usar) e define a *nota mínima* para aprovar.

A partir daí a tarefa só chega em **Concluída** se:

1. um arquivo tiver sido enviado;
2. a **versão atual** do arquivo tiver um parecer da IA;
3. o parecer estiver aprovado — sem problemas `crítico`/`alto` **e** com nota ≥ nota mínima.

A regra é aplicada **no servidor**, não só na interface: qualquer tentativa de mudar o status
para `concluida` sem cumprir os três pontos volta com `409` e a lista de bloqueios. Enviar uma
versão nova do arquivo derruba a aprovação anterior — a nova versão precisa ser revisada de novo.

## Rodando

```bash
npm install
cp .env.example .env      # coloque sua ANTHROPIC_API_KEY
npm run dev               # API em :3001 e interface em :5173
```

Abra <http://localhost:5173>.

Para rodar como um serviço só (o Express serve o build do React):

```bash
npm start                 # build do frontend + servidor em :3001
```

Testes:

```bash
npm test
```

### Versão de demonstração

`npm run build:demo` gera `client/taskcontrol-demo.html`: um único arquivo HTML com a
interface inteira e um backend que roda no próprio navegador — as mesmas regras de
`gate.js` e o mesmo verificador local, com `Map` no lugar de disco e banco. Serve para
mostrar o produto sem subir servidor. A revisão pela API da Anthropic **não** roda nessa
versão: a página não fala com a API.

### Modo demonstração

**Sem `ANTHROPIC_API_KEY` o site funciona, mas não há revisão de IA.** Nesse caso roda um
verificador local que só faz checagens mecânicas (marcadores `TODO` esquecidos, arquivo curto
demais, linhas longas, presença dos termos dos critérios) e limpa espaçamento. A interface
marca isso claramente como *modo demonstração* — não confunda com o parecer real.

## O ciclo da entrega

```
enviar arquivo  →  IA revisa  →  reprovado?  →  "Usar como nova versão"  →  IA revisa de novo
                                    ↓                (versão corrigida         ↓
                                 aprovado              pela própria IA)     aprovado
                                    ↓                                          ↓
                            conclusão liberada                        conclusão liberada
```

Cada envio vira uma **versão** numerada, com histórico de pareceres. Dá para baixar qualquer
versão e comparar a original com a que a IA reescreveu.

## Tipos de arquivo

| Tipo | Revisão | Versão corrigida pela IA |
|---|---|---|
| Texto (`.md`, `.txt`, `.csv`, `.json`, código…) | sim | **sim** |
| PDF | sim | não (não dá para reescrever o binário) |
| Imagem (PNG, JPG, GIF, WebP) | sim | não |
| Demais binários | recusado no envio | — |

Limite de 20 MB por arquivo; a reescrita automática vale para textos de até ~120 mil caracteres.

## API

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/health` | Status e se a revisão por IA está ativa |
| `GET` | `/api/tasks` | Lista as tarefas |
| `POST` | `/api/tasks` | Cria tarefa |
| `PATCH` | `/api/tasks/:id` | Atualiza tarefa (**aplica a trava de conclusão**) |
| `DELETE` | `/api/tasks/:id` | Remove tarefa |
| `POST` | `/api/tasks/:id/deliverable` | Envia arquivo (`multipart/form-data`, campo `file`) |
| `POST` | `/api/tasks/:id/deliverable/review` | Roda a revisão da IA na versão atual |
| `POST` | `/api/tasks/:id/deliverable/reviews/:reviewId/apply` | Promove a versão melhorada a versão atual |
| `GET` | `/api/tasks/:id/deliverable/versions/:n/download` | Baixa uma versão |
| `GET` | `/api/tasks/:id/deliverable/reviews/:id/improved/download` | Baixa a versão melhorada |

## Estrutura

```
server/
  src/ai/reviewer.js       chamada à API da Anthropic, prompt e normalização do parecer
  src/ai/schema.js         schema do parecer (structured output)
  src/ai/demoReviewer.js   verificação local do modo demonstração
  src/lib/gate.js          a trava de conclusão
  src/lib/store.js         persistência em JSON
  src/lib/files.js         classificação do arquivo (texto / PDF / imagem)
  src/routes/              rotas de tarefas e da entrega
  test/                    testes do revisor e da trava
client/
  src/App.jsx              quadro kanban
  src/components/          card, formulário, painel do parecer, upload
```

Os dados ficam em `server/data/` (`db.json` e os arquivos enviados) — é um armazenamento em
arquivo, pensado para uso local ou de time pequeno. Para várias pessoas em produção, troque
`src/lib/store.js` por um banco de verdade e coloque autenticação na frente.

## Sobre a revisão

O parecer vem em JSON validado por schema (`output_config.format`), com nota, resumo, checklist
critério a critério, lista de problemas (severidade, onde está, o que está errado, como corrigir),
pontos positivos e o arquivo reescrito. Arquivos de texto são enviados à IA **com as linhas
numeradas**, para que o parecer aponte a linha exata — os números não entram na versão corrigida.
