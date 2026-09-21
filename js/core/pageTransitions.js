const transitionDuration = 220;

const loaderMarkup = `
  <div class="page-loader" data-page-loader role="status" aria-live="polite" aria-label="Loading LogMate">
    <span class="page-loader-mark" aria-hidden="true"></span>
    <span class="page-loader-label">Loading</span>
  </div>`;

const finishLoading = () => {
  const loader = document.querySelector("[data-page-loader]");
  if (!loader) return;
  loader.classList.add("is-complete");
  window.setTimeout(() => loader.remove(), 260);
  document.documentElement.removeAttribute("aria-busy");
};

const startNavigation = (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0) return;
  if (
    link.target === "_blank" ||
    link.hasAttribute("download") ||
    link.origin !== window.location.origin ||
    (link.pathname === window.location.pathname && link.hash)
  ) return;

  event.preventDefault();
  document.body.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = link.href;
  }, transitionDuration);
};

document.documentElement.setAttribute("aria-busy", "true");
document.body.insertAdjacentHTML("afterbegin", loaderMarkup);
document.body.classList.add("is-entering");
window.requestAnimationFrame(() => document.body.classList.add("is-ready"));
document.addEventListener("click", startNavigation);
window.addEventListener("load", () => window.setTimeout(finishLoading, 120), { once: true });

window.LogMateUI = { finishLoading };