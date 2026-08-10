// Configurações do gerador de calendário.
// Ajuste aqui as regras de negócio sem mexer no build.js.

module.exports = {
  // Toda data listada em data/calendario.json (independente do "tipo":
  // feriado, avaliacao ou evento) cancela a aula da turma naquele dia
  // e "empurra" as aulas seguintes para as próximas datas — não há mais
  // distinção de tipo aqui.

  // Mapeia nomes de dia da semana (como usados no horario_professor.json)
  // para o índice do JS (0=domingo ... 6=sábado). Aceita com ou sem acento.
  diasSemana: {
    domingo: 0,
    segunda: 1,
    terca: 2,
    "terça": 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sabado: 6,
    "sábado": 6,
  },
};