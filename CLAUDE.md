# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Single-file vanilla JS module (`strikerFormHandler.js`) — no `package.json`, no build step, no tests, no linter. Meant to be loaded directly via `<script>` tag on a marketing site (typically a static/WordPress page) and invoked with `strikerFormHandler({ ... })` on `DOMContentLoaded`. All external deps (`intl-tel-input`, `grecaptcha` enterprise) are lazy-loaded from CDNs at runtime.

## Entry point

`strikerFormHandler({ formId, hasPhoneNumber, phoneNumberIsRequired, phoneNumberIsExternal, ghl, submitFunction })` at `strikerFormHandler.js:144`.

- `formId`: DOM id of the `<form>` element.
- `hasPhoneNumber` + `phoneNumberIsExternal`: if the form has a phone field, the handler wires it to intl-tel-input **unless** `phoneNumberIsExternal` is true (in which case the caller manages the phone field themselves and the value is read as-is).
- `ghl`: optional GoHighLevel integration config. If `ghl.formId` is set, the handler injects the Google reCAPTCHA Enterprise script and POSTs to GHL on submit.
- `submitFunction({ ghlResponse })`: callback invoked after a successful submit (after any GHL POST and after `dataLayer` events are pushed). Use this for redirects, thank-you messages, etc.

## GHL submission model

- Endpoint switches on `ghl.isSurvey`: forms → `backend.leadconnectorhq.com/forms/submit`, surveys → `.../surveys/submit`.
- `GHL_STANDARD_FIELDS` (`strikerFormHandler.js:33`) are looked up by `name` attribute directly. Anything else must be declared via `ghl.customFields`.
- `ghl.customFields` is an array of `[fieldName, fieldId, marker]` tuples (`applyCustomField` at `strikerFormHandler.js:56`):
  - `fieldName` — the `name` attribute on the input.
  - `fieldId` — the GHL custom field id the value is submitted under.
  - `marker === "group"` — treats the field as part of an array (multi-checkbox); unchecked checkboxes are skipped.
  - `type="file"` inputs are appended to `FormData` directly and validated against `GHL_ALLOWED_FILE_EXTS`. All other values go into the `body` object that is JSON-stringified into `formData.formData`.
- Radio groups are read via `[name]:checked`.
- `terms_and_conditions` has two modes: if included in `ghl.fields`, values come from checked `[name='terms_and_conditions']` inputs; otherwise `ghl.terms_and_conditions` (or `GHL_DEFAULT_TERMS`) is submitted as a fixed string.
- reCAPTCHA v3 token is fetched via `grecaptcha.enterprise.execute(ghl.captchaToken, { action: "submit" })` and appended as `captchaV3`.

## Tracking behavior

- All current URL query params are copied into hidden `<input>`s appended to the form before submit (`strikerFormHandler.js:175`), so any downstream integration also sees them.
- Query params are also forwarded to GHL as `eventData.url_params`, plus a derived `campaign` (from `utm_campaign` or `gad_campaignid`) and current `page.url` / `page.title`.
- `ghl.hasTaboola` — when set, that key on `body` receives `urlParams.get("tbclid")`.
- `ghl.hasPath` — when set, that key on `body` receives `window.location.pathname`.
- On successful submit, both `form-submitted` and `form_submitted` events are pushed to `window.dataLayer` (kebab and snake variants intentional — GTM triggers in the field use both).

## Phone number handling

- `intl-tel-input` version is pinned in `ITI_VERSION` at the top of the file. When bumping, update all three CDN URLs together.
- `loadItiAssets()` memoizes on `window.__itiAssetsPromise` so multiple handlers on the same page share one load.
- `iti.getNumber()` (E.164) overwrites `phoneField.value` right before submit so any non-GHL handler also sees the normalized number.
- `geoIpLookup` calls `ipapi.co/json` for initial-country detection.
