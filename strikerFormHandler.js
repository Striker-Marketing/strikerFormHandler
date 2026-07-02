const ITI_VERSION = "29.0.4";
const ITI_CSS_HREF = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/css/intlTelInput.css`;
const ITI_JS_SRC = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/js/intlTelInput.min.js`;
const ITI_UTILS_SRC = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/js/utils.js`;

const loadItiAssets = () => {
  if (window.__itiAssetsPromise) return window.__itiAssetsPromise;
  window.__itiAssetsPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${ITI_CSS_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = ITI_CSS_HREF;
      document.head.appendChild(link);
    }
    if (window.intlTelInput) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = ITI_JS_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load intl-tel-input"));
    document.head.appendChild(script);
  });
  return window.__itiAssetsPromise;
};

const GHL_ENDPOINTS = {
  form: "https://backend.leadconnectorhq.com/forms/submit",
  survey: "https://backend.leadconnectorhq.com/surveys/submit",
};

const GHL_STANDARD_FIELDS = ["full_name", "first_name", "last_name", "email", "address", "country", "city", "state", "postal_code", "organization", "website"];

const GHL_DEFAULT_TERMS = "I agree to terms & conditions provided by the company. By providing my phone number, I agree to receive text messages from the business.";
const GHL_ALLOWED_FILE_EXTS = ["doc", "docx", "txt", "pdf", "jpg", "jpeg", "png"];

const injectGhlCaptcha = (captchaToken) => {
  const style = document.createElement("style");
  style.textContent = `.grecaptcha-badge{width:0 !important;height: 0!important}`;
  document.head.appendChild(style);

  const script = document.createElement("script");
  script.src = `https://www.google.com/recaptcha/enterprise.js?render=${captchaToken}`;
  script.async = true;
  script.type = "text/javascript";
  document.head.append(script);
};

const collectCheckedTerms = () => {
  const termsFields = Array.from(document.querySelectorAll("[name='terms_and_conditions']"));
  const values = termsFields.filter((f) => f.checked).map((f) => f.value);
  return values.length ? values.join("; ") : null;
};

const applyCustomField = ({ fieldPair, form, body, formData }) => {
  const [fieldName, fieldId, marker] = fieldPair;
  const selector = `[name='${fieldName}']`;
  const field = form.querySelector(selector);

  if (field?.type === "file") {
    for (const file of field.files) {
      const ext = file.name.split(".").pop().toLowerCase();
      if (!GHL_ALLOWED_FILE_EXTS.includes(ext)) {
        alert("File type not supported.");
        throw new Error("File type not supported.");
      }
      formData.append(fieldId, file, file.name);
    }
    return;
  }

  if (marker === "group") {
    if (field?.type === "checkbox" && !field.checked) return;
    body[fieldId] = body[fieldId] || [];
    body[fieldId].push(field?.value);
    return;
  }

  if (field?.type === "radio") {
    body[fieldId] = form.querySelector(`${selector}:checked`)?.value || "";
    return;
  }

  body[fieldId] = field?.value || "";
};

const buildGhlBody = ({ ghl, form, hasPhoneNumber, phoneNumberIsExternal, iti, urlParams }) => {
  const fields = ghl.fields || [];
  const body = {};

  if (ghl.hasTaboola) body[ghl.hasTaboola] = urlParams.get("tbclid");
  if (ghl.hasPath) body[ghl.hasPath] = window.location.pathname;
  if (hasPhoneNumber) {
    body.phone = phoneNumberIsExternal ? form.querySelector("[name='phone_number']")?.value || "" : iti?.getNumber() || "";
  }
  if (ghl.updateContactOnly) body.updateContactOnly = true;

  GHL_STANDARD_FIELDS.forEach((name) => {
    if (!fields.includes(name)) return;
    body[name] = form.querySelector(`[name='${name}']`)?.value || "";
  });

  if (fields.includes("terms_and_conditions")) {
    const terms = collectCheckedTerms();
    if (terms !== null) body.terms_and_conditions = terms;
  } else {
    body.terms_and_conditions = ghl.terms_and_conditions || GHL_DEFAULT_TERMS;
  }

  body.formId = ghl.formId;
  body.location_id = ghl.location_id;
  body.eventData = {
    url_params: Object.fromEntries(urlParams.entries()),
    campaign: urlParams.get("utm_campaign") || urlParams.get("gad_campaignid"),
    page: { url: window.location.href, title: document.title },
  };
  return body;
};

