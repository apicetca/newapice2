// Exclusão definitiva de conta de desenvolvedor ou empresa pelo painel do admin.
//
// Regras:
//  - só apaga contas do tipo pedido (dev | empresa); nunca administradores;
//  - conta com histórico de pagamentos NÃO é apagada (os registros financeiros têm
//    ON DELETE RESTRICT de propósito) — o admin deve suspender;
//  - tudo numa transação: ou apaga tudo ou nada;
//  - dev: remove também os dados ligados ao github_id (sem FK no banco);
//  - empresa: remove as vagas dela (candidaturas/matches das vagas caem em cascata);
//  - as sessões abertas da conta são encerradas (best-effort, depois do commit).
const TIPOS = { dev: "dev", empresa: "empresa" };

class ErroExclusao extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

// Tabela ausente (ambiente sem Mercado Pago configurado) = sem pagamentos.
async function contar(conn, tabela, id) {
  try {
    const [[linha]] = await conn.query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE user_id = ?`, [id]);
    return Number(linha.n);
  } catch (err) {
    if (err.errno === 1146 || err.code === "ER_NO_SUCH_TABLE") return 0;
    throw err;
  }
}

async function temPagamentos(conn, id) {
  return (await contar(conn, "mp_subscriptions", id)) + (await contar(conn, "annual_payments", id)) > 0;
}

async function excluirConta(db, id, tipo) {
  const typeDb = TIPOS[tipo];
  if (!typeDb) throw new Error(`tipo inválido: ${tipo}`);
  if (!Number.isInteger(id) || id <= 0) throw new ErroExclusao(400, "ID inválido.");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [usuarios] = await conn.query("SELECT id, type FROM users WHERE id = ? FOR UPDATE", [id]);
    const user = usuarios[0];
    if (!user || user.type !== typeDb) throw new ErroExclusao(404, tipo === "dev" ? "Desenvolvedor não encontrado." : "Empresa não encontrada.");

    if (await temPagamentos(conn, id)) {
      throw new ErroExclusao(409, "Esta conta tem histórico de pagamentos, que precisa ser mantido. Suspenda a conta em vez de excluí-la.");
    }

    if (tipo === "dev") {
      const [perfis] = await conn.query("SELECT github_id FROM user_dev_profiles WHERE user_id = ?", [id]);
      const gh = perfis[0]?.github_id;
      if (gh != null) {
        await conn.query("DELETE FROM user_skills WHERE github_id = ?", [gh]);
        await conn.query("DELETE FROM user_roadmap_progress WHERE github_id = ?", [gh]);
        await conn.query("DELETE FROM job_applications WHERE dev_github_id = ?", [gh]);
        await conn.query("DELETE FROM company_match_actions WHERE dev_github_id = ?", [gh]);
        await conn.query("DELETE FROM conversations WHERE dev_github_id = ?", [gh]);
        await conn.query("DELETE FROM match_ia_cache WHERE github_id = ?", [gh]);
      }
    } else {
      await conn.query("DELETE FROM jobs WHERE company_id = ?", [id]);
    }

    await conn.query("DELETE FROM users WHERE id = ? AND type = ?", [id, typeDb]);
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  // Derruba as sessões abertas (senão a pessoa continuaria logada por até 24h).
  try {
    await db.query("DELETE FROM sessions WHERE JSON_EXTRACT(data, '$.user.id') = ?", [id]);
  } catch (err) { console.error("[excluirConta] sessões não encerradas:", err.message); }
}

module.exports = { excluirConta, ErroExclusao };
