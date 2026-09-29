// QA-002 — Mesmo padrão de XSS atinge páginas públicas e o cruzamento dev ↔ empresa
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-002 — páginas públicas e dev↔empresa escapam campos vulneráveis', () => {
  const cases = [
    {
      file: 'vagas.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(job.title)', 'escapeHtml(job.company', 'escapeHtml(job.description)'],
    },
    {
      file: 'vaga-publica.ejs',
      needsScriptTag: true,
      mustContain: [
        'escapeHtml(job.title)', 'escapeHtml(job.company', 'escapeHtml(job.location)',
        'escapeHtml(job.description)', 'escapeHtml(job.responsibilities)', 'escapeHtml(job.benefits)',
        'escapeHtml(t.trim())',
      ],
    },
    {
      file: 'dashboard.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(job.title)', 'escapeHtml(job.company'],
    },
    {
      file: 'progresso.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(r.title)', 'escapeHtml(r.company'],
    },
    {
      file: 'empresa-desenvolvedores.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(dev.name)', 'escapeHtml(initials(dev.name))'],
    },
    {
      file: 'empresa-matchs.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(m.dev)', 'escapeHtml(m.job)', 'escapeHtml(initials(m.dev))'],
    },
    {
      file: 'perfil-dev-empresa.ejs',
      needsScriptTag: true,
      mustContain: ['escapeHtml(dev.best_job)', 'escapeHtml(r.job_title)'],
    },
    {
      // já tinha escapeHtml() local — só faltava aplicar em alguns campos
      file: 'mensagens.ejs',
      needsScriptTag: false,
      mustContain: [
        'escapeHtml(c.company_name', 'escapeHtml(j.title)', 'escapeHtml(j.company',
        'escapeHtml(data.name)', 'escapeHtml(activeConversation.company_name',
      ],
    },
    {
      file: 'empresa-mensagens.ejs',
      needsScriptTag: false,
      mustContain: [
        'escapeHtml(c.dev_name', 'escapeHtml(data.name)',
        'escapeHtml(activeConversation.dev_name',
      ],
    },
  ];

  test.each(cases.filter(c => c.needsScriptTag))('$file carrega /js/escape-html.js', ({ file }) => {
    expect(readView(file)).toMatch(/<script src="\/js\/escape-html\.js"><\/script>/);
  });

  test.each(cases)('$file escapa os campos vulneráveis', ({ file, mustContain }) => {
    const content = readView(file);
    for (const snippet of mustContain) {
      expect(content).toContain(snippet);
    }
  });
});
