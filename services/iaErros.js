// ============================================
// services/iaErros.js
// Erro padronizado das chamadas de IA (Gemini e
// fallback multi-provedor). Classifica a falha —
// tempo esgotado, limite de uso, provedor
// sobrecarregado, chave ausente/inválida, resposta
// ruim — para o retry saber o que vale repetir e as
// rotas responderem com o status HTTP certo.
// ============================================

class ErroIA extends Error {
  // tipo:       "tempo" | "limite" | "sobrecarga" | "rede" | "config" | "chave"
  //             | "requisicao" | "vazia" | "cortada" | "json" | "indisponivel" | "desconhecido"
  // status:     status HTTP devolvido pelo provedor, se houve resposta
  // temporario: true quando tentar de novo em instantes pode dar certo
  constructor(mensagem, { tipo = "desconhecido", status = null, temporario = false } = {}) {
    super(mensagem);
    this.name = "ErroIA";
    this.tipo = tipo;
    this.status = status;
    this.temporario = temporario;
  }
}

// Status HTTP do erro do provedor: @google/genai usa status ou statusCode,
// o SDK da OpenAI usa status.
function statusDoErro(err) {
  return err?.status ?? err?.statusCode ?? err?.response?.status ?? null;
}

// O SDK do Gemini deixa em err.message só "400 API error occurred:
// {httpMeta…}" — o motivo real vem em err.body, o JSON de erro da API (ex.:
// "API key not valid", "You exceeded your current quota"). A API não ecoa a
// chave nesse corpo.
function erroDaApi(err) {
  if (typeof err?.body !== "string") return null;
  try {
    const corpo = JSON.parse(err.body);
    return (Array.isArray(corpo) ? corpo[0] : corpo)?.error ?? null;
  } catch {
    return null;
  }
}

// Motivo do erro para o log: o da API quando houver, senão o do SDK.
function motivoDoErro(err) {
  const api = erroDaApi(err);
  if (!api?.message) return err?.message ?? String(err);
  const razao = api.details?.find(d => d.reason)?.reason;
  return razao ? `${api.message} (${razao})` : api.message;
}

// Quanto o Gemini pede para esperar depois de um 429, em ms — o corpo da
// API traz isso só no texto: "Please retry in 7h2m2s" (limite diário do
// plano gratuito) ou "Please retry in 55s" (limite por minuto).
function esperaSugeridaMs(err) {
  const m = motivoDoErro(err).match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:(\d+(?:\.\d+)?)s)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Math.round(((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000);
}

// sinal: o AbortSignal da tentativa — se ele abortou, quem estourou foi o
// nosso prazo (não um erro do provedor).
function classificarErro(err, sinal) {
  const status = statusDoErro(err);
  const texto = `${err?.name ?? ""} ${err?.message ?? ""}`;
  if (sinal?.aborted || /timeout|timed out|aborted/i.test(texto)) return { tipo: "tempo", status, temporario: true };
  if (status === 429) return { tipo: "limite", status, temporario: true };
  if (status === 408 || status === 409 || (status >= 500 && status <= 599)) return { tipo: "sobrecarga", status, temporario: true };
  // O Gemini responde chave inválida com 400 (API_KEY_INVALID), não 401.
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(motivoDoErro(err))) {
    return { tipo: "chave", status, temporario: false };
  }
  if (status) return { tipo: "requisicao", status, temporario: false };
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|connection/i.test(texto)) {
    return { tipo: "rede", status, temporario: true };
  }
  return { tipo: "desconhecido", status, temporario: false };
}

// Status HTTP para as rotas de IA. 503 quando a IA está indisponível agora
// (sobrecarga, limite, tempo esgotado) ou mal configurada (sem chave / chave
// inválida); 502 quando o provedor respondeu algo inutilizável. Erros que
// não são de IA (banco, validação...) ficam com o padrão de quem chama.
function statusHttpDaIA(err, padrao = 502) {
  if (!(err instanceof ErroIA)) return padrao;
  return err.temporario || err.tipo === "config" || err.tipo === "chave" ? 503 : 502;
}

// O que as rotas registram no log: tipo, status do provedor e mensagem —
// nunca a chave da API nem o corpo da requisição.
function resumoDoErro(err) {
  return {
    tipo: err instanceof ErroIA ? err.tipo : "interno",
    status: err?.status ?? null,
    motivo: err?.message ?? String(err),
  };
}

module.exports = { ErroIA, classificarErro, motivoDoErro, esperaSugeridaMs, statusHttpDaIA, resumoDoErro };
