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
- **The whole feature lives inside `initPlaces()`** — the Places lookup, the dropdown it renders, and the state the two share are all locals of that one function, not siblings of the rest of the handler. `[name='address']` is the only thing it shares with the outside; keep new address helpers in there rather than at the top level.
- **Uses the Autocomplete *Data* API, not Google's widget.** `AutocompleteSuggestion.fetchAutocompleteSuggestions()` fetches predictions and the handler renders its own `<ul>`; the form's existing `[name='address']` input is never hidden, swapped, or duplicated. `google.maps.places.Autocomplete` (the legacy class `old.html` uses) is unavailable to Cloud projects created after 2025-03-01 — do not reintroduce it.
- **Do not go back to `PlaceAutocompleteElement`.** It was used until 2026-08 and was dropped because on phones it hijacks the whole page: its base class builds a `<dialog class="full-window-autocomplete-dialog">` and `showModal()`s it whenever `matchMedia("only screen and (max-width: 450px)")` matches, replacing the form with a white Google search screen. Google exposes no option, attribute, or CSS hook to disable that (checked against the shipped `places.js`, the widget reference, and the Places UI Kit styling docs), and `BasicPlaceAutocompleteElement` extends the same base, so it behaves identically. Neutralising the media query from outside was tried and did not hold up in production.
- `loadGoogleMapsAssets()` memoizes on `window.__googleMapsPromise`, and skips script injection entirely if the page already exposes `google.maps.importLibrary`. It resolves to the `places` library, from which `initPlaces` destructures `AutocompleteSuggestion` and `AutocompleteSessionToken`.
- **Session tokens are the billing contract, and the main thing to not break.** One `AutocompleteSessionToken` is minted on the first keystroke, reused across every keystroke of that lookup, carried automatically into `place.fetchFields()`, then set back to `null` — `fetchFields` ends the session. A completed pick therefore bills as a single Autocomplete session at the **Essentials** tier, the same as the old widget. Dropping the token, or minting one per keystroke, silently bills every request separately. The token is also cleared when the visitor empties the field, since that abandons the session.
- Requests are debounced by `ADDRESS_DEBOUNCE_MS` and skipped under `ADDRESS_MIN_QUERY_LENGTH`, and each carries a `requestSeq` so a slow answer cannot overwrite a newer keystroke's results. Suggestions with no `placePrediction` are filtered out — those are query predictions and cannot resolve to a place.
- **Free text needs no special handling.** `[name='address']` *is* the input the visitor types into, so whatever they typed is already the submitted value whether or not they ever picked a suggestion. `required` is likewise validated natively again. Both of the old workarounds for the widget owning its own input — `syncAddressFreeText()`/`selectedAddressText` and `isAddressValid()`/`addressIsRequired` — are gone; do not reintroduce them.
- `applyPlace` writes through `setAddressField`, which dispatches `input`/`change`. `isApplyingPlace` gates the input listener for the duration, otherwise selecting a suggestion would immediately fire a fresh lookup for the address just picked.
- `single_field: true` writes `place.formattedAddress` into `[name='address']` and touches nothing else. `single_field: false` spreads across the GHL standard names — `address` (street_number + route + subpremise), `city`, `state`, `postal_code`, `country` — each skipped silently when that *input* is missing. A missing *component* is different and must not be conflated with it: `setAddressField` clears the field, because every pick has to fully describe the fields it owns. Without that, picking a place with no street leaves the visitor's raw search text sitting in `[name='address']`, and a second pick inherits the first one's ZIP. These are the same names `GHL_STANDARD_FIELDS` submits, so no extra mapping config is needed.
- Values: `state` is the **long** name (`"California"`), `country` is the **short** ISO code (`"US"`), `postal_code` is the bare 5-digit ZIP. `postal_code_suffix` (the "+4") is deliberately dropped — `old.html` appended it, but a hyphenated ZIP gets mangled into a run-together `750740051` by input masks and numeric fields downstream, and nothing consumes the +4. `setAddressField` is `<select>`-aware — it matches an option by value, then by visible text, so `"California"` also selects `<option value="CA">`. Clearing a `<select>` means selecting its own blank option; one that has none keeps its current selection rather than being blanked to `selectedIndex = -1`.
- Address components are matched with `types.includes(...)`, never `types[0]` — component type order is not guaranteed.
- `includedPrimaryTypes` takes at most five **Table A/B** types; the legacy `"address"` type collection is invalid in the new API and 400s the whole request. Default is `ADDRESS_DEFAULT_TYPES` (`street_address`, `subpremise`, `premise`). Passing `types: []` omits the filter entirely — the escape hatch when the default is too narrow for a market.
- `ADDRESS_PLACE_FIELDS` must stay within the Place Details **Essentials** SKU tier. Adding `displayName` (Pro) would upgrade the billing tier of every lookup.
- **A spinner shows while a lookup is in flight** — the same one the submit button uses, via the shared `buildSpinnerSvg(size, extraStyle)`; keep both on that helper so they cannot drift apart. It sits over the field's right edge, inset by the input's own `padding-right`, and is turned on when a lookup is *scheduled* rather than when the request fires: the debounce alone is 250ms, and toggling around a fast response would just flash. `selectSuggestion` spins again for the `fetchFields` round-trip. A superseded request returns before `hideSpinner()`, so it cannot clear the spinner a newer keystroke just turned on.
- **`positionAddressOverlays` places both overlays** off one `getBoundingClientRect()`, and its `scroll`/`resize` listeners are registered once for the lifetime of `initPlaces` rather than around each open. The early return while both are hidden makes that cheaper than the add/remove bookkeeping it replaced.
- **The dropdown is appended to `<body>`**, not next to the input, and positioned from `addressField.getBoundingClientRect()` on open plus `scroll` (capture) and `resize` while open. An ancestor with `overflow:hidden` or its own stacking context is routine on page-builder layouts and would otherwise clip it.
- **Styling** is one shared `<style>` (`injectAddressStyles`, guarded on `window.__sfhAddressStylesInjected`) whose rules read `--sfh-af-*` custom properties. Each list carries its own values inline, copied from `getComputedStyle(addressField)` for `ADDRESS_DROPDOWN_STYLES`. A transparent computed `background-color` — normal for an input inheriting the page surface — is resolved to `#ffffff` by `resolveAddressSurface`, because the dropdown floats over arbitrary content and needs an opaque colour. `isDarkColor` picks the highlight tint and the attribution asset off that surface. The `<style>` is `prepend`ed to `<head>` so a site's own `.sfh-address-*` rules, landing later in the cascade, still win — those class names are the public styling hook.
- **"Powered by Google" is mandatory now.** The old widget rendered its own attribution; a hand-rolled prediction list must display it (Maps JS policies). It is the last `<li>` in every open dropdown, from the gstatic assets in `ADDRESS_ATTRIBUTION_LIGHT`/`_DARK`. Do not remove it.
- Keyboard and ARIA are ours to maintain: the input carries `role="combobox"`/`aria-autocomplete`/`aria-expanded`/`aria-controls`/`aria-activedescendant`, the list is a `listbox` of `option`s. Enter on a highlighted suggestion **must** `preventDefault()`, or it submits the form. Closing on blur is deferred ~200ms and a `mousedown` handler on the list calls `preventDefault()` — on touch the tap blurs the input before the click lands, and without both the option would be gone by then.
- `initPlaces` is one `try/catch` around both the Maps load and the wiring. It runs fire-and-forget, so an uncaught failure would surface as an unhandled rejection; instead any failure (bad key, blocked API, offline) logs and leaves the plain, still-`required` input exactly as the page authored it, with the form fully usable.
