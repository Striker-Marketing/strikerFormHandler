# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Single-file vanilla JS module (`strikerFormHandler.js`) — no `package.json`, no build step, no tests, no linter. **Everything lives inside the `strikerFormHandler` arrow function**: it is the only top-level declaration in the file, so dropping the script on a page leaks nothing else into global scope. Add new constants and helpers inside it, not above it. Meant to be loaded directly via `<script>` tag on a marketing site (typically a static/WordPress page) and invoked with `strikerFormHandler({ ... })` on `DOMContentLoaded`. All external deps (`intl-tel-input`, `grecaptcha` enterprise, Google Maps JS) are lazy-loaded from CDNs at runtime.

## Entry point

`strikerFormHandler({ formId, hasPhoneNumber, phoneNumberIsRequired, phoneNumberIsExternal, ghl, address_autofill, submitFunction })` at `strikerFormHandler.js:1`. Constants come first, then helpers, then the executable body starting at `const form = document.getElementById(formId)`. Helpers close over `form`, `urlParams`, `ghl`, `iti`, `address_autofill`, and `addressField` rather than taking them as arguments.

- `formId`: DOM id of the `<form>` element.
- `hasPhoneNumber` + `phoneNumberIsExternal`: if the form has a phone field, the handler wires it to intl-tel-input **unless** `phoneNumberIsExternal` is true (in which case the caller manages the phone field themselves and the value is read as-is).
- `ghl`: optional GoHighLevel integration config. If `ghl.formId` is set, the handler injects the Google reCAPTCHA Enterprise script and POSTs to GHL on submit.
- `address_autofill`: optional Google Places address autocomplete on the `[name='address']` input. Inert unless `address_autofill.key` is set.
- `submitFunction({ ghlResponse })`: callback invoked after a successful submit (after any GHL POST and after `dataLayer` events are pushed). Use this for redirects, thank-you messages, etc.

## GHL submission model

- Endpoint switches on `ghl.isSurvey`: forms → `backend.leadconnectorhq.com/forms/submit`, surveys → `.../surveys/submit`.
- `GHL_STANDARD_FIELDS` (`strikerFormHandler.js:21`) are looked up by `name` attribute directly. Anything else must be declared via `ghl.customFields`.
- `ghl.customFields` is an array of `[fieldName, fieldId, marker]` tuples (`applyCustomField` at `strikerFormHandler.js:365`):
  - `fieldName` — the `name` attribute on the input.
  - `fieldId` — the GHL custom field id the value is submitted under.
  - `marker === "group"` — treats the field as part of an array (multi-checkbox); unchecked checkboxes are skipped.
  - `type="file"` inputs are appended to `FormData` directly and validated against `GHL_ALLOWED_FILE_EXTS`. All other values go into the `body` object that is JSON-stringified into `formData.formData`.
- Radio groups are read via `[name]:checked`.
- `terms_and_conditions` has two modes: if included in `ghl.fields`, values come from checked `[name='terms_and_conditions']` inputs; otherwise `ghl.terms_and_conditions` (or `GHL_DEFAULT_TERMS`) is submitted as a fixed string.
- reCAPTCHA v3 token is fetched via `grecaptcha.enterprise.execute(ghl.captchaToken, { action: "submit" })` and appended as `captchaV3`.

## Tracking behavior

- All current URL query params are copied into hidden `<input>`s appended to the form before submit (`strikerFormHandler.js:517`), so any downstream integration also sees them.
- Query params are also forwarded to GHL as `eventData.url_params`, plus a derived `campaign` (from `utm_campaign` or `gad_campaignid`) and current `page.url` / `page.title`.
- `ghl.hasTaboola` — when set, that key on `body` receives `urlParams.get("tbclid")`.
- `ghl.hasPath` — when set, that key on `body` receives `window.location.pathname`.
- On successful submit, both `form-submitted` and `form_submitted` events are pushed to `window.dataLayer` (kebab and snake variants intentional — GTM triggers in the field use both).

## Phone number handling

