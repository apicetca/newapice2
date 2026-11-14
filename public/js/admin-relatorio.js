// Utilitários compartilhados pelas telas de Admin → Relatórios:
// período, download (PDF/Excel) e helpers de gráfico em SVG.
(function () {
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const NS = "http://www.w3.org/2000/svg";

  const AR = {
    // Cores categóricas validadas (scripts/validate_palette.js, modo escuro); cinza = "resto" neutro.
    COR: { devs: "#8B5CF6", empresas: "#0FA391", free: "#55555f" },
    SURFACE: "#080808", INK: "#E5E7EB", MUTED: "#9CA3AF", GRID: "#1f1f1f",

    hojeIso: () => iso(new Date()),
    diasAtras: (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); },

    // { p: "7"|"30"|"90"|"custom", from, to } → query string da API
    qs: (sel) => (sel.p === "custom" ? `from=${sel.from}&to=${sel.to}` : `periodo=${sel.p}`),

    nf: new Intl.NumberFormat("pt-BR"),
    fmt: (n) => AR.nf.format(n),
    fmt1: (n) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n),

    // Baixa <api>.<formato>?<período> (formato: "pdf" | "xlsx"); lança Error com a mensagem da API.
    async baixar(api, sel, formato, extra = "") {
      const res = await fetch(`${api}.${formato}?${AR.qs(sel)}${extra ? `&${extra}` : ""}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Erro ao gerar o arquivo.");
      const nome = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || `relatorio.${formato}`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // Pop-up "Gerar relatório" (partials/admin-gerar-relatorio.ejs): abre o diálogo, valida o período
    // e baixa o arquivo. comTipo = o diálogo tem "Tipo de plano" (relatório de planos).
    initGerar({ api, comTipo = false, toast = () => {} }) {
      const $ = (id) => document.getElementById(id);
      const dlg = $("gen-dialog"), open = $("gen-open"), err = $("gen-error");
      const periodo = () => document.querySelector('input[name="gp"]:checked').value;
      const mostrarDatas = () => {
        const custom = periodo() === "custom";
        $("gen-range").hidden = !custom;
        if (custom && !$("g-from").value) { $("g-from").value = AR.diasAtras(29); $("g-to").value = AR.hojeIso(); }
      };
      $("g-to").max = AR.hojeIso();
      document.querySelectorAll('input[name="gp"]').forEach(r => r.addEventListener("change", mostrarDatas));

      open.addEventListener("click", () => { err.textContent = ""; dlg.showModal(); });
      $("gen-close").addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // clique no fundo
      dlg.addEventListener("close", () => open.focus());

      $("gen-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const sel = { p: periodo(), from: $("g-from").value, to: $("g-to").value };
        const formato = document.querySelector('input[name="gf"]:checked').value;
        err.textContent = "";
        if (sel.p === "custom" && (!sel.from || !sel.to)) { err.textContent = "Informe as duas datas do período."; return; }
        const extra = comTipo ? `tipo=${document.querySelector('input[name="gt"]:checked').value}` : "";
        const btn = $("gen-btn"); btn.disabled = true;
        try { await AR.baixar(api, sel, formato, extra); dlg.close(); toast("Relatório gerado."); }
        catch (e2) { err.textContent = e2.message; }
        finally { btn.disabled = false; }
      });
    },

    // ── SVG ──
    el(tag, attrs = {}, text) {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      return n;
    },
    niceStep(raw) {
      const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && p >= 10 ? 2.5 : f <= 5 ? 5 : 10) * p;
    },
    scaleFor(maxV) {
      const step = Math.max(1, AR.niceStep(Math.max(maxV, 4) / 5));
      const top = step * Math.ceil(Math.max(maxV, 1) / step);
      const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
      return { top, ticks };
    },
    // Moldura (grade recessiva, eixo Y e rótulos do eixo X). Devolve { svg, y }.
    frame(W, H, m, scale, labels, xAt) {
      const svg = AR.el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", "aria-hidden": "true", focusable: "false" });
      const ih = H - m.t - m.b;
      const y = (v) => m.t + ih - (v / scale.top) * ih;
      scale.ticks.forEach(v => {
        svg.appendChild(AR.el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: AR.GRID, "stroke-width": 1 }));
        svg.appendChild(AR.el("text", { x: m.l - 10, y: y(v) + 4, "text-anchor": "end", fill: AR.MUTED, "font-size": 11 }, AR.fmt(v)));
      });
      const every = Math.ceil(labels.length / 12);
      labels.forEach((t, i) => {
        if (i % every === 0 || (i === labels.length - 1 && every === 1)) {
          svg.appendChild(AR.el("text", { x: xAt(i), y: H - 8, "text-anchor": "middle", fill: AR.MUTED, "font-size": 11 }, t));
        }
      });
      return { svg, y };
    },
    // Barra com as pontas de cima arredondadas (4px), ancorada na base.
    topRound(x, y, w, h, r) {
      r = Math.min(r, h, w / 2);
      return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`;
    },
    // Tooltip HTML dentro de .adc-plot: show(leftPct, título, [[cor, nome, valor]]) / hide().
    tooltip(plot) {
      let tip = plot.querySelector(".adc-tip");
      if (!tip) { tip = document.createElement("div"); tip.className = "adc-tip"; tip.hidden = true; tip.setAttribute("aria-hidden", "true"); plot.appendChild(tip); }
      return {
        show(leftPct, title, rows) {
          tip.replaceChildren();
          const h = document.createElement("strong"); h.textContent = title; tip.appendChild(h);
          rows.forEach(([cor, nome, valor]) => {
            const r = document.createElement("span"); r.className = "adc-tip-row";
            const sw = document.createElement("i"); sw.style.background = cor;
            const n = document.createElement("span"); n.textContent = nome;
            const v = document.createElement("b"); v.textContent = typeof valor === "number" ? AR.fmt(valor) : String(valor);
            r.append(sw, n, v); tip.appendChild(r);
          });
          tip.style.left = `${leftPct}%`;
          tip.classList.toggle("is-right", leftPct > 70);
          tip.hidden = false;
        },
        hide() { tip.hidden = true; },
      };
    },
  };
  window.AR = AR;
})();
