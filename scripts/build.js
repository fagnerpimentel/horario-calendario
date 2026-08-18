#!/usr/bin/env node
/**
 * Gera o site estático (docs/) a partir de:
 *   data/horario_professor.json
 *   data/calendario.json
 *   data/disciplinas/<CODIGO>.json
 *
 * Uso:  node scripts/build.js
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "docs");

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeKey(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Gera todas as datas (Date objects, hora 00:00 local) entre start e end (inclusive)
// que caem no dia da semana informado (0=domingo..6=sabado).
function datesForWeekday(start, end, weekdayIndex) {
  const result = [];
  const d = new Date(start);
  d.setDate(d.getDate() + ((weekdayIndex - d.getDay() + 7) % 7));
  while (d <= end) {
    result.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return result;
}

function parseDateOnly(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAY_LABEL = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

const TIPO_LABEL = {
  feriado: "Feriado",
  avaliacao: "Avaliação",
  evento: "Evento",
};

const TIPO_EMOJI = {
  feriado: "🔴",
  avaliacao: "🟡",
  evento: "🟢",
};

const TIPO_CLASS = {
  feriado: "tipo-feriado",
  avaliacao: "tipo-avaliacao",
  evento: "tipo-evento",
};

function sanitizeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, "-");
}

function loadDisciplinaSpec(codigo) {
  const p = path.join(DATA_DIR, "disciplinas", `${codigo}.json`);
  if (!fs.existsSync(p)) return null;
  return readJSON(p);
}

function buildSessions(turma, periodoStart, periodoEnd, feriados) {
  // feriados: Map<iso, {titulo, tipo}>
  // Qualquer data presente no calendário (feriado, avaliação ou evento)
  // cancela a aula da turma naquele dia — as aulas seguintes "empurram"
  // para as próximas datas disponíveis (shift automático).
  let all = [];
  for (const h of turma.horarios) {
    const key = normalizeKey(h.dia);
    const weekdayIndex = config.diasSemana[key];
    if (weekdayIndex === undefined) {
      throw new Error(`Dia da semana desconhecido: "${h.dia}"`);
    }
    const dates = datesForWeekday(periodoStart, periodoEnd, weekdayIndex);
    for (const date of dates) {
      const iso = toISO(date);
      const especial = feriados.get(iso);
      const cancelada = !!especial;
      all.push({
        iso,
        weekdayLabel: WEEKDAY_LABEL[date.getDay()],
        inicio: h.inicio,
        fim: h.fim,
        local: h.local,
        cancelada,
        motivoCancelamento: cancelada ? especial.titulo : null,
        tipoCancelamento: cancelada ? especial.tipo : null,
      });
    }
  }

  // ordena por data e depois por horário de início
  all.sort((a, b) => {
    if (a.iso !== b.iso) return a.iso < b.iso ? -1 : 1;
    return a.inicio.localeCompare(b.inicio);
  });

  const sessions = all.filter((s) => !s.cancelada);
  const canceladas = all.filter((s) => s.cancelada);

  return { sessions, canceladas, todas: all };
}

function htmlHead(title, extra = "") {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<link rel="stylesheet" href="${extra.rootPrefix || ""}style.css" />
</head>
<body>
`;
}

function htmlFoot() {
  return `</body>\n</html>\n`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- ICS ----------
function icsEscape(s) {
  return String(s).replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
}

function icsEvents({ codigo, turma, sessions }) {
  const lines = [];
  sessions.forEach((s, idx) => {
    const dtStart = `${s.iso.replace(/-/g, "")}T${s.inicio.replace(":", "")}00`;
    const dtEnd = `${s.iso.replace(/-/g, "")}T${s.fim.replace(":", "")}00`;
    const summary = icsEscape(`${codigo} - Turma ${turma} - Aula ${idx + 1}`);
    const desc = icsEscape(s.titulo || "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${codigo}-${turma}-${s.iso}-${s.inicio}@horario-calendario`,
      `DTSTAMP:${dtStart}Z`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${desc}`,
      ...(s.local ? [`LOCATION:${icsEscape(s.local)}`] : []),
      "END:VEVENT"
    );
  });
  return lines;
}

// aulas: array de { codigo, turma, sessions } — uma ou mais turmas no mesmo arquivo.
function buildICS(aulas) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//horario-calendario//PT-BR",
    "CALSCALE:GREGORIAN",
  ];
  for (const aula of aulas) {
    lines.push(...icsEvents(aula));
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// ---------- páginas ----------
function pageTurma({
  codigo,
  nome,
  turma,
  linhas,
  totalAulas,
  conteudoRestante,
  icsFile,
  disciplinaHref,
}) {
  let numero = 0;
  const rows = linhas
    .map((s) => {
      const dataFmt = s.iso.split("-").reverse().join("/");
      if (s.cancelada) {
        const rotulo = TIPO_LABEL[s.tipoCancelamento] || "Sem aula";
        const emoji = TIPO_EMOJI[s.tipoCancelamento] || "🚫";
        const classe = TIPO_CLASS[s.tipoCancelamento] || "";
        return `<tr class="${classe}">
        <td>—</td>
        <td>${dataFmt}</td>
        <td>${s.weekdayLabel}</td>
        <td>${s.inicio} - ${s.fim}</td>
        <td colspan="3">${emoji} ${rotulo}: ${escapeHtml(s.motivoCancelamento)}</td>
      </tr>`;
      }
      numero += 1;
      const topico =
        s.topicoNum !== undefined && s.topicoNum !== null
          ? `Tópico ${s.topicoNum}`
          : "";
      return `<tr>
        <td>${numero}</td>
        <td>${dataFmt}</td>
        <td>${s.weekdayLabel}</td>
        <td>${s.inicio} - ${s.fim}</td>
        <td>${escapeHtml(s.local || "—")}</td>
        <td>${escapeHtml(topico)}</td>
        <td>${escapeHtml(s.titulo || "—")}</td>
      </tr>`;
    })
    .join("\n");

  const restanteHtml =
    conteudoRestante && conteudoRestante.length
      ? `<div class="restante">
    <h2>Tópicos extras:</h2>
    <ul class="riscado-lista">
      ${conteudoRestante
        .map(
          (item) =>
            `<li>${
              item["Tópico"] !== undefined && item["Tópico"] !== null
                ? `Tópico ${escapeHtml(item["Tópico"])} — `
                : ""
            }${escapeHtml(item.titulo)}</li>`
        )
        .join("\n      ")}
    </ul>
  </div>`
      : "";

  return `${htmlHead(`${codigo} - Turma ${turma}`)}
<div class="container">
  <h1>${escapeHtml(codigo)} — Turma ${escapeHtml(turma)}</h1>
  <p class="subtitulo">${escapeHtml(nome)}</p>

  <h2>Cronograma</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Data</th>
        <th>Dia</th>
        <th>Horário</th>
        <th>Local</th>
        <th>Conteúdo</th>
        <th>Título</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p class="total">Total de aulas: ${totalAulas}</p>
  ${restanteHtml}

  <div class="acoes no-print">
    <button onclick="window.print()">🖨️ Baixar / imprimir página (PDF)</button>
    <a href="ics/${icsFile}" download>📅 Baixar calendário (.ics)</a>
  </div>
</div>
${htmlFoot()}`;
}

function pageDisciplina({
  professor,
  codigo,
  nome,
  ementa,
  notaFinal,
  criterioAprovacao,
  turmas,
  site,
  email,
  lattes,
}) {
  const ementaHtml = ementa
    ? `<div class="ementa">
    <h2>Ementa</h2>
    <p>${escapeHtml(ementa)}</p>
  </div>`
    : "";

  const avaliacaoHtml =
    notaFinal || criterioAprovacao
      ? `<div class="avaliacao">
    <h2>Avaliação</h2>
    ${
      notaFinal && notaFinal.Formula
        ? `<p class="formula"><strong>Nota final:</strong> ${escapeHtml(notaFinal.Formula)}</p>`
        : ""
    }
    ${
      notaFinal
        ? `<ul class="legenda-lista">
      ${Object.entries(notaFinal)
        .filter(([sigla]) => sigla !== "Formula")
        .map(
          ([sigla, desc]) =>
            `<li><strong>${escapeHtml(sigla)}</strong>: ${escapeHtml(desc)}</li>`
        )
        .join("\n      ")}
    </ul>`
        : ""
    }
    ${
      criterioAprovacao
        ? `<p class="criterio">${escapeHtml(criterioAprovacao)}</p>`
        : ""
    }
  </div>`
      : "";

  return `${htmlHead(`${codigo} - ${nome}`)}
<div class="container">
  <h1>${escapeHtml(codigo)} — ${escapeHtml(nome)}</h1>
  <p class="subtitulo">Prof. ${professorHtml(professor, site)}</p>
  ${contatoHtml({ email, lattes })}
  ${ementaHtml}
  ${avaliacaoHtml}
</div>
${htmlFoot()}`;
}

function contatoHtml({ email, lattes }) {
  const links = [];
  if (email) links.push(`<a href="mailto:${escapeAttr(email)}">✉️ ${escapeHtml(email)}</a>`);
  if (lattes) links.push(`<a href="${escapeAttr(lattes)}" target="_blank" rel="noopener">🎓 Lattes</a>`);
  if (!links.length) return "";
  return `<p class="contato">${links.join(" · ")}</p>`;
}

function professorHtml(professor, site) {
  const nome = escapeHtml(professor);
  return site
    ? `<a href="${escapeAttr(site)}" target="_blank" rel="noopener">${nome}</a>`
    : nome;
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function pageIndex({
  professor,
  periodoLabel,
  periodoInicio,
  periodoFim,
  cards,
  semEspec,
  site,
  email,
  lattes,
  icsFile,
}) {
  const cardsHtml = cards
    .map(
      (c) => `<div class="card card-disciplina">
        <h3><a href="${c.href}">${escapeHtml(c.codigo)}</a></h3>
        <p>${escapeHtml(c.nome)}</p>
        <div class="turma-links">
          ${c.turmas
            .map(
              (t) =>
                `<a class="badge" href="${t.href}">Turma ${escapeHtml(t.turma)} · ${t.total} aulas</a>`
            )
            .join("\n          ")}
        </div>
      </div>`
    )
    .join("\n");

  const avisoSemEspec = semEspec.length
    ? `<p class="aviso">⚠️ Sem arquivo de conteúdo cadastrado para: ${semEspec
        .map(escapeHtml)
        .join(", ")}. As páginas mostram só as datas.</p>`
    : "";

  return `${htmlHead(`Calendário do semestre — ${professor}`)}
<div class="container">
  <h1>Calendário do semestre</h1>
  <p class="subtitulo">Prof. ${professorHtml(professor, site)} · Período ${escapeHtml(
    periodoLabel
  )} (${periodoInicio} a ${periodoFim})</p>
  ${contatoHtml({ email, lattes })}
  ${avisoSemEspec}
  <div class="acoes no-print">
    <a href="ics/${icsFile}" download>📅 Baixar calendário completo (.ics)</a>
  </div>
  <div class="grid">
    ${cardsHtml}
  </div>
  <p class="rodape">Gerado automaticamente a partir dos arquivos em <code>data/</code>.</p>
</div>
${htmlFoot()}`;
}

const CSS = `
:root { --azul:#1d4ed8; --cinza:#f3f4f6; --texto:#1f2937; }
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; color:var(--texto); background:#fff; }
.container { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { margin-bottom: 4px; }
.subtitulo { color:#555; margin-top:0; }
.contato { margin: 4px 0 16px; font-size: 13px; }
.contato a { color: var(--azul); text-decoration: none; }
.contato a:hover { text-decoration: underline; }
.voltar { display:inline-block; margin-bottom:16px; color:var(--azul); text-decoration:none; }
.voltar:hover { text-decoration: underline; }
.acoes { display:flex; gap:12px; margin: 16px 0 24px; flex-wrap: wrap; }
.acoes button, .acoes a { padding:8px 14px; border-radius:8px; border:1px solid var(--azul); background:var(--azul); color:#fff; cursor:pointer; font-size:14px; text-decoration:none; }
.acoes a { background:#fff; color:var(--azul); }
table { width:100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:14px; }
th { background: var(--cinza); }
.total { font-weight:600; margin-top:12px; }
.grid { display:grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap:14px; margin-top:24px; }
.card { display:block; border:1px solid #e5e7eb; border-radius:12px; padding:16px; text-decoration:none; color:var(--texto); transition: box-shadow .15s; }
.card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.08); }
.card h3 { margin:0 0 4px; color: var(--azul); }
.card h3 a { color: var(--azul); text-decoration: none; }
.card h3 a:hover { text-decoration: underline; }
.card p { margin:0 0 10px; font-size:14px; color:#444; min-height: 34px; }
.card-disciplina .turma-links { display:flex; flex-wrap:wrap; gap:6px; }
.badge { display:inline-block; font-size:12px; background:var(--cinza); border-radius:999px; padding:3px 10px; margin-right:6px; }
a.badge { color: var(--texto); text-decoration:none; }
a.badge:hover { background:#e5e7eb; }
.badge.muted { color:#666; }
.aviso { background:#fff7ed; border:1px solid #fdba74; padding:10px 14px; border-radius:8px; font-size:14px; }
.ementa { margin: 12px 0 20px; padding: 12px 16px; background:#f8fafc; border-left:3px solid var(--azul); border-radius:6px; }
.ementa h2 { margin:0 0 6px; font-size:14px; color:var(--azul); text-transform:uppercase; letter-spacing:.03em; }
.ementa p { margin:0; font-size:14px; color:#374151; line-height:1.5; }
.avaliacao { margin-top:24px; padding:16px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; }
.avaliacao h2 { margin:0 0 8px; font-size:16px; }
.avaliacao .formula { font-size:14px; margin:0 0 8px; }
.legenda-lista { margin:0 0 10px; padding-left:20px; font-size:13px; color:#444; }
.legenda-lista li { margin-bottom:3px; }
.avaliacao .criterio { font-size:13px; color:#555; margin:0; line-height:1.5; }
tr.tipo-feriado td { background:#fef2f2; color:#991b1b; font-style: italic; }
tr.tipo-avaliacao td { background:#fefce8; color:#854d0e; font-style: italic; }
tr.tipo-evento td { background:#f0fdf4; color:#166534; font-style: italic; }
.restante { margin-top:32px; padding:16px; background:#f9fafb; border:1px dashed #d1d5db; border-radius:10px; }
.restante h2 { margin:0 0 6px; font-size:16px; }
.riscado-lista { margin:0; padding-left:20px; color:#888; font-size:14px; }
.riscado-lista li { margin-bottom:4px; }
.rodape { margin-top:40px; font-size:12px; color:#888; }
@media print {
  .no-print, .voltar { display:none !important; }
  body { font-size: 12px; }
}
`;

function main() {
  const horario = readJSON(path.join(DATA_DIR, "horario_professor.json"));
  const calendario = readJSON(path.join(DATA_DIR, "calendario.json"));

  const periodoInicio = parseDateOnly(horario.dataInicio);
  const periodoFim = parseDateOnly(horario.dataFim);

  const feriados = new Map(Object.entries(calendario.dias || {}));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, "ics"), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "style.css"), CSS);

  const cards = [];
  const semEspecificacao = [];
  const todasAsAulas = [];
  let totalPaginasTurma = 0;

  for (const disc of horario.disciplinas) {
    const spec = loadDisciplinaSpec(disc.disciplina);
    if (!spec) semEspecificacao.push(disc.disciplina);
    const nome = spec ? spec.nome : disc.disciplina;
    const conteudo = spec ? spec.conteudo : [];
    const ementa = spec ? spec.ementa : null;
    const notaFinal = spec ? spec.NotaFinal : null;
    const criterioAprovacao = spec ? spec.CriterioAprovacao : null;

    const disciplinaFile = `${disc.disciplina}.html`;
    const turmasDaDisciplina = [];

    for (const turma of disc.turmas) {
      const { sessions, todas } = buildSessions(
        turma,
        periodoInicio,
        periodoFim,
        feriados
      );

      // zippa conteúdo (na ordem) só com as sessões que realmente ocorrem
      sessions.forEach((s, idx) => {
        const item = conteudo[idx];
        if (item) {
          s.topicoNum = item["Tópico"];
          s.titulo = item.titulo;
        }
      });

      const icsFile = `${disc.disciplina}_${sanitizeFileName(turma.turma)}.ics`;
      fs.writeFileSync(
        path.join(OUT_DIR, "ics", icsFile),
        buildICS([{ codigo: disc.disciplina, turma: turma.turma, sessions }])
      );
      todasAsAulas.push({ codigo: disc.disciplina, turma: turma.turma, sessions });

      const conteudoRestante = conteudo.slice(sessions.length);

      const pageFile = `${disc.disciplina}_${sanitizeFileName(turma.turma)}.html`;
      fs.writeFileSync(
        path.join(OUT_DIR, pageFile),
        pageTurma({
          codigo: disc.disciplina,
          nome,
          turma: turma.turma,
          linhas: todas,
          totalAulas: sessions.length,
          conteudoRestante,
          icsFile,
          disciplinaHref: disciplinaFile,
        })
      );
      totalPaginasTurma += 1;

      turmasDaDisciplina.push({
        turma: turma.turma,
        href: pageFile,
        total: sessions.length,
      });
    }

    fs.writeFileSync(
      path.join(OUT_DIR, disciplinaFile),
      pageDisciplina({
        professor: horario.professor,
        codigo: disc.disciplina,
        nome,
        ementa,
        notaFinal,
        criterioAprovacao,
        turmas: turmasDaDisciplina,
        site: horario.site,
        email: horario.email,
        lattes: horario.lattes,
      })
    );

    cards.push({
      codigo: disc.disciplina,
      nome,
      href: disciplinaFile,
      turmas: turmasDaDisciplina,
    });
  }

  const icsFileGeral = "calendario_geral.ics";
  fs.writeFileSync(
    path.join(OUT_DIR, "ics", icsFileGeral),
    buildICS(todasAsAulas)
  );

  fs.writeFileSync(
    path.join(OUT_DIR, "index.html"),
    pageIndex({
      professor: horario.professor,
      periodoLabel: horario.periodo,
      periodoInicio: horario.dataInicio.split("-").reverse().join("/"),
      periodoFim: horario.dataFim.split("-").reverse().join("/"),
      cards,
      semEspec: semEspecificacao,
      site: horario.site,
      email: horario.email,
      lattes: horario.lattes,
      icsFile: icsFileGeral,
    })
  );

  console.log(
    `Site gerado em ${OUT_DIR} (${cards.length} páginas de disciplina, ${totalPaginasTurma} páginas de turma).`
  );
  if (semEspecificacao.length) {
    console.log(
      `Aviso: sem arquivo de conteúdo para: ${semEspecificacao.join(", ")}`
    );
  }
}

main();