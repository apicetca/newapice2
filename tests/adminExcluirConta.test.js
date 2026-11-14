// Admin → Excluir conta (dev e empresa): regras do serviço, endpoints e telas.
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const request = require('supertest');
const express = require('express');

jest.mock('../database/db', () => ({ query: jest.fn(), getConnection: jest.fn(), ready: Promise.resolve() }));
const db = require('../database/db');
const adminController = require('../controllers/adminController');
const { excluirConta, ErroExclusao } = require('../services/excluirConta');
const { descrever, classificar } = require('../middlewares/adminAudit');

// conexão falsa: responde por trecho do SQL e registra tudo o que foi executado
function conexao(respostas = {}) {
  const sqls = [];
  const conn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn().mockResolvedValue(), release: jest.fn(),
    query: jest.fn(async (sql, args) => {
      sqls.push([sql, args]);
      for (const [trecho, resp] of Object.entries(respostas)) if (sql.includes(trecho)) return [resp];
      return [{ affectedRows: 1 }];
    }),
  };
  db.getConnection = jest.fn().mockResolvedValue(conn);
  db.query = jest.fn().mockResolvedValue([{}]);
  return { conn, sqls };
}
const semPagamento = { 'FROM mp_subscriptions': [{ n: 0 }], 'FROM annual_payments': [{ n: 0 }] };

describe('excluirConta (serviço)', () => {
  test('dev: apaga os dados ligados ao github_id, depois o usuário, em transação, e derruba as sessões', async () => {
    const { conn, sqls } = conexao({ ...semPagamento, 'FROM users WHERE id': [{ id: 5, type: 'dev' }], 'FROM user_dev_profiles': [{ github_id: 777 }] });
    await excluirConta(db, 5, 'dev');
    const textos = sqls.map(s => s[0]);
    ['user_skills', 'user_roadmap_progress', 'job_applications', 'company_match_actions', 'conversations', 'match_ia_cache']
      .forEach(t => expect(textos.some(s => s.includes(`DELETE FROM ${t}`))).toBe(true));
    expect(sqls.find(s => s[0].includes('DELETE FROM user_skills'))[1]).toEqual([777]);
    expect(textos[textos.length - 1]).toMatch(/DELETE FROM users WHERE id = \? AND type = \?/);
    expect(sqls[sqls.length - 1][1]).toEqual([5, 'dev']);
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM sessions/);
    expect(db.query.mock.calls[0][1]).toEqual([5]);
  });

  test('empresa: apaga as vagas dela e depois o usuário', async () => {
    const { sqls } = conexao({ ...semPagamento, 'FROM users WHERE id': [{ id: 9, type: 'empresa' }] });
    await excluirConta(db, 9, 'empresa');
    const textos = sqls.map(s => s[0]);
    expect(textos.some(s => /DELETE FROM jobs WHERE company_id = \?/.test(s))).toBe(true);
    expect(textos.some(s => s.includes('user_skills'))).toBe(false);
    expect(sqls[sqls.length - 1][1]).toEqual([9, 'empresa']);
  });

  test('conta com pagamentos não é apagada (409) e nada é alterado', async () => {
    const { conn, sqls } = conexao({ 'FROM users WHERE id': [{ id: 5, type: 'dev' }], 'FROM mp_subscriptions': [{ n: 2 }], 'FROM annual_payments': [{ n: 0 }] });
    await expect(excluirConta(db, 5, 'dev')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/pagamentos/) });
    expect(sqls.some(s => /^DELETE/.test(s[0]))).toBe(false);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  test('ambiente sem as tabelas de pagamento (Mercado Pago não configurado) conta como "sem pagamentos"', async () => {
    const { conn } = conexao();
    conn.query.mockImplementation(async (sql) => {
      if (sql.includes('FOR UPDATE')) return [[{ id: 9, type: 'empresa' }]];
      if (/mp_subscriptions|annual_payments/.test(sql)) throw Object.assign(new Error("Table doesn't exist"), { errno: 1146, code: 'ER_NO_SUCH_TABLE' });
      return [{ affectedRows: 1 }];
    });
    await expect(excluirConta(db, 9, 'empresa')).resolves.toBeUndefined();
    expect(conn.commit).toHaveBeenCalled();
  });

  test('outro erro ao checar pagamentos não é engolido', async () => {
    const { conn } = conexao();
    conn.query.mockImplementation(async (sql) => {
      if (sql.includes('FOR UPDATE')) return [[{ id: 9, type: 'empresa' }]];
      throw new Error('conexão caiu');
    });
    await expect(excluirConta(db, 9, 'empresa')).rejects.toThrow('conexão caiu');
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('tipo errado ou inexistente → 404; admin nunca é apagado por aqui', async () => {
    conexao({ 'FROM users WHERE id': [{ id: 1, type: 'admin' }] });
    await expect(excluirConta(db, 1, 'dev')).rejects.toMatchObject({ status: 404 });
    await expect(excluirConta(db, 1, 'empresa')).rejects.toMatchObject({ status: 404 });
    conexao({ 'FROM users WHERE id': [] });
    await expect(excluirConta(db, 2, 'dev')).rejects.toMatchObject({ status: 404 });
  });

  test('id inválido → 400 sem abrir conexão', async () => {
    db.getConnection = jest.fn();
    await expect(excluirConta(db, 0, 'dev')).rejects.toBeInstanceOf(ErroExclusao);
    expect(db.getConnection).not.toHaveBeenCalled();
  });

  test('erro no meio faz rollback e propaga', async () => {
    const { conn } = conexao();
    conn.query.mockImplementation(async (sql) => {
      if (sql.includes('FOR UPDATE')) return [[{ id: 5, type: 'dev' }]];
      if (sql.includes('COUNT')) return [[{ n: 0 }]];
      if (sql.includes('user_dev_profiles')) return [[{ github_id: 1 }]];
      throw new Error('boom');
    });
    await expect(excluirConta(db, 5, 'dev')).rejects.toThrow('boom');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  test('falha ao encerrar sessões não desfaz a exclusão', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    conexao({ ...semPagamento, 'FROM users WHERE id': [{ id: 9, type: 'empresa' }] });
    db.query = jest.fn().mockRejectedValue(new Error('sem tabela sessions'));
    await expect(excluirConta(db, 9, 'empresa')).resolves.toBeUndefined();
  });
});

describe('endpoints DELETE', () => {
  const app = express();
  app.delete('/users/:id', adminController.deleteUser);
  app.delete('/empresas/:id', adminController.deleteEmpresa);

  test('200 em caso de sucesso', async () => {
    conexao({ ...semPagamento, 'FROM users WHERE id': [{ id: 5, type: 'dev' }], 'FROM user_dev_profiles': [] });
    expect((await request(app).delete('/users/5')).body).toEqual({ success: true });
    conexao({ ...semPagamento, 'FROM users WHERE id': [{ id: 9, type: 'empresa' }] });
    expect((await request(app).delete('/empresas/9')).status).toBe(200);
  });
  test('propaga 409/404 do serviço com a mensagem', async () => {
    conexao({ 'FROM users WHERE id': [{ id: 5, type: 'dev' }], 'FROM mp_subscriptions': [{ n: 1 }], 'FROM annual_payments': [{ n: 0 }] });
    const r = await request(app).delete('/users/5');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Suspenda/);
    conexao({ 'FROM users WHERE id': [] });
    expect((await request(app).delete('/empresas/99')).status).toBe(404);
  });
  test('erro inesperado → 500 genérico, sem vazar a causa', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    db.getConnection = jest.fn().mockRejectedValue(new Error('segredo interno'));
    const r = await request(app).delete('/users/5');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('segredo');
  });
});

