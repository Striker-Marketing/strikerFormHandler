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
- Uses **`PlaceAutocompleteElement`**, Google's own widget. It brings its own input inside a closed shadow DOM and *cannot* adopt an existing one, so `initAddressAutofill` inserts it after the original `[name='address']` input and hides that input, keeping it in the DOM as the value carrier. Everything downstream (`buildGhlBody`, non-GHL backends) keeps reading `[name='address']` and needs no changes.
- `google.maps.places.Autocomplete` (the legacy class `old.html` uses) is unavailable to Google Cloud projects created after 2025-03-01. Do not reintroduce it.
- `loadGoogleMapsAssets()` memoizes on `window.__googleMapsPromise`, and skips script injection entirely if the page already exposes `google.maps.importLibrary`.
- **Two ways text reaches `[name='address']`.** `gmp-select` → `fetchFields` → `applyPlace` handles a picked suggestion. Free text the visitor typed without picking is copied over by `syncAddressFreeText()` at submit time. That function compares `autocompleteElement.value` against `selectedAddressText` (recorded after each successful pick) so it can tell a picked address from one typed over the top of it — without that guard it would clobber the street-only value that spread mode writes.
- **`required` is enforced in JS, not natively.** A `required` control that is `display:none` is not focusable, and Chrome refuses to submit the form at all with "An invalid form control is not focusable". So `initAddressAutofill` moves `required` off the hidden input into `addressIsRequired`, and `isAddressValid()` gates submit alongside `isPhoneValid()`.
- `single_field: true` writes `place.formattedAddress` into `[name='address']` and touches nothing else. `single_field: false` spreads across the GHL standard names — `address` (street_number + route + subpremise), `city`, `state`, `postal_code` (+ suffix), `country` — each skipped silently when that input is missing. These are the same names `GHL_STANDARD_FIELDS` submits, so no extra mapping config is needed.
- Values: `state` is the **long** name (`"California"`), `country` is the **short** ISO code (`"US"`). `setAddressField` is `<select>`-aware — it matches an option by value, then by visible text, so `"California"` also selects `<option value="CA">`.
- Address components are matched with `types.includes(...)`, never `types[0]` — component type order is not guaranteed.
- `includedPrimaryTypes` takes at most five **Table A/B** types; the legacy `"address"` type collection is invalid in the new API and 400s the whole request. Default is `ADDRESS_DEFAULT_TYPES` (`street_address`, `subpremise`, `premise`). Passing `types: []` omits the filter entirely — the escape hatch when the default is too narrow for a market.
- `ADDRESS_PLACE_FIELDS` must stay within the Place Details **Essentials** SKU tier. Adding `displayName` (Pro) would upgrade the billing tier of every lookup. The widget manages its own session tokens, so none are threaded through by hand.
- **Styling** is `inheritAddressFieldStyles()`: the widget's input is unreachable by page CSS, so the original input's computed values for `ADDRESS_INHERITED_STYLES` are copied into a generated `[data-sfh-af='<formId>']::part(input)` rule. Longhands only — computed `border` and `font` shorthands come back empty in Chrome. The `<style>` is `prepend`ed to `<head>` so a site's own `::part(input)` rules, landing later in the cascade, still win.
- Google's widget renders its own attribution, so nothing needs to be added for the Places policy.
- The whole of `initAddressAutofill` is wrapped in one `try/catch`. It runs fire-and-forget, so an uncaught failure would surface as an unhandled rejection; instead any failure (bad key, missing `PlaceAutocompleteElement` on an old Maps channel) logs and leaves the plain, still-`required` input in place with the form fully usable.
