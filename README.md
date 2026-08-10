# Calendário do Semestre

Gera automaticamente um site estático com o cronograma de aulas de um professor,
cruzando o horário semanal com o calendário acadêmico (feriados/eventos) e o
conteúdo programático de cada disciplina. Cada disciplina/turma ganha sua
própria página, com botão para baixar em PDF (imprimir) e um arquivo `.ics`
para importar no Google Calendar / Outlook / Apple Calendar.

## Estrutura

```
data/
  horario_professor.json     # professor, período, datas do semestre e horário semanal por turma
  calendario.json             # feriados/avaliações/eventos do semestre
  disciplinas/
    CCP120.json               # conteúdo programático (1 arquivo por disciplina)
    CC7140.json
    ...
scripts/
  build.js                    # lê os JSON e gera o site em docs/
  config.js                   # regras configuráveis (ex: mapeamento de dias da semana)
docs/                          # site gerado (não versionado, criado pelo build/CI)
.github/workflows/deploy.yml   # publica docs/ no GitHub Pages a cada push na main
```

## Formato dos arquivos

### `data/horario_professor.json`
```json
{
  "professor": "Nome do Professor",
  "periodo": "2/2026",
  "dataInicio": "2026-08-10",
  "dataFim": "2026-12-18",
  "disciplinas": [
    {
      "disciplina": "CCP120",
      "turmas": [
        {
          "turma": "305",
          "horarios": [
            { "dia": "Segunda", "inicio": "13:40", "fim": "15:20" }
          ]
        }
      ]
    }
  ]
}
```
`dia` aceita: Segunda, Terca/Terça, Quarta, Quinta, Sexta, Sabado/Sábado, Domingo.
`dataInicio`/`dataFim` marcam os limites do semestre (mudam 2x por ano).

Uma turma pode ter mais de um `{ dia, inicio, fim }` em `horarios` (ex: duas
aulas por semana). Duas turmas que têm um encontro em comum também podem ser
declaradas como uma turma só, com o nome combinado (ex: `"turma": "060/665"`
ou `"turma": "075-375"`) e todos os horários (inclusive os repetidos) na
mesma lista — o gerador não deduplica, então o encontro conjunto aparece
normalmente na página dessa turma combinada.

### `data/calendario.json`
```json
{
  "dias": {
    "2026-09-09": { "titulo": "Independência do Brasil", "tipo": "feriado" },
    "2026-09-22": { "titulo": "Avaliação Parcial", "tipo": "avaliacao" }
  }
}
```
`tipo` pode ser `feriado`, `avaliacao` ou `evento` — é usado só para o rótulo
mostrado na página ("Feriado:", "Avaliação:", "Evento:"). **Toda data listada
aqui cancela a aula da turma naquele dia, independente do tipo.** As aulas
seguintes da turma são deslocadas para as próximas datas disponíveis (o
conteúdo da disciplina "empurra" para frente). Na página da turma, o dia
cancelado aparece como uma linha destacada em vermelho no lugar da aula.

Se o semestre terminar antes de todo o `conteudo` da disciplina ser
encaixado (por causa de muitos cancelamentos), os tópicos que sobraram
aparecem numa seção **"Tópicos extras:"** no final da página da turma.

### `data/disciplinas/<CODIGO>.json`
```json
{
  "codigo": "CCP120",
  "nome": "Programação Full-Stack",
  "conteudo": [
    { "Tópico": 1, "titulo": "Introdução da disciplina e HTML" },
    { "Tópico": 1, "titulo": "LAB 1 - Página inicial" }
  ]
}
```
Cada item da lista `conteudo` é **uma aula**, na ordem em que deve ocorrer.
O build casa esse item com a 1ª, 2ª, 3ª... data que realmente vira aula pra
turma (ou seja, já pulando os dias cancelados pelo `calendario.json`). Se
uma disciplina não tiver arquivo, a página é gerada só com as datas (sem
título).

## O que cada página de turma mostra

- Uma tabela com data, dia da semana, horário, tópico e título de cada aula.
- Uma linha vermelha no lugar de qualquer aula cancelada por um dia do
  `calendario.json`, com o motivo (ex: "🚫 Feriado: Independência do Brasil").
- Botão para baixar/imprimir a página em PDF e um link para baixar o
  arquivo `.ics` da turma.
- Se sobrar conteúdo (tópicos que não couberam no calendário do semestre),
  uma seção **"Tópicos extras:"** no final da página.

## Rodando localmente

Requer apenas Node.js 18+ (sem dependências externas).

```bash
node scripts/build.js
# abre docs/index.html no navegador
```

## Publicando no GitHub Pages

1. Suba este repositório no GitHub.
2. Em **Settings → Pages**, em "Build and deployment" escolha **Source: GitHub Actions**.
3. Dê push na branch `main` — o workflow `.github/workflows/deploy.yml` roda o
   build e publica `docs/` automaticamente.
4. A URL final aparece em **Settings → Pages** (algo como
   `https://<usuario>.github.io/<repo>/`).

## Atualizando o semestre seguinte

Edite os arquivos em `data/` (horário — incluindo `periodo`, `dataInicio`,
`dataFim` —, calendário, disciplinas) e dê push — o site é regerado
automaticamente.