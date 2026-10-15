# Striker Form Handler

A single-file, vanilla JS form handler for marketing sites. Wires a plain HTML `<form>` to:

- GoHighLevel (GHL) form/survey submission with reCAPTCHA Enterprise
- International phone input via [intl-tel-input](https://github.com/jackocnr/intl-tel-input) (lazy-loaded from CDN)
- Google Places address autocomplete on the address field, filling one input or spreading across city / state / zip
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
  forceItiCountry,         // string  — ISO2 code ("us", "br"): pin the country, hide the selector
  isWebflow,               // bool    — form is a Webflow form; let Webflow submit too and wait for it (see "Webflow")
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
  address_autofill: {      // omit entirely to skip address autocomplete
    key,                   // string   — Google Maps JS API key (required to enable)
    single_field,          // bool     — true: full address into [name="address"] only
                           //            false: spread across city / state / postal_code / country
    countries,             // string[] — restrict suggestions; default ["us"]
    types,                 // string[] — Places primary types; default street_address/subpremise/premise
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
- `forceItiCountry: "br"` — pin the country instead of geolocating. The country selector is hidden so the visitor can't change it, and the `ipapi.co` lookup is skipped entirely. Case-insensitive: `"br"` and `"BR"` both work. The flag and `+55` prefix still render — they just stop being clickable.
  - Because the country is locked, a number from anywhere else fails validation and is rejected by the `alert()`. Only use this on forms whose audience really is single-country.
  - Has no effect when `phoneNumberIsExternal: true` or `hasPhoneNumber` is falsy — intl-tel-input is never mounted in those cases.
- `phoneNumberIsRequired: false` — empty phone is allowed; a non-empty value must still be valid.

## Address autofill

Adds Google address suggestions to your form's existing `<input name="address">`. The input stays exactly where it is — your markup, your CSS, your `required` — and a suggestions dropdown renders under it as the visitor types.

The handler uses the [Place Autocomplete Data API](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data) and draws the list itself, rather than dropping in Google's `PlaceAutocompleteElement` widget. That widget goes full-screen on phones — it replaces your page with a white Google search view the moment someone types, and Google offers no way to turn that off. Drawing the list ourselves means it looks the same at every width, inherits your field's font and colours, and can't be clipped by a container with `overflow: hidden`.

Keyboard navigation (↑/↓/Enter/Escape) and screen-reader semantics are wired up for you, and the field shows the same loading spinner as the submit button while it looks an address up.

### Google Cloud setup

1. Enable **Maps JavaScript API** and **[Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com)** on your project. "Places API (New)" (`places.googleapis.com`) is a *different service* from the legacy "Places API" — a key with only the legacy one returns `403 ... AutocompletePlaces are blocked`.
2. Create an API key at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials/key/).
3. Restrict it — the key is public in your page source:
   - **Application restrictions** → HTTP referrers → your domains.
   - **API restrictions** → *Maps JavaScript API* + *Places API (New)*.
4. Billing must be active on the project.

### Usage

```js
strikerFormHandler({
  formId: "quote-form",
  address_autofill: {
    key: "YOUR_GOOGLE_MAPS_API_KEY",
    single_field: false,
  },
  ghl: {
    formId:       "GHL_FORM_ID",
    location_id:  "GHL_LOCATION_ID",
    captchaToken: "RECAPTCHA_ENTERPRISE_SITE_KEY",
    fields: ["first_name", "email", "address", "city", "state", "postal_code"],
  },
});
```

Your markup stays a plain input — nothing Google-specific in the HTML:

```html
<input name="address" placeholder="Street address" required />
```

Nothing is added, hidden, or swapped — `placeholder`, `required`, and any classes you set stay on your own input, and `required` is validated natively by the browser like every other field.

### The two modes

**`single_field: true`** — only `[name="address"]` is touched, and it receives the full formatted address:

```html
<input name="address" />
<!-- → "1600 Amphitheatre Pkwy #200, Mountain View, CA 94043, USA" -->
```

**`single_field: false`** — the address is broken apart across the GHL standard field names:

```html
<input name="address" />      <!-- → "1600 Amphitheatre Parkway #200"  (number + route + unit) -->
<input name="city" />         <!-- → "Mountain View" -->
<input name="state" />        <!-- → "California"    (full name) -->
<input name="postal_code" />  <!-- → "94043"         (5-digit ZIP)  -->
<input name="country" />      <!-- → "US"            (ISO code)     -->
```

Any of these that don't exist on the form are skipped silently — a form with just `address` and `postal_code` works with no extra config. Because these are the same names GHL submits, they need no mapping: just list them in `ghl.fields`.

Fields the *picked place* has no value for are **cleared**, not left alone. Pick something without a street number — a city, a ZIP — and `address` empties instead of keeping what the visitor typed to find it. Same for the others: a pick never leaves a previous pick's city or ZIP behind. A `<select>` clears to its blank option if it has one, and otherwise keeps its selection.

`state` works with a `<select>` too. The handler matches an option by `value` first, then by visible text, so `"California"` correctly selects either markup:

```html
<select name="state">
  <option value="CA">California</option>          <!-- matched by text  -->
  <option value="California">California</option>  <!-- matched by value -->
</select>
```

If a visitor types an address and submits **without** picking a suggestion, whatever they typed submits as-is — it's their own input, so nothing is lost.

### Tuning suggestions

```js
address_autofill: {
  key: "…",
  countries: ["us", "ca"],        // default ["us"]
  types: ["street_address", "subpremise", "premise"],  // the default
}
```

`types` maps to the Places `includedPrimaryTypes` filter — max five values from the [Places API type tables](https://developers.google.com/maps/documentation/places/web-service/place-types). An unsupported value rejects the whole request with a 400, so if the default feels too narrow for a market, set **`types: []`** to drop the filter entirely rather than guessing at type names.

### Styling

Your `<input name="address">` is untouched, so it keeps whatever CSS you already have on it.

The dropdown copies that input's font, size, colour and border radius, so it matches out of the box. To go further, target these classes — your rules always win over the defaults:

```css
.sfh-address-suggestions { }                          /* the dropdown */
.sfh-address-suggestion { }                           /* one row */
.sfh-address-suggestion[aria-selected="true"] { }     /* highlighted row */
.sfh-address-suggestion-main { }                      /* street line */
.sfh-address-suggestion-secondary { }                 /* city/state line */
```

A "Powered by Google" logo is rendered at the bottom of the dropdown. The Places policy requires it when suggestions are shown outside Google's own widget — don't hide it.

### Cost

One completed pick bills as a single *Autocomplete session* at the **Essentials** tier — the cheapest — because only `addressComponents` and `formattedAddress` are requested and every keystroke of a lookup shares one session token. Requests are also debounced and skipped below 3 characters, so typing an address is a handful of calls, not one per key. Adding a Pro-tier field like `displayName` would upgrade the billing tier of every lookup.


## What the handler adds to your page at runtime

- Hidden `<input hidden>` per URL query param, appended to the form before submit (so any non-GHL backend also sees UTMs).
- With `address_autofill`: one `<ul class="sfh-address-suggestions">` and one `<div class="sfh-address-spinner">` appended to `<body>` per form (positioned against the address field, so no container can clip them), and one shared `<style>` at the top of `<head>`.
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
- Submit button shows an inline SVG spinner while the request is in flight (an `<input type="submit">` shows its `data-wait` text instead), and is re-enabled with its original label if the submit fails.
- With `isWebflow`: one shared `<style>` hiding Webflow's `.w-form-done` (marked with `data-sfh-wf-hidden`).

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

## Webflow

Set `isWebflow: true` on a form built with Webflow's native Form Block. Webflow then still records the submission as usual, in parallel with GHL:

- Webflow's own submit is **not** blocked. Webflow ignores `preventDefault()` anyway, so the handler lets it POST and waits for Webflow's response (`code: 200`). `dataLayer` events and `submitFunction` run only after **both** Webflow and GHL succeed, so a redirect can never cut Webflow's request short.
- If Webflow fails or doesn't answer within 20s, the button is re-enabled and `submitFunction` isn't called. Webflow's `.w-form-fail` block is shown. Resubmitting sends to both again.
- If Webflow refuses to submit (its own validation alert, an unsolved captcha), the submit fails and `submitFunction` isn't called. GHL is sent at the same time as Webflow, though, so in that case GHL may still receive the lead.
- An invalid phone number blocks Webflow's submit too, not just GHL.
- Webflow's success block (`.w-form-done`) never shows, and the form is never hidden.
- Leave the form's **Redirect URL empty** in Webflow and redirect in `submitFunction` instead. Any `data-redirect` is ignored, so it can't race the GHL request.
- The submit button is never disabled ahead of time, so browser autofill keeps working. While the submit is in flight, a `<button>` shows the spinner and an `<input type="submit">` shows its **Waiting text** (`data-wait`), or `"Please wait..."`. The button stays in that state until both requests finish.

If the page has no jQuery, or Webflow isn't handling that form (no `data-wf-site`, the form has its own `action`), the handler logs a warning and carries on without waiting for Webflow.

## Surveys

Set `ghl.isSurvey: true` to POST to `backend.leadconnectorhq.com/surveys/submit` instead of `/forms/submit`. Everything else works identically.

## Notes

- `intl-tel-input` version is pinned in `ITI_VERSION` near the top of the `strikerFormHandler` function. Bump all three CDN URLs together when upgrading.
- reCAPTCHA Enterprise script is injected only when `ghl.formId` is set. The badge is hidden via injected CSS.
- Multiple calls to `strikerFormHandler` on the same page share one intl-tel-input asset load (memoized on `window.__itiAssetsPromise`), one Google Maps load (`window.__googleMapsPromise`), and one country lookup (`window.__itiCountryPromise`).
- The `ipapi.co` country lookup is cached in `localStorage` under `sfh_iti_country` for 24h, so repeat visits and multi-step funnels don't re-request it. Failures are never cached.
- `forceItiCountry` bypasses all of that: a pinned country neither reads nor writes the shared lookup promise or the cache, and never fires the request.
- Address autofill and phone input both degrade quietly: if the CDN or API is unavailable the field stays a plain text input (still `required`, still named `address`) and the form still submits.
- Every helper lives inside the `strikerFormHandler` function, so the script adds exactly one name to the page's global scope.
