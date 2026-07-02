# Striker Form Handler

A single-file, vanilla JS form handler for marketing sites. Wires a plain HTML `<form>` to:

- GoHighLevel (GHL) form/survey submission with reCAPTCHA Enterprise
- International phone input via [intl-tel-input](https://github.com/jackocnr/intl-tel-input) (lazy-loaded from CDN)
- UTM / query-param capture as hidden fields and in `eventData`
- Google Tag Manager `dataLayer` events (`form-submitted`, `form_submitted`)
- File uploads to GHL custom fields
- Post-submit callback for redirects, thank-you screens, etc.

No build step. No dependencies to install. Drop the script on the page, call `strikerFormHandler(...)` once per form.

## Install

Load the minified build from jsDelivr and invoke `strikerFormHandler(...)` once the DOM is ready:

```html
<script src="https://cdn.jsdelivr.net/gh/Striker-Marketing/strikerFormHandler@1/strikerFormHandler.min.js"></script>
<script>
  document.addEventListener("DOMContentLoaded", () => {
    strikerFormHandler({
      formId: "contact-form",
      hasPhoneNumber: true,
      phoneNumberIsRequired: true,
      ghl: {
        formId: "abc123...",
        location_id: "loc_xyz...",
        captchaToken: "6Lc...",
      },
      submitFunction: () => {
        window.location.href = "/thank-you";
      },
    });
  });
</script>
```

The `@1` in the URL pins the major version — you get patch and minor updates automatically. Pin to an exact tag (e.g. `@1.2.3`) if you need a frozen deploy.

## Minimal example — GHL form with phone

HTML:

```html
<form id="contact-form">
  <input name="first_name" type="text" required />
  <input name="last_name"  type="text" required />
  <input name="email"      type="email" required />
  <input name="phone_number" type="tel" required />
  <button type="submit">Submit</button>
</form>
```

JS:

```js
strikerFormHandler({
  formId: "contact-form",
  hasPhoneNumber: true,
  phoneNumberIsRequired: true,
  ghl: {
    formId:       "YOUR_GHL_FORM_ID",
    location_id:  "YOUR_GHL_LOCATION_ID",
    captchaToken: "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY",
    fields: ["first_name", "last_name", "email"],
  },
  submitFunction: () => (window.location.href = "/thanks"),
});
```

The `phone` value is sent automatically (E.164 format) whenever `hasPhoneNumber: true`; you do not list it in `ghl.fields`.

## API

```js
strikerFormHandler({
  formId,                  // string  — id of the <form> element
  hasPhoneNumber,          // bool    — form has a [name="phone_number"] input
  phoneNumberIsRequired,   // bool    — empty phone rejects submit
  phoneNumberIsExternal,   // bool    — caller manages the phone field; skip intl-tel-input
  ghl: {                   // omit entirely to skip GHL submission
    formId,                // string  — GHL form or survey id
    location_id,           // string  — GHL location id
    captchaToken,          // string  — reCAPTCHA Enterprise site key
    isSurvey,              // bool    — POST to /surveys/submit instead of /forms/submit
    updateContactOnly,     // bool    — GHL "update contact only" flag
    fields,                // string[] — GHL standard field names present on this form (see below)
    customFields,          // Array<[name, ghlFieldId, marker?]> — see "Custom fields"
    terms_and_conditions,  // string  — override the default terms string
    hasPath,               // string  — if set, submits window.location.pathname under this GHL field id
    hasTaboola,            // string  — if set, submits ?tbclid under this GHL field id
  },
  submitFunction,          // ({ ghlResponse }) => void — called after successful submit
});
```

### GHL standard fields

List each of these in `ghl.fields` **only if** an input with that `name` exists on the form:

```
full_name, first_name, last_name, email, address, country, city, state,
postal_code, organization, website, terms_and_conditions
```

The value is read from `[name='<field>']` and submitted under the same key.

### Custom fields

Anything that is not a GHL standard field goes through `ghl.customFields`. Each entry is a tuple:

```js
[htmlName, ghlCustomFieldId, marker?]
```

- **Text / textarea / select / radio** — omit the marker.
  ```js
  ["how_did_you_hear", "abc123CustomFieldId"]
  ```
- **File upload** — the input must be `type="file"`. Allowed extensions: `doc, docx, txt, pdf, jpg, jpeg, png`. Other types trigger an `alert()` and abort the submit.
  ```js
  ["resume", "abc123FileFieldId"]
  ```
- **Checkbox group** (multi-select) — pass `"group"` as the third element. Repeat the tuple once per checkbox, all sharing the same `ghlCustomFieldId`; only checked boxes are submitted.
  ```js
  customFields: [
    ["interests", "abc123InterestFieldId", "group"],
    ["interests", "abc123InterestFieldId", "group"],
    ["interests", "abc123InterestFieldId", "group"],
  ]
  ```

Radio groups are read via `[name='...']:checked` — one tuple, no marker.

### Terms and conditions

Two modes:

1. **Static string** — omit `terms_and_conditions` from `ghl.fields`. The handler submits `ghl.terms_and_conditions` if provided, otherwise the built-in default (`"I agree to terms & conditions provided by the company. By providing my phone number, I agree to receive text messages from the business."`).
2. **User-checked** — include `"terms_and_conditions"` in `ghl.fields` and add one or more `<input type="checkbox" name="terms_and_conditions" value="...">` inputs. Checked values are joined with `"; "` and submitted; if none are checked, the key is omitted.

### Phone number

- Default (`phoneNumberIsExternal` unset): the handler loads intl-tel-input from CDN, mounts it on `[name="phone_number"]`, detects the initial country via `ipapi.co`, validates via `iti.isValidNumber()`, and submits the E.164 number. Invalid numbers show `alert("Field invalid. Please check for typos.")` and block submit.
- `phoneNumberIsExternal: true` — you own the phone input; the raw `.value` is submitted verbatim and no validation happens here. Use this when a page-level component already renders its own phone widget.
- `phoneNumberIsRequired: false` — empty phone is allowed; a non-empty value must still be valid.

## What the handler adds to your page at runtime

- Hidden `<input hidden>` per URL query param, appended to the form before submit (so any non-GHL backend also sees UTMs).
- On successful submit:
  ```js
  window.dataLayer.push({ event: "form-submitted" });
  window.dataLayer.push({ event: "form_submitted" });
  ```
  Both events are pushed — GTM triggers in the field use both spellings.
- The GHL payload's `eventData` includes:
  ```js
  {
    url_params: { /* every ?key=value on the page */ },
    campaign:   utm_campaign || gad_campaignid,
    page:       { url: location.href, title: document.title },
  }
  ```
- Submit button shows an inline SVG spinner while the request is in flight, and is re-enabled with its original inner HTML if the submit fails.

## Full example — GHL form with custom + file + group fields

```html
<form id="job-app">
  <input name="first_name" required />
  <input name="last_name"  required />
  <input name="email" type="email" required />
  <input name="phone_number" type="tel" required />

  <select name="position">
    <option>Engineer</option>
    <option>Designer</option>
  </select>

  <label><input type="checkbox" name="skills" value="js" /> JS</label>
  <label><input type="checkbox" name="skills" value="go" /> Go</label>
  <label><input type="checkbox" name="skills" value="rs" /> Rust</label>

  <input type="file" name="resume" accept=".pdf,.doc,.docx" />

  <label>
    <input type="checkbox" name="terms_and_conditions" value="I agree to the privacy policy." />
    I agree to the privacy policy.
  </label>

  <button type="submit">Apply</button>
</form>

<script src="https://cdn.jsdelivr.net/gh/Striker-Marketing/strikerFormHandler@1/strikerFormHandler.min.js"></script>
<script>
  strikerFormHandler({
    formId: "job-app",
    hasPhoneNumber: true,
    phoneNumberIsRequired: true,
    ghl: {
      formId:       "GHL_FORM_ID",
      location_id:  "GHL_LOCATION_ID",
      captchaToken: "RECAPTCHA_ENTERPRISE_SITE_KEY",
      fields: ["first_name", "last_name", "email", "terms_and_conditions"],
      customFields: [
        ["position", "GHL_POSITION_FIELD_ID"],
        ["skills",   "GHL_SKILLS_FIELD_ID", "group"],
        ["skills",   "GHL_SKILLS_FIELD_ID", "group"],
        ["skills",   "GHL_SKILLS_FIELD_ID", "group"],
        ["resume",   "GHL_RESUME_FIELD_ID"],
      ],
      hasPath:    "GHL_PATH_FIELD_ID",
      hasTaboola: "GHL_TBCLID_FIELD_ID",
    },
    submitFunction: () => (window.location.href = "/thanks"),
  });
</script>
```

## Non-GHL usage

Omit the `ghl` object entirely. The handler still:

- Copies URL params into hidden form inputs
- Validates the phone number (if `hasPhoneNumber`)
- Shows the spinner and disables the submit button
- Pushes the `form-submitted` / `form_submitted` dataLayer events
- Calls `submitFunction({ ghlResponse: undefined })` on success

In that mode, do your own POST inside `submitFunction`, or let the browser submit natively by not calling `strikerFormHandler` at all.

## Surveys

Set `ghl.isSurvey: true` to POST to `backend.leadconnectorhq.com/surveys/submit` instead of `/forms/submit`. Everything else works identically.

## Notes

- `intl-tel-input` version is pinned in `ITI_VERSION` at the top of `strikerFormHandler.js`. Bump all three CDN URLs together when upgrading.
- reCAPTCHA Enterprise script is injected only when `ghl.formId` is set. The badge is hidden via injected CSS.
- Multiple calls to `strikerFormHandler` on the same page share one intl-tel-input asset load (memoized on `window.__itiAssetsPromise`).
