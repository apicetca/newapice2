// ============================================
// services/githubErrors.js
// Distingue "o recurso não existe" (normal: repositório sem README → 404)
// de "não conseguimos ler o GitHub" (limite de uso, token inválido, erro do
// servidor, timeout, rede fora). Sem essa distinção, uma falha da API vira
// confiança 0 / "habilidade faltando", que é um resultado errado
// (docs/analise-perfil.md, limitação 3).
// ============================================

const MENSAGEM_GITHUB_INDISPONIVEL =
  "Não conseguimos ler seu GitHub agora. Tente de novo em alguns minutos.";

/** Lançado quando a leitura do GitHub falhou (≠ "não existe"). */
class GitHubIndisponivelError extends Error {
  constructor(detalhe) {
    super(detalhe ? `GitHub indisponível: ${detalhe}` : "GitHub indisponível");
    this.name = "GitHubIndisponivelError";
    this.codigo = "GITHUB_INDISPONIVEL";
  }
}

/** Status HTTP de um erro do axios (undefined em timeout / erro de rede). */
function statusDoErro(err) {
  return err?.response?.status;
}

/**
 * true quando o erro significa "não conseguimos ler" (falha), false quando
 * significa "o recurso não existe / não está acessível" (resultado normal).
 *   - sem resposta HTTP (timeout, DNS, conexão recusada) → falha
 *   - 401 (token expirado/inválido), 429, 5xx → falha
 *   - 403 só é falha quando é limite de uso (rate limit); um 403 comum é
 *     "sem permissão" e se comporta como "não existe"
 *   - 404 e demais 4xx → não existe
 */
function ehFalhaDeLeitura(err) {
  const status = statusDoErro(err);
  if (status === undefined) return true;
  if (status === 401 || status === 429 || status >= 500) return true;
  if (status === 403) {
    const h = err.response?.headers ?? {};
    const msg = String(err.response?.data?.message ?? "");
    return String(h["x-ratelimit-remaining"]) === "0" || h["retry-after"] != null || /rate limit|abuse/i.test(msg);
  }
  return false;
}

/**
 * Registra a falha no log com o status HTTP e o repositório — nunca o token
 * nem os cabeçalhos da requisição.
 */
function registrarFalha(recurso, repoFullName, err) {
  const motivo = statusDoErro(err) ? `HTTP ${statusDoErro(err)}` : (err?.code || "sem resposta");
  console.error(`[github-analyzer] falha ao ler ${recurso} de ${repoFullName}: ${motivo}`);
}

module.exports = {
  MENSAGEM_GITHUB_INDISPONIVEL, GitHubIndisponivelError, ehFalhaDeLeitura, registrarFalha, statusDoErro,
};
