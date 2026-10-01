const express = require("express");
const router  = express.Router();
const axios   = require("axios");
const db      = require("../database/db");
const { isAuth } = require("../middlewares/auth");
const { generateRepoDescription } = require("../services/portfolioDescriber");

// GET /api/user/repos — lista repos salvos no perfil
router.get("/repos", isAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM user_repositories WHERE user_id = ? ORDER BY added_at DESC",
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("[repos GET]", err.message);
    res.status(500).json({ error: "Erro ao buscar repositórios." });
  }
});

// GET /api/user/repos/github — repos do GitHub (para o modal de seleção)
router.get("/repos/github", isAuth, async (req, res) => {
  const token = req.session.user?.accessToken;
  if (!token) {
    return res.status(400).json({ error: "Conta GitHub não vinculada. Faça login com o GitHub para importar repositórios." });
  }

  try {
    const ghRes = await axios.get("https://api.github.com/user/repos", {
      headers: { Authorization: `Bearer ${token}` },
      params:  { per_page: 100, sort: "updated", type: "all" },
    });

    const [saved] = await db.query(
      "SELECT repo_full_name FROM user_repositories WHERE user_id = ?",
      [req.session.user.id]
    );
    const savedSet = new Set(saved.map(r => r.repo_full_name));

    const repos = ghRes.data.map(r => ({
      gh_id:         r.id,
      name:          r.name,
      full_name:     r.full_name,
      description:   r.description || "",
      is_private:    r.private,
      language:      r.language || null,
      stars:         r.stargazers_count || 0,
      updated_at_gh: r.updated_at,
      already_added: savedSet.has(r.full_name),
    }));

    res.json(repos);
  } catch (err) {
    console.error("[repos/github GET]", err.message);
    res.status(502).json({ error: "Erro ao buscar repositórios do GitHub." });
  }
});

const toMysqlDatetime = iso => iso ? iso.replace('T', ' ').replace('Z', '') : null;

// POST /api/user/repos — adiciona repo ao perfil
router.post("/repos", isAuth, async (req, res) => {
  const { repo_name, repo_full_name, description, is_private, language, stars, updated_at_gh } = req.body;
  if (!repo_full_name || !repo_name) {
    return res.status(400).json({ error: "repo_name e repo_full_name são obrigatórios." });
  }

  try {
    await db.query(
      `INSERT INTO user_repositories
         (user_id, repo_name, repo_full_name, description, is_private, language, stars, updated_at_gh)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         description   = VALUES(description),
         is_private    = VALUES(is_private),
         language      = VALUES(language),
         stars         = VALUES(stars),
         updated_at_gh = VALUES(updated_at_gh)`,
      [
        req.session.user.id,
        repo_name,
        repo_full_name,
        description || null,
        is_private ? 1 : 0,
        language   || null,
        stars      || 0,
        toMysqlDatetime(updated_at_gh),
      ]
    );

    const [[row]] = await db.query(
      "SELECT * FROM user_repositories WHERE user_id = ? AND repo_full_name = ?",
      [req.session.user.id, repo_full_name]
    );
    res.status(201).json(row);
  } catch (err) {
    console.error("[repos POST]", err.message);
    res.status(500).json({ error: "Erro ao salvar repositório." });
  }
});

// PATCH /api/user/repos/:id/visibility — alterna público/privado no perfil
router.patch("/repos/:id/visibility", isAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const is_public = req.body.is_public ? 1 : 0;
  try {
    const [result] = await db.query(
      "UPDATE user_repositories SET is_public = ? WHERE id = ? AND user_id = ?",
      [is_public, id, req.session.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Repositório não encontrado." });
    res.json({ ok: true, is_public });
  } catch (err) {
    console.error("[repos PATCH visibility]", err.message);
    res.status(500).json({ error: "Erro ao atualizar visibilidade." });
  }
});

// PATCH /api/user/repos/:id — edita título (repo_name) e/ou descrição customizados.
// repo_name é o que define como o repositório aparece no perfil (inclusive para
// empresas que virem esse perfil), por isso não pode ficar vazio quando enviado.
router.patch("/repos/:id", isAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const { description, repo_name } = req.body;
  if (repo_name !== undefined && !String(repo_name).trim()) {
    return res.status(400).json({ error: "O título não pode ficar vazio." });
  }

  const fields = [];
  const values = [];
  if (description !== undefined) { fields.push("description = ?"); values.push(description ?? null); }
  if (repo_name   !== undefined) { fields.push("repo_name = ?");   values.push(String(repo_name).trim().slice(0, 255)); }
  if (!fields.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });

  try {
    values.push(id, req.session.user.id);
    const [result] = await db.query(
      `UPDATE user_repositories SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      values
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Repositório não encontrado." });
    res.json({ ok: true });
  } catch (err) {
    console.error("[repos PATCH]", err.message);
    res.status(500).json({ error: "Erro ao atualizar repositório." });
  }
});

// POST /api/user/repos/:id/gerar-descricao — gera descrição de portfólio via IA
// a partir do README do repositório (item "Portfólio com descrições geradas").
router.post("/repos/:id/gerar-descricao", isAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const token = req.session.user?.accessToken;
  if (!token) {
    return res.status(400).json({ error: "Conta GitHub não vinculada. Faça login com o GitHub para gerar a descrição." });
  }

  try {
    const descricao = await generateRepoDescription(req.session.user.id, id, token);
    res.json({ ok: true, ai_description: descricao });
  } catch (err) {
    console.error("[repos POST gerar-descricao]", err.message);
    if (err.message === "Repositório não encontrado.") {
      return res.status(404).json({ error: err.message });
    }
    res.status(502).json({ error: "Erro ao gerar descrição com IA. Tente novamente em instantes." });
  }
});

// DELETE /api/user/repos/:id — remove repo do perfil
router.delete("/repos/:id", isAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  try {
    const [result] = await db.query(
      "DELETE FROM user_repositories WHERE id = ? AND user_id = ?",
      [id, req.session.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Repositório não encontrado." });
    res.json({ ok: true });
  } catch (err) {
    console.error("[repos DELETE]", err.message);
    res.status(500).json({ error: "Erro ao remover repositório." });
  }
});

module.exports = router;
