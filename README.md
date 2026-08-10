# Calendário do Semestre

Gera automaticamente um site estático com o cronograma de aulas de um professor,
cruzando o horário semanal com o calendário acadêmico (feriados/eventos) e o
conteúdo programático de cada disciplina. Cada disciplina/turma ganha sua
própria página, com botão para baixar em PDF (imprimir) e um arquivo `.ics`
para importar no Google Calendar / Outlook / Apple Calendar.

## Estrutura

```
data/
  horario_professor.json     # horário semanal do professor (dias/horas por turma)
  calendario.json             # início/fim do semestre + feriados/eventos
  disciplinas/
    CCP120.json               # conteúdo programático (1 arquivo por disciplina)
    CC7140.json
    ...
scripts/
  build.js                    # lê os JSON e gera o site em docs/
  config.js                   # regras configuráveis (ex: quais tipos de dia cancelam aula)
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

### `data/calendario.json`
```json
{
  "dias": {
    "2026-09-09": { "titulo": "Independência do Brasil", "tipo": "feriado" },
    "2026-09-22": { "titulo": "Avaliação Parcial", "tipo": "avaliacao" }
  }
}
```
`tipo` pode ser `feriado`, `avaliacao` ou `evento`. Por padrão **só `feriado`
cancela aula** — os outros tipos ficam disponíveis nos dados mas não removem
sessões do cronograma. Isso é configurável em `scripts/config.js`
(`tiposQueCancelamAula`).

O início/fim do semestre e o rótulo do período (ex: "2/2026") ficam em
`data/horario_professor.json` (`periodo`, `dataInicio`, `dataFim`).

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
O build casa esse item com a 1ª, 2ª, 3ª... data calculada para a turma. Se uma
disciplina não tiver arquivo, a página é gerada só com as datas (sem título).

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