const submitGhl = async ({ ghl, form, hasPhoneNumber, phoneNumberIsExternal, iti, urlParams }) => {
  const formData = new FormData();
  const body = buildGhlBody({ ghl, form, hasPhoneNumber, phoneNumberIsExternal, iti, urlParams });
  ghl.customFields?.forEach((fieldPair) => applyCustomField({ fieldPair, form, body, formData }));

  formData.append("formData", JSON.stringify(body));
  formData.append("locationId", ghl.location_id);
  formData.append("formId", ghl.formId);

  let token;
  try {
    token = await grecaptcha.enterprise.execute(ghl.captchaToken, { action: "submit" });
  } catch {
    return Promise.reject("GHL captcha failed");
  }
  formData.append("captchaV3", token);

  const endpoint = ghl.isSurvey ? GHL_ENDPOINTS.survey : GHL_ENDPOINTS.form;
  const response = await fetch(endpoint, { method: "POST", body: formData });
  if (!response.ok) return Promise.reject("GHL response was not ok");
  return response.json();
};

const strikerFormHandler = ({ formId, hasPhoneNumber, phoneNumberIsRequired, phoneNumberIsExternal, ghl = { formId: undefined, terms_and_conditions: undefined, location_id: undefined, isSurvey: undefined, captchaToken: undefined, updateContactOnly: undefined, fields: undefined, customFields: undefined, hasPath: undefined, hasTaboola: undefined }, submitFunction = () => {} }) => {
  const form = document.getElementById(formId);
  const submitBtn = form.querySelector("[type='submit']");
  const urlParams = new URLSearchParams(window.location.search);

  if (ghl.formId) injectGhlCaptcha(ghl.captchaToken);

  const phoneField = hasPhoneNumber ? form.querySelector("[name='phone_number']") : null;
  let iti = null;
  if (phoneField && !phoneNumberIsExternal) {
    loadItiAssets().then(() => {
      iti = window.intlTelInput(phoneField, {
        initialCountry: "US",
        geoIpLookup: (success, failure) => {
          fetch("https://ipapi.co/json")
            .then((r) => r.json())
            .then((d) => success(d.country_code))
            .catch(() => failure());
        },
        loadUtils: () => import(ITI_UTILS_SRC),
      });
    });
  }

  const isPhoneValid = () => {
    if (!hasPhoneNumber || phoneNumberIsExternal) return true;
    if (!phoneNumberIsRequired && phoneField.value.trim() === "") return true;
    if (!iti) return false;
    return iti.isValidNumber();
  };

  const utms = Object.fromEntries(urlParams.entries());
  Object.keys(utms).forEach((key) => {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("hidden", "hidden");
    input.name = key;
    input.value = utms[key];
    form.appendChild(input);
  });

  const oldInner = submitBtn.innerHTML;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isPhoneValid()) {
      alert("Field invalid. Please check for typos.");
      return;
    }
    submitBtn.innerHTML = `
        <svg style="display:block;margin:auto;" width="24" height="24" stroke="#fff"
          viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <style>
            .spinner_V8m1 { transform-origin: center; animation: spinner_zKoa 2s linear infinite }
            .spinner_V8m1 circle { stroke-linecap: round; animation: spinner_YpZS 1.5s ease-in-out infinite }
            @keyframes spinner_zKoa { 100% { transform: rotate(360deg) } }
            @keyframes spinner_YpZS {
              0%           { stroke-dasharray: 0 150;  stroke-dashoffset: 0   }
              47.5%        { stroke-dasharray: 42 150; stroke-dashoffset: -16 }
              95%, 100%    { stroke-dasharray: 42 150; stroke-dashoffset: -59 }
            }
          </style>
          <g class="spinner_V8m1">
            <circle cx="12" cy="12" r="9.5" fill="none" stroke-width="3"></circle>
          </g>
        </svg>
      `;
    submitBtn.setAttribute("disabled", "disabled");
    if (hasPhoneNumber && iti && phoneField.value.trim() !== "") {
      phoneField.value = iti.getNumber();
    }
    try {
      let ghlResponse;
      if (ghl.formId) ghlResponse = await submitGhl({ ghl, form, hasPhoneNumber, phoneNumberIsExternal, iti, urlParams });
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "form-submitted" });
      window.dataLayer.push({ event: "form_submitted" });
      submitFunction({ ghlResponse });
    } catch (e) {
      submitBtn.innerHTML = oldInner;
      console.error(e);
    }
  });
};
