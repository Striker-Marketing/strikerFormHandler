const strikerFormHandler = ({
  formId,
  hasPhoneNumber,
  phoneNumberIsRequired,
  phoneNumberIsExternal,
  forceItiCountry,
  ghl = { formId: undefined, terms_and_conditions: undefined, location_id: undefined, isSurvey: undefined, captchaToken: undefined, updateContactOnly: undefined, fields: undefined, customFields: undefined, hasPath: undefined, hasTaboola: undefined },
  address_autofill = { key: undefined, single_field: undefined, countries: undefined, types: undefined },
  submitFunction = () => {},
}) => {
  const ITI_VERSION = "29.0.4";
  const ITI_CSS_HREF = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/css/intlTelInput.css`;
  const ITI_JS_SRC = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/js/intlTelInput.min.js`;
  const ITI_UTILS_SRC = `https://cdn.jsdelivr.net/npm/intl-tel-input@${ITI_VERSION}/dist/js/utils.js`;
  const ITI_COUNTRY_ENDPOINT = "https://ipapi.co/json";
  const ITI_COUNTRY_CACHE_KEY = "sfh_iti_country";
  const ITI_COUNTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const ITI_COUNTRY_FALLBACK = "US";

  const MAPS_JS_SRC = "https://maps.googleapis.com/maps/api/js";
  //* Copied off the address input onto the suggestion dropdown so it matches the form it hangs under.
  //* Longhands only: computed shorthands like `border` and `font` come back empty in Chrome.
  const ADDRESS_DROPDOWN_STYLES = ["font-family", "font-size", "color", "border-radius"];
  //* Shorter than this and the predictions are too broad to be worth a request.
  const ADDRESS_MIN_QUERY_LENGTH = 3;
  const ADDRESS_DEBOUNCE_MS = 250;
  //* How long the dropdown survives a blur, so a tap on an option still lands on it.
  const ADDRESS_BLUR_GRACE_MS = 300;
  const ADDRESS_SPINNER_SIZE = 18;
  //* "Powered by Google" is mandatory once predictions are rendered outside Google's own widget:
  //* https://developers.google.com/maps/documentation/javascript/policies
  const ADDRESS_ATTRIBUTION_LIGHT = "https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png";
  const ADDRESS_ATTRIBUTION_DARK = "https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-non-white3.png";
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
  //* Shared by the submit button and the address field, so the two spinners can never drift apart.
  const buildSpinnerSvg = (size, extraStyle = "") => `
        <svg style="display:block;${extraStyle}" width="${size}" height="${size}" stroke="currentColor"
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

  //* The whole address feature: the Places lookup, the dropdown it renders, and the state the two
  //* share. Nothing leaks out to the rest of the handler — [name='address'] is the only contract, and
  //* buildGhlBody reads it exactly as it would if this never ran.
  const initPlaces = async () => {
    try {
      const { AutocompleteSuggestion, AutocompleteSessionToken } = await loadGoogleMapsAssets(address_autofill.key);

      let suggestions = [];
      let activeIndex = -1;
      let sessionToken = null;
      let isApplyingPlace = false;
      let debounceTimer = null;
      let blurTimer = null;
      let requestSeq = 0;

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
        //* Only a missing *input* is a skip. A missing *component* means the picked place genuinely has
        //* no street (or city, …), so the field has to be cleared — otherwise it keeps the visitor's raw
        //* search text, or whatever a previous pick left there.
        if (!field) return;
        //* Normalised up front: formattedAddress can come back undefined, and `field.value = undefined`
        //* writes the literal string "undefined".
        const nextValue = value || "";

        if (field.tagName === "SELECT") {
          const options = Array.from(field.options);
          //* Clearing a <select> means selecting its own blank option; one that has none — a fixed state
          //* list — has no meaningful cleared state, so keep the current selection over blanking it.
          const option = nextValue ? options.find((item) => item.value.toLowerCase() === nextValue.toLowerCase()) || options.find((item) => item.text.trim().toLowerCase() === nextValue.toLowerCase()) : options.find((item) => item.value === "");
          if (!option) return;
          field.value = option.value;
        } else {
          field.value = nextValue;
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
        //* postal_code_suffix (the "+4") is deliberately ignored: GHL and US lead forms want the bare
        //* 5-digit ZIP, and a hyphenated value gets mangled by input masks and numeric fields downstream.
        const postalCode = getAddressComponent(components, ["postal_code"]);

        //* subpremise comes back either bare ("200") or already labelled ("Suite 200"); only the bare form needs a #.
        const unit = /^\d+$/.test(subpremise) ? `#${subpremise}` : subpremise;
        setAddressField("address", [street, unit].filter(Boolean).join(" "));
        setAddressField("city", getAddressComponent(components, ADDRESS_CITY_TYPES));
        setAddressField("state", getAddressComponent(components, ["administrative_area_level_1"]));
        setAddressField("postal_code", postalCode);
        setAddressField("country", getAddressComponent(components, ["country"], true));
      };

      //* One <style> for the whole page — several handlers share it, and each dropdown carries its own
      //* --sfh-af-* values inline, copied off its own form's address input.
      const injectAddressStyles = () => {
        if (window.__sfhAddressStylesInjected) return;
        window.__sfhAddressStylesInjected = true;
        const style = document.createElement("style");
        style.textContent = `
          .sfh-address-suggestions{position:absolute;z-index:2147483000;box-sizing:border-box;margin:0;padding:0;list-style:none;overflow:hidden auto;max-height:min(60vh,320px);overscroll-behavior:contain;font-family:var(--sfh-af-font-family);font-size:var(--sfh-af-font-size);color:var(--sfh-af-color);background:var(--sfh-af-surface);border-radius:var(--sfh-af-border-radius);box-shadow:0 1px 2px 0 rgba(60,64,67,.3),0 2px 6px 2px rgba(60,64,67,.15)}
          .sfh-address-suggestions[hidden]{display:none}
          .sfh-address-suggestion{display:flex;flex-direction:column;gap:2px;padding:10px 12px;cursor:pointer;text-align:left}
          .sfh-address-suggestion:hover,.sfh-address-suggestion[aria-selected='true']{background:var(--sfh-af-highlight)}
          .sfh-address-suggestion-secondary{font-size:.85em;opacity:.7}
          .sfh-address-attribution{display:flex;justify-content:flex-end;padding:6px 12px}
          .sfh-address-attribution img{display:block;width:auto;height:14px}
      .sfh-address-spinner{position:absolute;z-index:2147483000;line-height:0;pointer-events:none}
      .sfh-address-spinner[hidden]{display:none}
        `;
        //* Prepended so a site's own .sfh-address-* rules, landing later in the cascade, still win.
        document.head.prepend(style);
      };

      //* rgb()/rgba() is all getComputedStyle ever returns for a colour, so parsing the digits is enough.
      const parseColorChannels = (color) => (color.match(/[\d.]+/g) || []).map(Number);

      //* An input that inherits the page's surface computes to a fully transparent background-color. The
      //* dropdown floats over arbitrary content, so it needs an opaque colour of its own to fall back to.
      const resolveAddressSurface = (computed) => {
        const channels = parseColorChannels(computed.backgroundColor);
        return channels.length >= 3 && channels[3] !== 0 ? computed.backgroundColor : "#ffffff";
      };

      const isDarkColor = (color) => {
        const [red, green, blue] = parseColorChannels(color);
        if (red === undefined) return false;
        return (red * 299 + green * 587 + blue * 114) / 1000 < 128;
      };

      //* Google's own widget rendered this for us; a hand-rolled prediction list has to show it itself.
      //* The asset variant follows the dropdown's surface so the logo stays legible either way.
      const buildAddressAttribution = (surface) => {
        const item = document.createElement("li");
        item.className = "sfh-address-attribution";
        item.setAttribute("role", "presentation");
        const image = document.createElement("img");
        image.src = isDarkColor(surface) ? ADDRESS_ATTRIBUTION_DARK : ADDRESS_ATTRIBUTION_LIGHT;
        image.alt = "Powered by Google";
        item.append(image);
        return item;
      };

      const buildSuggestionList = (computed) => {
        const surface = resolveAddressSurface(computed);
        const list = document.createElement("ul");
        list.className = "sfh-address-suggestions";
        list.id = `sfh-address-suggestions-${formId}`;
        list.dataset.sfhAf = formId;
        list.setAttribute("role", "listbox");
        list.hidden = true;
        ADDRESS_DROPDOWN_STYLES.forEach((property) => list.style.setProperty(`--sfh-af-${property}`, computed.getPropertyValue(property)));
        list.style.setProperty("--sfh-af-surface", surface);
        list.style.setProperty("--sfh-af-highlight", isDarkColor(surface) ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.06)");
        //* Appended to <body> rather than next to the input: an ancestor with overflow:hidden or its own
        //* stacking context — routine on page-builder layouts — would otherwise clip the dropdown.
        document.body.appendChild(list);
        return list;
      };

      //* Same <body>-anchored trick as the dropdown, for the same reason: it sits over the input
      //* without touching the page's markup, and no ancestor overflow can clip it away.
      const buildSpinner = (computed) => {
        const element = document.createElement("div");
        element.className = "sfh-address-spinner";
        element.dataset.sfhAf = formId;
        element.hidden = true;
        //* stroke="currentColor" inside the SVG, so this is what tints it to match the field's text.
        element.style.color = computed.color;
        element.innerHTML = buildSpinnerSvg(ADDRESS_SPINNER_SIZE);
        document.body.appendChild(element);
        return element;
      };

      //* Both overlays float off <body>, so both are placed from the field's live rect. The guard
      //* keeps the always-registered scroll listener free when there is nothing on screen to move.
      const positionAddressOverlays = () => {
        if (suggestionList.hidden && spinner.hidden) return;
        const rect = addressField.getBoundingClientRect();
        suggestionList.style.top = `${rect.bottom + window.scrollY + 4}px`;
        suggestionList.style.left = `${rect.left + window.scrollX}px`;
        suggestionList.style.width = `${rect.width}px`;
        spinner.style.top = `${rect.top + window.scrollY + (rect.height - ADDRESS_SPINNER_SIZE) / 2}px`;
        spinner.style.left = `${rect.right + window.scrollX - ADDRESS_SPINNER_SIZE - spinnerInset}px`;
      };

      const showSpinner = () => {
        spinner.hidden = false;
        positionAddressOverlays();
      };

      const hideSpinner = () => {
        spinner.hidden = true;
      };

      const openSuggestions = () => {
        suggestionList.hidden = false;
        addressField.setAttribute("aria-expanded", "true");
        positionAddressOverlays();
      };

      const closeSuggestions = () => {
        suggestions = [];
        activeIndex = -1;
        addressField.removeAttribute("aria-activedescendant");
        if (suggestionList.hidden) return;
        suggestionList.hidden = true;
        addressField.setAttribute("aria-expanded", "false");
      };

      const setActiveSuggestion = (index) => {
        const items = suggestionList.querySelectorAll(".sfh-address-suggestion");
        items.forEach((item, itemIndex) => item.setAttribute("aria-selected", String(itemIndex === index)));
        activeIndex = index;
        if (index === -1) {
          addressField.removeAttribute("aria-activedescendant");
          return;
        }
        addressField.setAttribute("aria-activedescendant", items[index].id);
        items[index].scrollIntoView({ block: "nearest" });
      };

      const renderSuggestions = (predictions) => {
        if (!predictions.length) {
          closeSuggestions();
          return;
        }

        suggestions = predictions;
        suggestionList.textContent = "";
        predictions.forEach((prediction, index) => {
          const item = document.createElement("li");
          item.className = "sfh-address-suggestion";
          item.id = `${suggestionList.id}-${index}`;
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", "false");

          const main = document.createElement("span");
          main.className = "sfh-address-suggestion-main";
          //* mainText and secondaryText are both nullable on a PlacePrediction; `text` always has a value.
          main.textContent = prediction.mainText?.text || prediction.text.text;
          item.append(main);

          const secondaryText = prediction.secondaryText?.text;
          if (secondaryText) {
            const secondary = document.createElement("span");
            secondary.className = "sfh-address-suggestion-secondary";
            secondary.textContent = secondaryText;
            item.append(secondary);
          }

          item.addEventListener("click", () => selectSuggestion(index));
          suggestionList.append(item);
        });

        suggestionList.append(buildAddressAttribution(suggestionList.style.getPropertyValue("--sfh-af-surface")));
        setActiveSuggestion(-1);
        openSuggestions();
      };

      const selectSuggestion = async (index) => {
        const prediction = suggestions[index];
        if (!prediction) return;
        closeSuggestions();

        try {
          showSpinner();
          const place = prediction.toPlace();
          await place.fetchFields({ fields: ADDRESS_PLACE_FIELDS });
          //* setAddressField dispatches input events; without this the write would look like typing and
          //* immediately fire a fresh lookup for the address that was just picked.
          isApplyingPlace = true;
          applyPlace(place);
          //* fetchFields closes the billing session, so the next keystroke has to open a new one.
          sessionToken = null;
        } catch (error) {
          console.error(error);
        } finally {
          hideSpinner();
          isApplyingPlace = false;
        }
      };

      const requestSuggestions = async (input) => {
        const seq = ++requestSeq;
        try {
          //* One token spans every keystroke up to the pick, so the whole lookup bills as a single
          //* Autocomplete session instead of one standalone request per keystroke.
          sessionToken = sessionToken || new AutocompleteSessionToken();

          const request = { input, sessionToken, includedRegionCodes: address_autofill.countries || ["us"] };
          //* An explicit empty `types` means "no primary type filter" — the escape hatch when the default
          //* is too narrow for a market, since an unsupported type makes the whole request 400.
          const types = address_autofill.types || ADDRESS_DEFAULT_TYPES;
          if (types.length) request.includedPrimaryTypes = types;

          const { suggestions: results } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
          //* A later keystroke already fired; its answer is the one that should win.
          if (seq !== requestSeq) return;
          hideSpinner();
          //* Query predictions carry no placePrediction and cannot be resolved to a place.
          renderSuggestions(results.map((result) => result.placePrediction).filter(Boolean));
        } catch (error) {
          //* A superseded request must not clear the spinner the newer keystroke just turned on.
          if (seq !== requestSeq) return;
          hideSpinner();
          closeSuggestions();
          console.error(error);
        }
      };

      injectAddressStyles();
      const addressStyles = getComputedStyle(addressField);
      const spinnerInset = parseFloat(addressStyles.paddingRight) || 10;
      const suggestionList = buildSuggestionList(addressStyles);
      const spinner = buildSpinner(addressStyles);

      //* Registered for good rather than around each open: positionAddressOverlays early-returns
      //* while both overlays are hidden, which is cheaper than the add/remove bookkeeping was.
      //* Capture phase so they also track a scrolling ancestor, not just the window.
      window.addEventListener("scroll", positionAddressOverlays, true);
      window.addEventListener("resize", positionAddressOverlays);

      //* The form's own input stays the input: nothing is hidden, nothing is swapped in beside it, so
      //* `required` is validated natively again and buildGhlBody keeps reading [name='address'] as the
      //* value carrier — whether the visitor picked a suggestion or just typed and submitted.
      addressField.setAttribute("autocomplete", "off");
      addressField.setAttribute("role", "combobox");
      addressField.setAttribute("aria-autocomplete", "list");
      addressField.setAttribute("aria-expanded", "false");
      addressField.setAttribute("aria-controls", suggestionList.id);

      addressField.addEventListener("input", () => {
        if (isApplyingPlace) return;
        clearTimeout(debounceTimer);
        const query = addressField.value.trim();
        if (query.length < ADDRESS_MIN_QUERY_LENGTH) {
          //* Clearing the field abandons the lookup, so the next one starts a session of its own.
          requestSeq += 1;
          sessionToken = null;
          hideSpinner();
          closeSuggestions();
          return;
        }
        //* Spins from the moment the lookup is scheduled, not from when the request fires: the
        //* debounce alone is 250ms, and toggling around a fast response would just flash.
        showSpinner();
        debounceTimer = setTimeout(() => requestSuggestions(query), ADDRESS_DEBOUNCE_MS);
      });

      addressField.addEventListener("keydown", (event) => {
        if (suggestionList.hidden || !suggestions.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          const wrapped = (activeIndex + step + suggestions.length) % suggestions.length;
          setActiveSuggestion(activeIndex === -1 ? (step === 1 ? 0 : suggestions.length - 1) : wrapped);
        } else if (event.key === "Enter" && activeIndex !== -1) {
          //* Without this the Enter that picks a suggestion would also submit the form.
          event.preventDefault();
          selectSuggestion(activeIndex);
        } else if (event.key === "Escape" || event.key === "Tab") {
          closeSuggestions();
        }
      });

      //* Keeps a desktop click from blurring the input at all...
      suggestionList.addEventListener("mousedown", (event) => event.preventDefault());
      //* ...while on touch, where the tap blurs first, the close is deferred so the click still lands
      //* on the option instead of on an element that has already been torn down.
      addressField.addEventListener("focusout", () => {
        clearTimeout(blurTimer);
        blurTimer = setTimeout(closeSuggestions, ADDRESS_BLUR_GRACE_MS);
      });
      addressField.addEventListener("focus", () => clearTimeout(blurTimer));
    } catch (error) {
      //* Autofill is an enhancement: any failure here leaves a plain, still-`required` text input that
      //* submits exactly as it would if the feature had never been configured.
      console.error(error);
    }
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
      const optionsObject = { loadUtils: () => import(ITI_UTILS_SRC) };
      if (forceItiCountry) {
        //* A caller-pinned country is authoritative, and iti ignores initialCountryLookup whenever
        //* initialCountry is set — so skip the ipapi round-trip and its loading state entirely, and
        //* stay off the static intlTelInput.autoCountry that every other form on the page shares.
        optionsObject.initialCountry = forceItiCountry;
        //* "OFF" is the only value that hides the selector; separateDialCode still renders the +NN.
        optionsObject.countrySelectorMode = "OFF";
      } else {
        optionsObject.initialCountryLookup = lookupInitialCountry;
      }
      iti = window.intlTelInput(phoneField, optionsObject);
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
    //* Fire and forget: the address field upgrades itself once the Maps API lands, and stays a plain
    //* text input if it never does.
    initPlaces();
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
    submitBtn.innerHTML = buildSpinnerSvg(24, "margin:auto;");
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
