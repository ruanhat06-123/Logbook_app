const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const COOKIE_ATTRIBUTES = `; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax; Secure`;

export const readConsentCookie = (name) => {
  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
};

const setConsentCookie = (name, value) => {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}${COOKIE_ATTRIBUTES}`;
};

export const legalTermsMarkup = () => `
  <div class="consent-modal-backdrop" data-terms-modal hidden>
    <section class="consent-modal" role="dialog" aria-modal="true" aria-labelledby="terms-modal-title">
      <div class="eyebrow">LogMate / Terms</div>
      <h2 id="terms-modal-title">Terms and Conditions</h2>
      <div class="consent-legal-text" tabindex="0">
        <p><strong>1. About these terms.</strong> These Terms and Conditions govern your access to LogMate, including its web application, reports, integrations and support services. By selecting “I Accept the Terms”, you confirm that you have read and agree to these terms.</p>
        <p><strong>2. Account security.</strong> Provide accurate registration information and keep your password and authentication methods confidential. You are responsible for activity performed through your account and must report suspected unauthorised access promptly.</p>
        <p><strong>3. Records.</strong> LogMate lets you record journeys, mileage, fuel, expenses, vehicles, drivers and service events. You are responsible for entering accurate information, reviewing calculated values, retaining supporting documents and correcting errors.</p>
        <p><strong>4. SARS and regulatory use.</strong> LogMate is a record-keeping tool, not tax, accounting or legal advice. Reports may assist your administration but do not guarantee compliance with or acceptance by SARS, an employer, an auditor, a court or another authority. You remain responsible for the rules that apply to your circumstances.</p>
        <p><strong>5. Your information.</strong> You retain ownership of information you submit. You allow LogMate to host, process, back up, synchronise and display that information as reasonably necessary to provide and secure the service. You confirm that you have permission to submit information about other people or vehicles.</p>
        <p><strong>6. Privacy and cookies.</strong> Personal information is processed under the applicable LogMate privacy notice and South African data-protection requirements. Essential cookies support security and core functionality. Analytics and marketing cookies are used according to the preference selected on this device.</p>
        <p><strong>7. Acceptable use.</strong> Do not use LogMate unlawfully, infringe another person’s rights, upload malicious code, bypass security, reverse engineer the service, interfere with another user or submit information you are not authorised to process.</p>
        <p><strong>8. Availability and third-party services.</strong> Access may be interrupted for maintenance, security work, connectivity problems, events outside our control or changes to mapping, authentication, payment and other third-party services. Those providers may have their own terms and privacy policies.</p>
        <p><strong>9. Plans and limits.</strong> Paid features, plan limits, renewal terms and prices are shown at the point of purchase. Features may be restricted when payment fails, a plan expires or usage exceeds an advertised limit, subject to applicable law.</p>
        <p><strong>10. Intellectual property.</strong> LogMate, its design, software, names, logos and documentation belong to LogMate or its licensors. You receive a limited, non-exclusive, non-transferable right to use the service for lawful record keeping while your account is active.</p>
        <p><strong>11. Copyright.</strong> Copyright in the LogMate application, source code, interface, visual design, text, graphics, icons, reports, templates and documentation is owned by LogMate or its licensors and protected by applicable law. You may use these materials only for your own lawful use of LogMate. You may not copy, reproduce, adapt, publish, distribute, sell, remove copyright notices or create derivative works without written permission, except where law expressly permits it.</p>
        <p><strong>12. Suspension and closure.</strong> You may stop using LogMate or request account closure. We may suspend or terminate access where reasonably necessary to protect the service, investigate misuse, comply with law or address unpaid charges. Export records you need before closing your account.</p>
        <p><strong>13. Disclaimers and liability.</strong> LogMate is provided on an “as available” basis, and you should maintain your own backups. To the extent permitted by law, LogMate is not responsible for indirect loss, lost profits, missed deductions, penalties, data-entry errors or decisions made solely from a report. Nothing excludes liability that cannot lawfully be excluded.</p>
        <p><strong>14. Changes.</strong> We may update these terms when the service, law or regulatory expectations change. Material updates may require you to review and accept them before continued use.</p>
        <p><strong>15. Governing law and contact.</strong> These terms are governed by the laws of the Republic of South Africa. Questions about these terms or your account can be sent through the LogMate support channel.</p>
      </div>
      <div class="consent-modal-actions">
        <button class="btn btn-primary" type="button" data-accept-terms>I Accept the Terms</button>
        <button class="btn btn-secondary" type="button" data-close-terms>Close</button>
      </div>
    </section>
  </div>`;

export const setupCookieConsent = () => {
  if (document.querySelector("[data-cookie-banner]") || readConsentCookie("logmate_cookie_consent")) return;

  document.body.insertAdjacentHTML("beforeend", `
    <aside class="cookie-banner" data-cookie-banner aria-label="Cookie preferences">
      <div class="cookie-banner-content">
        <p><strong>Choose your cookie preferences</strong>Essential cookies keep LogMate secure. Analytics and marketing cookies help us improve the service and communicate relevant updates.</p>
        <div class="cookie-banner-actions">
          <button class="btn btn-primary" type="button" data-cookie-choice="essential_analytics_marketing">Accept All</button>
          <button class="btn btn-secondary" type="button" data-cookie-choice="essential_analytics">Limited</button>
          <button class="btn btn-secondary" type="button" data-cookie-choice="essential">Decline</button>
        </div>
      </div>
    </aside>`);

  document.querySelectorAll("[data-cookie-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      setConsentCookie("logmate_cookie_consent", button.dataset.cookieChoice);
      document.querySelector("[data-cookie-banner]")?.remove();
    });
  });
};

export const setupTermsConsent = () => {
  const warning = document.querySelector("[data-terms-warning]");
  const reviewButton = document.querySelector("[data-review-terms]");
  if (!warning || !reviewButton || document.querySelector("[data-terms-modal]")) return;

  document.body.insertAdjacentHTML("beforeend", legalTermsMarkup());
  const modal = document.querySelector("[data-terms-modal]");
  const closeModal = () => { modal.hidden = true; };
  const syncTermsState = () => {
    const accepted = readConsentCookie("logmate_tc_accepted") === "true";
    warning.hidden = accepted;
    document.querySelector("#terms-checkbox")?.toggleAttribute("checked", accepted);
    const signupButton = document.querySelector("#signup-button");
    if (signupButton && accepted) signupButton.disabled = false;
  };

  syncTermsState();
  reviewButton.addEventListener("click", () => {
    modal.hidden = false;
    modal.querySelector("[data-accept-terms]").focus();
  });
  modal.querySelector("[data-close-terms]").addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  modal.querySelector("[data-accept-terms]").addEventListener("click", () => {
    setConsentCookie("logmate_tc_accepted", "true");
    syncTermsState();
    closeModal();
  });
};
