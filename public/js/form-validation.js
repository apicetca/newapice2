/* =============================================
   form-validation.js
   Substitui os balões nativos do navegador
   ("Preencha esse campo") por mensagens próprias,
   com a identidade visual do site — o navegador não
   deixa estilizar o balão nativo, só o texto dele, e
   isso não é suficiente pra seguir a identidade
   visual pedida. Em vez disso, cada formulário ganha
   novalidate e a validação passa a ser 100% nossa.

   Uso: incluir este arquivo em qualquer página com
   formulários. Funciona em qualquer <form> da página,
   sem precisar configurar nada por campo — só reusa
   o texto do <label>/placeholder já existente.
============================================= */
(function () {
  "use strict";

  function fieldLabel(field) {
    if (field.dataset.errorLabel) return field.dataset.errorLabel;
    if (field.labels && field.labels.length) return field.labels[0].textContent.replace(/[*:]+\s*$/, "").trim();
    if (field.getAttribute("aria-label")) return field.getAttribute("aria-label");
    if (field.placeholder) return field.placeholder.replace(/\.\.\.$/, "");
    return "este campo";
  }

  function messageFor(field) {
    const v = field.validity;
    const label = fieldLabel(field);

    if (v.valueMissing) {
      if (field.tagName === "SELECT") return `Selecione ${label.toLowerCase().startsWith("selecione") ? "uma opção" : label.toLowerCase()}.`;
      return `Preencha ${label.toLowerCase()}.`;
    }
    if (v.typeMismatch && field.type === "email") return "Digite um e-mail válido.";
    if (v.typeMismatch && field.type === "url")   return "Digite uma URL válida (com http:// ou https://).";
    if (v.tooShort)   return `Use pelo menos ${field.minLength} caracteres.`;
    if (v.tooLong)    return `Use no máximo ${field.maxLength} caracteres.`;
    if (v.rangeUnderflow) return `O valor mínimo é ${field.min}.`;
    if (v.rangeOverflow)  return `O valor máximo é ${field.max}.`;
    if (v.patternMismatch) return field.dataset.errorPattern || `Formato inválido para ${label.toLowerCase()}.`;
    if (v.badInput)  return "Digite um valor válido.";
    return field.dataset.errorGeneric || "Verifique este campo antes de continuar.";
  }

  function errorElFor(field) {
    let el = field._customErrorEl;
    if (el && el.isConnected) return el;

    el = document.createElement("p");
    el.className = "field-error";
    el.setAttribute("role", "alert");
    field._customErrorEl = el;

    // Insere logo depois do campo (ou do wrapper mais próximo com essa
    // convenção, quando existir, pra não quebrar layouts em grid/flex).
    const wrapper = field.closest(".form-group, .edit-field, .field-wrap") || field.parentElement;
    wrapper.insertBefore(el, field.nextSibling === wrapper ? null : field.nextSibling);
    if (!wrapper.contains(el)) wrapper.appendChild(el);
    return el;
  }

  function showError(field) {
    field.classList.add("is-invalid");
    field.setAttribute("aria-invalid", "true");
    const el = errorElFor(field);
    el.textContent = messageFor(field);
    el.hidden = false;
  }

  function clearError(field) {
    field.classList.remove("is-invalid");
    field.removeAttribute("aria-invalid");
    if (field._customErrorEl) field._customErrorEl.hidden = true;
  }

  // Campos "required" dentro de uma aba/seção escondida (display:none, via
  // [hidden] ou classe) não podem bloquear o envio do formulário — só a
  // aba/seção visível no momento importa. checkValidity() do próprio campo
  // NÃO exclui isso sozinho (um <input required> dentro de um ancestral
  // hidden ainda conta como inválido), por isso o cheque de visibilidade
  // é explícito aqui, no estilo :visible do jQuery.
  function isVisible(field) {
    return !!(field.offsetWidth || field.offsetHeight || field.getClientRects().length);
  }

  function isValidatable(field) {
    return field.willValidate && !field.disabled && field.type !== "hidden" && isVisible(field);
  }

  function attachForm(form) {
    if (form.dataset.customValidation) return;
    form.dataset.customValidation = "1";
    form.setAttribute("novalidate", "");

    form.querySelectorAll("input, textarea, select").forEach(field => {
      field.addEventListener("input", () => { if (field.validity.valid) clearError(field); });
      field.addEventListener("change", () => { if (field.validity.valid) clearError(field); });
      field.addEventListener("invalid", e => e.preventDefault());
    });

    form.addEventListener("submit", function (e) {
      const fields = Array.from(form.querySelectorAll("input, textarea, select")).filter(isValidatable);
      const invalidFields = fields.filter(f => !f.checkValidity());

      fields.filter(f => f.checkValidity()).forEach(clearError);
      invalidFields.forEach(showError);

      if (invalidFields.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        invalidFields[0].focus();
      }
    }, true);
  }

  function init() {
    document.querySelectorAll("form").forEach(attachForm);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Formulários montados depois via JS (ex.: modais abertos dinamicamente)
  // também passam a validar — sem isso, só os <form> já presentes no HTML
  // inicial seriam cobertos.
  new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.tagName === "FORM") attachForm(node);
        node.querySelectorAll?.("form").forEach(attachForm);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
