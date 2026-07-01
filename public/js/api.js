window.apiFetch = function (url, options = {}) {
  options.headers = Object.assign({ "X-Requested-With": "XMLHttpRequest" }, options.headers || {});
  return fetch(url, options);
};