- `intl-tel-input` version is pinned in `ITI_VERSION` near the top of the `strikerFormHandler` function. When bumping, update all three CDN URLs together.
- `loadItiAssets()` memoizes on `window.__itiAssetsPromise` so multiple handlers on the same page share one load.
- `iti.getNumber()` (E.164) overwrites `phoneField.value` right before submit so any non-GHL handler also sees the normalized number.
- `initialCountryLookup` (v29 replacement for `geoIpLookup`) is `lookupInitialCountry()`, which calls `ipapi.co/json` for initial-country detection and falls back to `"US"`. It only runs when `initialCountry` is unset, so do not add `initialCountry` back.
- That lookup is cached twice over, because ipapi.co's free tier is quota-limited and these scripts run on high-traffic landing pages: memoized on `window.__itiCountryPromise` (several handlers on one page share one request) and persisted to `localStorage` under `sfh_iti_country` for `ITI_COUNTRY_CACHE_TTL_MS` (24h), so repeat visits and multi-step journeys do not re-request.
- ipapi.co answers a throttled request with HTTP 200 and `{error:true, reason:"RateLimited"}`, so the response is validated against `/^[a-z]{2}$/` rather than trusted. Failures and fallbacks are never written to the cache — a transient outage must not pin a visitor to `"US"` for a day.

## Address autofill

- Config: `address_autofill = { key, single_field, countries, types }`. `key` is a Google Maps JS API key; the whole feature is skipped when it is absent, and warns (without failing) when the form has no `[name='address']` input.
- The Cloud project needs **Places API (New)** (`places.googleapis.com`) enabled and selected in the key's API restrictions, alongside Maps JavaScript API. The legacy "Places API" is a different service and does not satisfy it — a key with only that returns `403 ... AutocompletePlaces are blocked`.
- `includedPrimaryTypes` takes at most five **Table A/B** types; the legacy `"address"` type collection is invalid in the new API and 400s the whole request. Default is `ADDRESS_DEFAULT_TYPES` (`street_address`, `subpremise`, `premise`). Passing `types: []` omits the filter entirely — the escape hatch when the default is too narrow for a market.
- Uses **`AutocompleteSuggestion.fetchAutocompleteSuggestions()`** (Places API New) plus a dropdown we render ourselves — *not* `PlaceAutocompleteElement`, which creates its own input inside a closed shadow DOM and could not inherit the client site's styling. The existing `<input>` is upgraded in place, exactly like `initPhoneInput` does for the phone field.
- `google.maps.places.Autocomplete` (the legacy class `old.html` uses) is unavailable to Google Cloud projects created after 2025-03-01. Do not reintroduce it.
- `loadGoogleMapsAssets()` memoizes on `window.__googleMapsPromise`, and skips script injection entirely if the page already exposes `google.maps.importLibrary`.
- `single_field: true` writes `place.formattedAddress` into `[name='address']` and touches nothing else. `single_field: false` spreads across the GHL standard names — `address` (street_number + route + subpremise), `city`, `state`, `postal_code` (+ suffix), `country` — each skipped silently when that input is missing. These are the same names `GHL_STANDARD_FIELDS` submits, so no extra mapping config is needed.
- Values: `state` is the **long** name (`"California"`), `country` is the **short** ISO code (`"US"`). `setAddressField` is `<select>`-aware — it matches an option by value, then by visible text, so `"California"` also selects `<option value="CA">`.
- Address components are matched with `types.includes(...)`, never `types[0]` — component type order is not guaranteed.
- `ADDRESS_PLACE_FIELDS` must stay within the Place Details **Essentials** SKU tier. Adding `displayName` (Pro) would upgrade the billing tier of every lookup.
- One session token spans typing-through-selection and is replaced after each `fetchFields()`, so a completed pick bills as a single Autocomplete session. The token rides along on `toPlace()`; it is not passed to `fetchFields`. The 3-char minimum and 250ms debounce keep abandoned (per-request billed) sessions down.
- The dropdown's `Google Maps` footer is required by Places policy whenever predictions are shown without a Google map — do not remove it.
- The list is appended to `document.body` and positioned from the input's bounding rect; it is deliberately not wrapped around the input, which would break the flex/grid layouts these forms use. Styling defaults live in `injectAddressAutofillStyles` and are all overridable via `--sfh-af-*` custom properties.
- Keys are public in client JS: they must be HTTP-referrer restricted and API-restricted to *Maps JavaScript API* + *Places API (New)*.
