// Excluir conta (admin): abre a confirmação, chama DELETE e volta para a lista.
// AdminExcluirConta.init({ url, nome, voltar })
window.AdminExcluirConta = {
  init({ url, nome, voltar }) {
    const $ = (id) => document.getElementById(id);
    const dlg = $("del-dialog"), gatilho = $("btn-excluir-conta");
    gatilho.addEventListener("click", () => {
      $("del-text").textContent = `A conta de ${nome} será apagada para sempre e a pessoa será desconectada na hora.`;
      $("del-error").textContent = "";
      dlg.showModal(); $("del-cancel").focus();
    });
    $("del-cancel").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => gatilho.focus());
    $("del-confirm").addEventListener("click", async () => {
      const btn = $("del-confirm"); btn.disabled = true; $("del-error").textContent = "";
      try {
        const res = await fetch(url, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Não foi possível excluir. Tente novamente.");
        location.href = voltar;
      } catch (err) { $("del-error").textContent = err.message; btn.disabled = false; }
    });
  },
};