describe('histórico de atividades', () => {
  test('exclusões aparecem como "Exclusão de conta"', () => {
    expect(classificar('DELETE', '/users/5')).toEqual({ titulo: 'Exclusão de conta', detalhe: 'Excluiu a conta do desenvolvedor #5' });
    expect(descrever('DELETE', '/empresas/7')).toBe('Excluiu a conta da empresa #7');
    expect(descrever('DELETE', '/users/5/skills/2')).toBe('Removeu uma habilidade declarada do desenvolvedor #5');
  });
});

describe('telas', () => {
  const view = (f, locals) => ejs.renderFile(path.join(__dirname, '..', 'views', f),
    { user: { name: 'Admin', type: 'admin' }, currentPage: 'admin-usuarios', ...locals });

  test.each([['admin-usuario.ejs', 'habilidades, candidaturas, conversas'], ['admin-empresa.ejs', 'todas as vagas dela']])(
    '%s tem botão, confirmação em <dialog> e script', async (f, trecho) => {
      const html = await view(f, { userId: 5 });
      expect(html).toContain('id="btn-excluir-conta"');
      expect(html).toMatch(/<dialog class="adv-dialog" id="del-dialog" aria-labelledby="del-title" aria-describedby="del-text">/);
      expect(html).toContain('/js/admin-excluir-conta.js');
      expect(html).toContain('AdminExcluirConta.init(');
      expect(html).toContain(trecho);
      expect(html.match(/<h1\b/g)).toHaveLength(1); // a seção nova usa h2, sem criar outro h1
    });

  test('script: confirma antes, mostra erro do servidor e devolve o foco', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public/js/admin-excluir-conta.js'), 'utf8');
    expect(js).toContain('showModal()');
    expect(js).toContain('method: "DELETE"');
    expect(js).toContain('gatilho.focus()');
    expect(js).toContain('textContent');
    expect(js).not.toContain('innerHTML');
  });
});
