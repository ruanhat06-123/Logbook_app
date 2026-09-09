const readCookie = (name) => document.cookie.split("; ").find((item) => item.startsWith(`${name}=`));
const hasCachedAccount = () => {
  if (readCookie("logmate_email")) return true;
  return Object.keys(localStorage).some((key) => {
    if (!key.startsWith("sb-")) return false;
    try {
      return Boolean(JSON.parse(localStorage.getItem(key))?.user?.email);
    } catch {
      return false;
    }
  });
};

if (hasCachedAccount()) window.location.replace("html/login.html");

const pricingCatalog = await fetch("pricing.json").then((response) => response.json());
const formatPrice = (amount, suffix) => `${pricingCatalog.currency} ${Number(amount).toLocaleString("en-ZA")} / ${suffix}`;
const pricingCards = Object.entries(pricingCatalog.plans)
  .map(([tier, plan]) => `
    <article class="landing-price-card${tier === "premium" ? " featured" : ""}">
      <div class="eyebrow">${plan.label}</div>
      <div class="landing-price"><strong>${formatPrice(plan.monthly, "month")}</strong></div>
      <p>Flexible monthly billing.</p>
      <a class="btn ${tier === "premium" ? "btn-primary" : "btn-secondary"}" href="html/login.html?mode=signup">Get started →</a>
    </article>`)
  .join("");

document.querySelector(".landing-overview")?.insertAdjacentHTML(
  "afterend",
  `<section class="landing-pricing"><div><div class="eyebrow">Simple plans</div><h2>Choose the pace that fits.</h2><p>Start free, then upgrade when your records need more room. Free users can buy a SARS PDF export for ${formatPrice(pricingCatalog.sarsExport.price, "export")}.</p></div><div class="landing-price-grid">${pricingCards}</div></section>`,
);
