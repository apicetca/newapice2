// QA-033 — Estado vazio de listas usa role="status" como filho direto de
// role="list", violando a estrutura ARIA exigida (regra aria-required-children
// do axe-core, impacto "critical"). progresso.ejs e empresa-matchs.ejs
// injetavam o bloco de estado vazio (role="status") como único filho do
// container role="list"/role="listitem", quebrando a expectativa de que um
// role="list" só tenha filhos role="listitem"/group. vagas.ejs usava
// <article role="listitem">, role não permitido nesse elemento (allowed-role).
// Corrigido: o estado vazio agora é um elemento IRMÃO do container de lista
// (escondido/mostrado via `hidden`), nunca um filho dele; e o card de vaga
// virou <div role="listitem"> (role permitido nesse elemento).
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-033 — estado vazio de listas não é filho de role="list"', () => {
  test('progresso.ejs: #roadmap-empty existe como elemento irmão de #roadmap-list', () => {
    const content = readView('progresso.ejs');
    expect(content).toMatch(/id="roadmap-list"[^>]*role="list"[^>]*>\s*<\/div>\s*<div[^>]*id="roadmap-empty"/);
  });

  test('progresso.ejs: renderCards() não injeta role="status" dentro de #roadmap-list', () => {
    const content = readView('progresso.ejs');
    const fnMatch = content.match(/function renderCards\([\s\S]*?\n {4}\}/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    const listInnerHtmlAssign = fnBody.match(/\blist\.innerHTML\s*=\s*`([\s\S]*?)`/);
    if (listInnerHtmlAssign) {
      expect(listInnerHtmlAssign[1]).not.toMatch(/role="status"/);
    }
  });

  test('empresa-matchs.ejs: #match-empty existe como elemento irmão de #match-list', () => {
    const content = readView('empresa-matchs.ejs');
    expect(content).toMatch(/<ul[^>]*id="match-list"[^>]*role="list"[^>]*>[\s\S]*?<\/ul>\s*<div[^>]*id="match-empty"/);
  });

  test('empresa-matchs.ejs: render() não injeta <li role="status"> dentro de #match-list', () => {
    const content = readView('empresa-matchs.ejs');
    const fnMatch = content.match(/function render\(\)[\s\S]*?\n {4}\}/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch[0];
    const listInnerHtmlAssign = fnBody.match(/\blist\.innerHTML\s*=\s*`([\s\S]*?)`;/);
    if (listInnerHtmlAssign) {
      expect(listInnerHtmlAssign[1]).not.toMatch(/role="status"/);
    }
  });

  test('vagas.ejs: card de vaga usa um elemento que permite role="listitem" (não <article>)', () => {
    const content = readView('vagas.ejs');
    expect(content).not.toMatch(/<article[^>]*role="listitem"/);
    expect(content).toMatch(/<div class="job-card" role="listitem">/);
  });
});
