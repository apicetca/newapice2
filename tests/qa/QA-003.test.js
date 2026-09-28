// QA-003 — Mesma falta de escape em campos que só o próprio usuário injeta e vê
// Mesmo padrão do QA-001/QA-002 (campos vindos do banco entrando direto num
// template literal que vira innerHTML, sem escapeHtml()), mas em campos que
// só o próprio dono injeta e vê: bio/nome/repos do GitHub na própria
// dashboard, título das próprias vagas na gestão da empresa.
//
// roadmap.ejs está no "Arquivos" do achado, mas uma revisão linha a linha
// não encontrou nenhum campo auto-injetado sem escape ali — os únicos
// campos sem escapeHtml() no arquivo (skill_name, título/tipo/duração de
// recursos) vêm do catálogo de skills/recursos, que só admins escrevem
// (controllers/adminController.js e database/seed.js — nenhuma rota de
// dev/empresa insere nessas tabelas), e o título/empresa da própria vaga já
// usa .textContent (seguro). Não foi tocado.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-003 — páginas carregam escapeHtml() (public/js/escape-html.js)', () => {
  test.each([
    'dashboard.ejs',
    'empresa-dashboard.ejs',
    'empresa-vagas.ejs',
    'perfil-dev.ejs',
    'perfil-empresa.ejs',
  ])('%s carrega /js/escape-html.js', (file) => {
    const content = readView(file);
    expect(content).toMatch(/<script src="\/js\/escape-html\.js"><\/script>/);
  });
});

describe('QA-003 — campos auto-refletidos passam por escapeHtml()', () => {
  const cases = [
    {
      file: 'dashboard.ejs',
      mustContain: [
        'escapeHtml(firstName)',
        'escapeHtml(job.title)',
        'escapeHtml(job.company ?? "Empresa")',
        'escapeHtml(r.title)',
        'escapeHtml(r.text)',
      ],
    },
    {
      file: 'empresa-dashboard.ejs',
      mustContain: [
        'escapeHtml(name)',
        'escapeHtml(SETOR_LABEL[profile.setor]',
        'escapeHtml(TAMANHO_LABEL[profile.tamanho]',
        'escapeHtml(profile.site)',
        'escapeHtml(job.title)',
      ],
    },
    {
      file: 'empresa-vagas.ejs',
      mustContain: ['escapeHtml(job.title)'],
    },
    {
      file: 'perfil-dev.ejs',
      mustContain: [
        'escapeHtml(avatarUrl)',
        'escapeHtml(data.github_login)',
        'escapeHtml(data.email)',
        'escapeHtml(data.avatar)',
      ],
    },
    {
      file: 'perfil-empresa.ejs',
      mustContain: [
        'escapeHtml(data.setor)',
        'escapeHtml(data.tamanho)',
        'escapeHtml(v.title)',
        'escapeHtml(data.email)',
      ],
    },
  ];

  test.each(cases)('$file escapa os campos auto-refletidos', ({ file, mustContain }) => {
    const content = readView(file);
    for (const snippet of mustContain) {
      expect(content).toContain(snippet);
    }
  });
});
