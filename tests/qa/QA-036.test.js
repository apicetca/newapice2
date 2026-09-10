// QA-036 — Skip-link ("Pular para o conteúdo") aponta para um id que não
// existe ou está errado em duas páginas. O skip-link compartilhado
// (partials/header.ejs) usa href="#main-content", mas vagas.ejs não tinha
// nenhum id no <main>, e roadmap.ejs usava id="roadmap-main" em vez de
// id="main-content" — nos dois casos, ativar o skip-link não levava a
// lugar nenhum. Corrigido adicionando/renomeando o id para "main-content"
// nos dois arquivos (e nos seletores de roadmap.css que dependiam do id
// antigo, pra não quebrar o estilo do layout principal).
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const CSS_DIR   = path.join(__dirname, '..', '..', 'public', 'css');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');
const readCss  = name => fs.readFileSync(path.join(CSS_DIR, name), 'utf8');

describe('QA-036 — skip-link aponta para um id que realmente existe', () => {
  test('vagas.ejs: o <main> tem id="main-content"', () => {
    const content = readView('vagas.ejs');
    expect(content).toMatch(/<main[^>]*\bid="main-content"/);
  });

  test('roadmap.ejs: o <main> tem id="main-content" (não mais "roadmap-main")', () => {
    const content = readView('roadmap.ejs');
    expect(content).toMatch(/<main[^>]*\bid="main-content"/);
    expect(content).not.toMatch(/id="roadmap-main"/);
  });

  test('roadmap.css: os seletores acompanham a renomeação do id', () => {
    const content = readCss('roadmap.css');
    expect(content).not.toMatch(/#roadmap-main/);
    expect(content).toMatch(/#main-content/);
  });
});
