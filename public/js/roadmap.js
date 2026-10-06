// ============================================
// public/js/roadmap.js
// Comportamento client-side das 3 páginas do sistema de Roadmap novo
// (views/roadmap/*.ejs, rotas em /trilha):
//   - novo.ejs: alterna os painéis área/vaga do formulário; mostra o
//     overlay de carregamento no submit (o form é um POST normal, não
//     fetch — o overlay é só visual enquanto o navegador espera a
//     resposta, que pode levar alguns segundos por causa da IA).
//   - detalhe.ejs: marca o status de uma etapa via fetch (sem recarregar
//     a página), atualizando a barra de progresso da fase e do total.
// ============================================
(function () {
  "use strict";

  // ── novo.ejs: alterna os painéis "área" / "vaga" ──────────
  const toggles = document.querySelectorAll("[data-rm-tipo-toggle]");
  if (toggles.length) {
    toggles.forEach(radio => {
      radio.addEventListener("change", () => {
        document.querySelectorAll("[data-rm-tipo-painel]").forEach(painel => {
          painel.hidden = painel.dataset.rmTipoPainel !== radio.value;
        });
      });
    });
  }

  // ── novo.ejs: overlay de carregamento no submit ───────────
  const formNovo = document.getElementById("rmFormNovo");
  const overlay  = document.getElementById("rmLoadingOverlay");
  if (formNovo && overlay) {
    formNovo.addEventListener("submit", () => {
      overlay.hidden = false;
      // Não chama preventDefault — o form continua um POST normal do
      // navegador; o overlay só cobre a tela durante a espera.
    });
  }

  // ── detalhe.ejs: marcação de etapas (fetch, sem recarregar) ──
  const STATUS_SEGUINTE = {
    pendente:     "em_andamento",
    em_andamento: "concluida",
    concluida:    "pendente",
  };
  const STATUS_LABEL = {
    pendente:     "Pendente",
    em_andamento: "Em andamento",
    concluida:    "Concluída",
  };

  const main = document.querySelector("[data-rm-roadmap-id]");
  if (!main) return;
  const roadmapId = main.dataset.rmRoadmapId;

  document.querySelectorAll("[data-rm-toggle]").forEach(botao => {
    botao.addEventListener("click", () => atualizarEtapa(botao));
  });

  async function atualizarEtapa(botao) {
    const etapaId      = botao.dataset.etapaId;
    const statusAtual   = botao.dataset.status;
    const statusNovo     = STATUS_SEGUINTE[statusAtual] ?? "pendente";
    const item           = botao.closest("[data-rm-etapa-item]");

    botao.disabled = true;
    try {
      const res = await fetch(`/trilha/${roadmapId}/etapas/${etapaId}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: statusNovo }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erro ao atualizar a etapa.");

      // Atualiza o botão/card
      botao.dataset.status = statusNovo;
      botao.setAttribute("aria-pressed", String(statusNovo === "concluida"));
      item.className = item.className.replace(/rm-etapa--\S+/, `rm-etapa--${statusNovo}`);
      const label = item.querySelector("[data-rm-status-label]");
      if (label) label.textContent = STATUS_LABEL[statusNovo];

      recalcularProgresso(item);
    } catch (err) {
      console.error("[roadmap] erro ao atualizar etapa:", err);
      alert(err.message || "Não foi possível atualizar a etapa. Tente novamente.");
    } finally {
      botao.disabled = false;
    }
  }

  // Recalcula a barra de % da fase e do total, sem recarregar a página —
  // conta direto no DOM em vez de pedir os números de volta ao servidor.
  function recalcularProgresso(etapaItem) {
    const fase = etapaItem.closest(".rm-fase");
    if (fase) {
      const etapasFase = fase.querySelectorAll("[data-rm-etapa-item]");
      const concluidasFase = fase.querySelectorAll(".rm-etapa--concluida").length;
      const pctFase = etapasFase.length ? Math.round((concluidasFase / etapasFase.length) * 100) : 0;
      aplicarPct(fase.querySelector(".rm-progress--fase"), pctFase);
      const pctLabel = fase.querySelector(".rm-fase-pct");
      if (pctLabel) pctLabel.textContent = `${pctFase}%`;
    }

    const todasEtapas = document.querySelectorAll("[data-rm-etapa-item]");
    const todasConcluidas = document.querySelectorAll(".rm-etapa--concluida").length;
    const pctTotal = todasEtapas.length ? Math.round((todasConcluidas / todasEtapas.length) * 100) : 0;
    const barraTotal = document.querySelector(".rm-progress--total");
    aplicarPct(barraTotal, pctTotal);
    if (barraTotal) {
      const label = barraTotal.querySelector(".rm-progress-label");
      if (label) label.textContent = label.textContent.replace(/^\d+% concluído/, `${pctTotal}% concluído`);
    }
  }

  function aplicarPct(barraEl, pct) {
    if (!barraEl) return;
    barraEl.setAttribute("aria-valuenow", String(pct));
    const fill = barraEl.querySelector(".rm-progress-fill");
    if (fill) fill.style.width = `${pct}%`;
  }
})();
