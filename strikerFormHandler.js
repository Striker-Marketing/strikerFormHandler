const strikerFormHandler = ({ formId, hasPhoneNumber, phoneNumberIsRequired, phoneNumberIsExternal, ghl = { formId: undefined, terms_and_conditions: undefined, location_id: undefined, isSurvey: undefined, captchaToken: undefined, updateContactOnly: undefined, fields: undefined, customFields: undefined, hasPath: undefined, hasTaboola: undefined }, address_autofill = { key: undefined, single_field: undefined, countries: undefined, types: undefined }, submitFunction = () => {} }) => {
  const ITI_VERSION = "29.0.4";
  const ITI_CSS_HREF = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/css/intlTelInput.css`;
  const ITI_JS_SRC = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/js/intlTelInput.min.js`;
  const ITI_UTILS_SRC = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/js/utils.js`;
  const ITI_COUNTRY_ENDPOINT = "https://ipapi.co/json";
  const ITI_COUNTRY_CACHE_KEY = "sfh_iti_country";
  const ITI_COUNTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const ITI_COUNTRY_FALLBACK = "US";

  const MAPS_JS_SRC = "https://maps.googleapis.com/maps/api/js";
  const ADDRESS_STYLE_ID = "sfh-address-autofill-styles";
  const ADDRESS_MIN_CHARS = 3;
  const ADDRESS_DEBOUNCE_MS = 250;
  //* Place Details *Essentials*-tier fields only. Adding displayName would bill the whole call as Pro.
  const ADDRESS_PLACE_FIELDS = ["addressComponents", "formattedAddress"];
  //* Places API (New) takes up to five Table A/B types; the legacy "address" collection is not one of them.
  //* premise/subpremise cover named buildings and unit numbers that are not primary-typed street_address.
  const ADDRESS_DEFAULT_TYPES = ["street_address", "subpremise", "premise"];
  //* Ordered fallbacks: the first component type present wins.
  const ADDRESS_CITY_TYPES = ["locality", "postal_town", "sublocality_level_1", "administrative_area_level_3", "administrative_area_level_2"];

  const GHL_ENDPOINTS = {
    form: "https://backend.leadconnectorhq.com/forms/submit",
    survey: "https://backend.leadconnectorhq.com/surveys/submit",
  };

  const GHL_STANDARD_FIELDS = ["full_name", "first_name", "last_name", "email", "address", "country", "city", "state", "postal_code", "organization", "website"];

  const GHL_DEFAULT_TERMS = "I agree to terms & conditions provided by the company. By providing my phone number, I agree to receive text messages from the business.";
  const GHL_ALLOWED_FILE_EXTS = ["doc", "docx", "txt", "pdf", "jpg", "jpeg", "png"];

  const AD_SOURCE_MAP = [
    [["gclid", "gad_source", "gad_campaignid"], "google"],
    [["fbclid"], "facebook"],
    [["tbclid"], "taboola"],
    [["msclkid"], "bing"],
    [["ttclid"], "tiktok"],
  ];

  //* Memoized on window so multiple handlers on the same page share one load.
  const loadItiAssets = () => {
    if (window.__itiAssetsPromise) return window.__itiAssetsPromise;
    window.__itiAssetsPromise = (async () => {
      if (!document.querySelector(`link[href="${ITI_CSS_HREF}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = ITI_CSS_HREF;
        document.head.appendChild(link);
      }
      if (window.intlTelInput) return;
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = ITI_JS_SRC;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load intl-tel-input"));
        document.head.appendChild(script);
      });
    })();
    return window.__itiAssetsPromise;
  };

  const readCachedCountry = () => {
    try {
      const cached = JSON.parse(localStorage.getItem(ITI_COUNTRY_CACHE_KEY));
      return cached?.expires > Date.now() ? cached.country : null;
    } catch {
      //* Blocked storage, private mode, or a malformed entry: fall through to the network.
      return null;
    }
  };

  const writeCachedCountry = (country) => {
    try {
      localStorage.setItem(ITI_COUNTRY_CACHE_KEY, JSON.stringify({ country, expires: Date.now() + ITI_COUNTRY_CACHE_TTL_MS }));
    } catch {
      //* Nothing to do: the lookup still works, it just will not survive the page.
    }
  };

  //* Memoized on window so several handlers on one page share one lookup, and persisted so repeat visits
  //* and multi-step journeys do not burn ipapi.co's free daily quota again.
  const lookupInitialCountry = () => {
    if (window.__itiCountryPromise) return window.__itiCountryPromise;
    window.__itiCountryPromise = (async () => {
      const cached = readCachedCountry();
      if (cached) return cached;
      try {
        const response = await fetch(ITI_COUNTRY_ENDPOINT);
        const data = await response.json();
        //* ipapi.co answers a throttled request with 200 + {error:true}, so validate the payload rather
        //* than trust the status, otherwise we would cache a non-country for a day.
        const country = /^[a-z]{2}$/i.test(data?.country_code || "") ? data.country_code.toUpperCase() : "";
        if (!country) throw new Error(`Country lookup failed: ${data?.reason || "no country_code in response"}`);
        writeCachedCountry(country);
        return country;
      } catch (error) {
        console.warn(error);
        //* Deliberately not cached: a transient failure should not pin the visitor to the fallback for a day.
        return ITI_COUNTRY_FALLBACK;
      }
    })();
    return window.__itiCountryPromise;
  };

  //* Memoized on window so multiple handlers on the same page share one load.
  const loadGoogleMapsAssets = (key) => {
    if (window.__googleMapsPromise) return window.__googleMapsPromise;
    window.__googleMapsPromise = (async () => {
      if (!window.google?.maps?.importLibrary) {
        const callbackName = "__strikerMapsReady";
        await new Promise((resolve, reject) => {
          window[callbackName] = resolve;
          const script = document.createElement("script");
          script.src = `${MAPS_JS_SRC}?key=${encodeURIComponent(key)}&loading=async&libraries=places&callback=${callbackName}`;
          script.async = true;
          script.onerror = () => reject(new Error("Failed to load the Google Maps JS API"));
          document.head.appendChild(script);
        });
      }
      return google.maps.importLibrary("places");
    })();
    return window.__googleMapsPromise;
  };

  //* Neutral defaults driven by custom properties, so a site can restyle the dropdown without touching JS.
  const injectAddressAutofillStyles = () => {
    if (document.getElementById(ADDRESS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ADDRESS_STYLE_ID;
    style.textContent = `
      .sfh-af-list{position:absolute;z-index:2147483000;display:none;box-sizing:border-box;max-height:var(--sfh-af-max-height,280px);overflow-y:auto;margin:2px 0 0;padding:0;list-style:none;background:var(--sfh-af-bg,#fff);color:var(--sfh-af-color,#1f1f1f);border:1px solid var(--sfh-af-border-color,#d9d9d9);border-radius:var(--sfh-af-radius,4px);box-shadow:var(--sfh-af-shadow,0 4px 12px rgba(0,0,0,.15));font-family:var(--sfh-af-font,inherit);font-size:var(--sfh-af-font-size,14px);line-height:1.3;text-align:left}
      .sfh-af-list[data-open='true']{display:block}
      .sfh-af-item{padding:10px 12px;cursor:pointer}
      .sfh-af-item:hover,.sfh-af-item[data-active='true']{background:var(--sfh-af-active-bg,#f1f3f4)}
      .sfh-af-item-main{display:block}
      .sfh-af-item-secondary{display:block;margin-top:2px;color:var(--sfh-af-secondary-color,#5e5e5e);font-size:.85em}
      .sfh-af-attribution{padding:6px 12px;border-top:1px solid var(--sfh-af-border-color,#d9d9d9);color:#5e5e5e;font-size:12px;text-align:right}
    `;
    document.head.appendChild(style);
  };

  //* Component type order is not guaranteed, so match on `includes` rather than on types[0].
  const getAddressComponent = (components, types, useShortText) => {
    const match = components.find((component) => types.some((type) => component.types.includes(type)));
    if (!match) return "";
    return (useShortText ? match.shortText : match.longText) || "";
  };

  //* <select>-tolerant: match an option by value, then by visible text, so "Texas" also lands in the
  //* two-letter <option value="TX"> markup some forms use.
  const setAddressField = (name, value) => {
    const field = form.querySelector(`[name='${name}']`);
    if (!field || !value) return;

    if (field.tagName === "SELECT") {
      const options = Array.from(field.options);
      const option = options.find((item) => item.value.toLowerCase() === value.toLowerCase()) || options.find((item) => item.text.trim().toLowerCase() === value.toLowerCase());
      if (!option) return;
      field.value = option.value;
    } else {
      field.value = value;
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const applyPlace = (place) => {
    if (address_autofill.single_field) {
      setAddressField("address", place.formattedAddress);
      return;
    }

    const components = place.addressComponents || [];
    const street = [getAddressComponent(components, ["street_number"]), getAddressComponent(components, ["route"])].filter(Boolean).join(" ");
    const subpremise = getAddressComponent(components, ["subpremise"]);
    const postalCode = getAddressComponent(components, ["postal_code"]);
    const postalSuffix = getAddressComponent(components, ["postal_code_suffix"]);

    //* subpremise comes back either bare ("200") or already labelled ("Suite 200"); only the bare form needs a #.
    const unit = /^\d+$/.test(subpremise) ? `#${subpremise}` : subpremise;
    setAddressField("address", [street, unit].filter(Boolean).join(" "));
    setAddressField("city", getAddressComponent(components, ADDRESS_CITY_TYPES));
    setAddressField("state", getAddressComponent(components, ["administrative_area_level_1"]));
    setAddressField("postal_code", postalSuffix ? `${postalCode}-${postalSuffix}` : postalCode);
    setAddressField("country", getAddressComponent(components, ["country"], true));
  };

  const initAddressAutofill = async () => {
    let places;
    try {
      places = await loadGoogleMapsAssets(address_autofill.key);
    } catch (error) {
      console.error(error);
      return;
    }
    const { AutocompleteSessionToken, AutocompleteSuggestion } = places;

    injectAddressAutofillStyles();

    //* Appended to the body rather than wrapped around the input: wrapping would break the flex/grid
    //* layouts these forms are built with.
    const list = document.createElement("ul");
    list.className = "sfh-af-list";
    list.id = `sfh-af-list-${formId}`;
    list.setAttribute("role", "listbox");
    document.body.appendChild(list);

    //* Required by the Places policy whenever predictions are shown without a Google map.
    const attribution = document.createElement("li");
    attribution.className = "sfh-af-attribution";
    attribution.setAttribute("aria-hidden", "true");
    attribution.textContent = "Google Maps";

    addressField.setAttribute("autocomplete", "off");
    addressField.setAttribute("role", "combobox");
    addressField.setAttribute("aria-autocomplete", "list");
    addressField.setAttribute("aria-expanded", "false");
    addressField.setAttribute("aria-controls", list.id);

    //* One token covers a whole type-then-pick session; fetchFields closes it and we mint a new one.
    let sessionToken = new AutocompleteSessionToken();
    let suggestions = [];
    let activeIndex = -1;
    let requestId = 0;
    let debounceTimer;

    const positionList = () => {
      const rect = addressField.getBoundingClientRect();
      list.style.top = `${rect.bottom + window.scrollY}px`;
      list.style.left = `${rect.left + window.scrollX}px`;
      list.style.width = `${rect.width}px`;
    };

    const closeList = () => {
      list.dataset.open = "false";
      activeIndex = -1;
      addressField.setAttribute("aria-expanded", "false");
      addressField.removeAttribute("aria-activedescendant");
      window.removeEventListener("scroll", positionList, true);
      window.removeEventListener("resize", positionList);
    };

    const setActive = (index) => {
      activeIndex = index;
      Array.from(list.querySelectorAll(".sfh-af-item")).forEach((item, itemIndex) => {
        item.dataset.active = String(itemIndex === index);
      });
      if (index < 0) addressField.removeAttribute("aria-activedescendant");
      else addressField.setAttribute("aria-activedescendant", `${list.id}-${index}`);
    };

    const selectSuggestion = async (index) => {
      const suggestion = suggestions[index];
      if (!suggestion) return;
      closeList();
      try {
        //* The session token rides along on toPlace(); it is not passed to fetchFields.
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({ fields: ADDRESS_PLACE_FIELDS });
        applyPlace(place);
      } catch (error) {
        console.error(error);
      }
      sessionToken = new AutocompleteSessionToken();
    };

    const renderSuggestions = () => {
      list.innerHTML = "";
      if (!suggestions.length) {
        closeList();
        return;
      }

      suggestions.forEach((suggestion, index) => {
        const prediction = suggestion.placePrediction;
        const item = document.createElement("li");
        item.className = "sfh-af-item";
        item.id = `${list.id}-${index}`;
        item.setAttribute("role", "option");

        const mainText = document.createElement("span");
        mainText.className = "sfh-af-item-main";
        mainText.textContent = (prediction.mainText || prediction.text).toString();
        item.appendChild(mainText);

        const secondary = prediction.secondaryText?.toString();
        if (secondary) {
          const secondaryText = document.createElement("span");
          secondaryText.className = "sfh-af-item-secondary";
          secondaryText.textContent = secondary;
          item.appendChild(secondaryText);
        }

        //* mousedown, not click: it fires before the input's focusout closes the list.
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          selectSuggestion(index);
        });
        item.addEventListener("mousemove", () => setActive(index));
        list.appendChild(item);
      });

      list.appendChild(attribution);
      setActive(-1);
      positionList();
      list.dataset.open = "true";
      addressField.setAttribute("aria-expanded", "true");
      window.addEventListener("scroll", positionList, true);
      window.addEventListener("resize", positionList);
    };

    const fetchSuggestions = async (input) => {
      const currentRequest = ++requestId;
      try {
        const request = { input, sessionToken, includedRegionCodes: address_autofill.countries || ["us"] };
        //* An explicit empty `types` means "no primary type filter" — the escape hatch when the default
        //* is too narrow for a market, since an unsupported type makes the whole request 400.
        const types = address_autofill.types || ADDRESS_DEFAULT_TYPES;
        if (types.length) request.includedPrimaryTypes = types;

        const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        //* A slow response must never overwrite the results of a newer keystroke.
        if (currentRequest !== requestId) return;
        suggestions = response.suggestions.filter((suggestion) => suggestion.placePrediction);
        renderSuggestions();
      } catch (error) {
        console.error(error);
        suggestions = [];
        closeList();
      }
    };

    addressField.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const input = addressField.value.trim();
      if (input.length < ADDRESS_MIN_CHARS) {
        suggestions = [];
        closeList();
        return;
      }
      debounceTimer = setTimeout(() => fetchSuggestions(input), ADDRESS_DEBOUNCE_MS);
    });

    addressField.addEventListener("keydown", (event) => {
      if (list.dataset.open !== "true") return;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActive((activeIndex + 1) % suggestions.length);
          break;
        case "ArrowUp":
          event.preventDefault();
          setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
          break;
        case "Enter":
          if (activeIndex < 0) break;
          //* Without this, the Enter that picks a suggestion would also submit the form.
          event.preventDefault();
          selectSuggestion(activeIndex);
          break;
        case "Escape":
          closeList();
          break;
      }
    });

    addressField.addEventListener("focusout", closeList);
  };

  const getCookie = (name) => {
    const cookieMatch = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1")}=([^;]*)`));
    return cookieMatch ? decodeURIComponent(cookieMatch[1]) : "";
  };

  const getGaClientId = () => {
    const gaCookie = getCookie("_ga");
    if (!gaCookie) return "";
    const parts = gaCookie.split(".");
    return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : "";
  };

  const getFbc = () => {
    const cookie = getCookie("_fbc");
    if (cookie) return cookie;
    const fbclid = urlParams.get("fbclid");
    return fbclid ? `fb.1.${Date.now()}.${fbclid}` : "";
  };

  const getAdSource = () => {
    for (const [keys, name] of AD_SOURCE_MAP) {
      if (keys.some((paramName) => urlParams.get(paramName))) return name;
    }
    return "";
  };

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
    const values = termsFields.filter((termsField) => termsField.checked).map((termsField) => termsField.value);
    return values.length ? values.join("; ") : null;
  };

  const applyCustomField = ({ fieldPair, body, formData }) => {
    const [fieldName, fieldId, marker] = fieldPair;
    const selector = `[name='${fieldName}']`;
    const field = form.querySelector(selector);

    if (field?.type === "file") {
      for (const file of field.files) {
        const extension = file.name.split(".").pop().toLowerCase();
        if (!GHL_ALLOWED_FILE_EXTS.includes(extension)) {
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

  const buildGhlBody = () => {
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
      referrer: document.referrer,
      keyword: urlParams.get("utm_term") || "",
      adSource: getAdSource(),
      url_params: Object.fromEntries(urlParams.entries()),
      page: { url: window.location.href, title: document.title },
      timestamp: Date.now(),
      campaign: urlParams.get("utm_campaign") || urlParams.get("gad_campaignid"),
      fbp: getCookie("_fbp"),
      fbc: getFbc(),
      domain: window.location.hostname,
      documentURL: window.location.href,
      gaClientId: getGaClientId(),
      fbEventId: crypto.randomUUID(),
      medium: "form",
      mediumId: ghl.formId,
    };
    return body;
  };

  const submitGhl = async () => {
    const formData = new FormData();
    const body = buildGhlBody();
    ghl.customFields?.forEach((fieldPair) => applyCustomField({ fieldPair, body, formData }));

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

  const form = document.getElementById(formId);
  const submitBtn = form.querySelector("[type='submit']");
  const urlParams = new URLSearchParams(window.location.search);

  if (ghl.formId) injectGhlCaptcha(ghl.captchaToken);

  const phoneField = hasPhoneNumber ? form.querySelector("[name='phone_number']") : null;
  let iti = null;

  const initPhoneInput = async () => {
    try {
      await loadItiAssets();
      iti = window.intlTelInput(phoneField, {
        initialCountryLookup: lookupInitialCountry,
        loadUtils: () => import(ITI_UTILS_SRC),
      });
    } catch (error) {
      console.error(error);
    }
  };

  if (phoneField && !phoneNumberIsExternal) {
    //* Fire and forget: the phone field upgrades itself once the CDN assets land.
    initPhoneInput();
  }

  const addressField = address_autofill.key ? form.querySelector("[name='address']") : null;
  if (address_autofill.key && !addressField) console.warn("strikerFormHandler: address_autofill is configured but the form has no [name='address'] input.");
  if (addressField) {
    //* Fire and forget: the address field upgrades itself once the Maps API lands.
    initAddressAutofill();
  }

  const isPhoneValid = () => {
    if (!hasPhoneNumber || phoneNumberIsExternal) return true;
    if (!phoneNumberIsRequired && phoneField.value.trim() === "") return true;
    if (!iti) return false;
    return iti.isValidNumber();
  };

  const urlParamEntries = Object.fromEntries(urlParams.entries());
  Object.keys(urlParamEntries).forEach((paramName) => {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("hidden", "hidden");
    input.name = paramName;
    input.value = urlParamEntries[paramName];
    form.appendChild(input);
  });

  const originalSubmitLabel = submitBtn.innerHTML;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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
      if (ghl.formId) ghlResponse = await submitGhl();
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "form-submitted" });
      window.dataLayer.push({ event: "form_submitted" });
      submitFunction({ ghlResponse });
    } catch (error) {
      submitBtn.innerHTML = originalSubmitLabel;
      console.error(error);
    }
  });
};
