// QA-017 — Vários campos de texto sem nome acessível
// O textarea de mensagem, o campo de busca do modal "Nova conversa" e os
// campos de busca/tag de empresa-vaga-form.ejs só tinham `placeholder` —
// que não é substituto de label (some ao digitar, suporte inconsistente
// entre leitores de tela). Corrigido com `aria-label` descritivo em cada um.
const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');
const readView = name => fs.readFileSync(path.join(VIEWS_DIR, name), 'utf8');

describe('QA-017 — campos de texto com aria-label', () => {
  test.each([
    ['mensagens.ejs', 'msgInput'],
    ['empresa-mensagens.ejs', 'msgInput'],
    ['mentor.ejs', 'mentorInput'],
    ['mensagens.ejs', 'jobSearchInput'],
    ['empresa-vaga-form.ejs', 'search-required'],
    ['empresa-vaga-form.ejs', 'search-desired'],
    ['empresa-vaga-form.ejs', 'tag-input'],
  ])('%s: #%s tem aria-label', (file, id) => {
    const content = readView(file);
    const tagMatch = content.match(new RegExp(`<(?:textarea|input)[^>]*id="${id}"[^>]*>`, 's'));
    expect(tagMatch).not.toBeNull();
    expect(tagMatch[0]).toMatch(/aria-label="[^"]+"/);
  });
});
