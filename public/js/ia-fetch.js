/* ia-fetch.js — fetch para as funções de IA (mentor, descrição de
   repositório, resumo de candidato, explicação do match, insights).
   - prazo: aborta a requisição (AbortController) em vez de esperar para
     sempre por uma IA travada;
   - lê a resposta com segurança: uma página de erro em HTML (ex.: o Render
     reiniciando) não vira "Unexpected token <" na tela;
   - erro com mensagem amigável e `repetivel` (vale tentar de novo: rede,
     prazo esgotado ou 5xx do servidor), além do `status` HTTP.
   Funciona no navegador (via <script src>, define window.fetchIA) e no Node
   (via require(), para testes). */
(function (root) {
  'use strict';

  var MSG_TEMPO = 'A IA demorou demais para responder. Tente novamente.';
  var MSG_REDE = 'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.';
  var MSG_PADRAO = 'Erro ao falar com a IA. Tente novamente em instantes.';

  function erroDeIA(mensagem, status, repetivel) {
    var erro = new Error(mensagem);
    erro.status = status;
    erro.repetivel = repetivel;
    return erro;
  }

  async function fetchIA(url, opcoes, prazoMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, prazoMs || 60000);
    var res;
    var texto;
    try {
      res = await fetch(url, Object.assign({}, opcoes, { signal: controller.signal }));
      texto = await res.text();
    } catch (err) {
      throw erroDeIA(err && err.name === 'AbortError' ? MSG_TEMPO : MSG_REDE, null, true);
    } finally {
      clearTimeout(timer);
    }

    var data = {};
    try { data = texto ? JSON.parse(texto) : {}; } catch (e) { /* corpo não é JSON */ }

    if (!res.ok) {
      throw erroDeIA((data && data.error) || MSG_PADRAO, res.status, res.status >= 500 || res.status === 429);
    }
    return data;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fetchIA: fetchIA };
  } else {
    root.fetchIA = fetchIA;
  }
})(typeof window !== 'undefined' ? window : globalThis);
