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
- `phoneNumberIsRequired: false` — empty phone is allowed; a non-empty value must still be valid.

## Address autofill

Swaps the form's `[name="address"]` input for Google's own [Place Autocomplete widget](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new) — an input with a suggestions dropdown that Google renders, styles, and keeps accessible (screen readers, keyboard nav, RTL) for you.

The widget brings its own input and can't adopt an existing one, so the handler inserts it after your `<input name="address">` and hides that input, keeping it in the DOM as the value carrier. Your `name` still submits, GHL still reads it, and the handler copies your input's computed styles onto the widget so it matches the rest of the form out of the box.

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

The `placeholder` is carried over to the widget. `required` keeps working, but is enforced by the handler rather than the browser (a hidden field can't be natively validated), showing `alert("Please enter your address.")` on an empty submit.

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
<input name="postal_code" />  <!-- → "94043-1351"    (zip + suffix) -->
<input name="country" />      <!-- → "US"            (ISO code)     -->
```

Any of these that don't exist on the form are skipped silently — a form with just `address` and `postal_code` works with no extra config. Because these are the same names GHL submits, they need no mapping: just list them in `ghl.fields`.

`state` works with a `<select>` too. The handler matches an option by `value` first, then by visible text, so `"California"` correctly selects either markup:

```html
<select name="state">
  <option value="CA">California</option>          <!-- matched by text  -->
  <option value="California">California</option>  <!-- matched by value -->
</select>
```

If a visitor types an address and submits **without** picking a suggestion, whatever they typed is copied into `[name="address"]` on submit rather than being lost.

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

The widget's input sits in a closed shadow DOM, so ordinary CSS can't reach it. The handler works around that by copying your original input's computed font, colour, border, padding, height, radius, and shadow onto the widget — so by default it already looks like your other fields.

To override, use `::part()`:

```css
gmp-place-autocomplete::part(input) {
  border-color: #6461f2;
}
gmp-place-autocomplete::part(prediction-item) {
  padding: 12px;
}
```

Available parts: `input`, `prediction-list`, `prediction-item`, `prediction-item-icon`, `prediction-item-main-text`, `prediction-item-secondary-text`, `prediction-item-match`, `prediction-item-selected`, `focus-ring`.

The handler's generated rule is scoped to `[data-sfh-af="<formId>"]` and injected at the very top of `<head>`, so your own stylesheet wins on equal specificity.

Google's widget renders its own attribution, so nothing extra is required by the Places policy.

### Cost

One completed pick bills as a single *Autocomplete session* at the **Essentials** tier — the cheapest — because only `addressComponents` and `formattedAddress` are requested, and the widget handles session tokens itself. Adding a Pro-tier field like `displayName` would upgrade the billing tier of every lookup.


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

- `intl-tel-input` version is pinned in `ITI_VERSION` near the top of the `strikerFormHandler` function. Bump all three CDN URLs together when upgrading.
- reCAPTCHA Enterprise script is injected only when `ghl.formId` is set. The badge is hidden via injected CSS.
- Multiple calls to `strikerFormHandler` on the same page share one intl-tel-input asset load (memoized on `window.__itiAssetsPromise`), one Google Maps load (`window.__googleMapsPromise`), and one country lookup (`window.__itiCountryPromise`).
- The `ipapi.co` country lookup is cached in `localStorage` under `sfh_iti_country` for 24h, so repeat visits and multi-step funnels don't re-request it. Failures are never cached.
- Address autofill and phone input both degrade quietly: if the CDN or API is unavailable the field stays a plain text input (still `required`, still named `address`) and the form still submits.
- Every helper lives inside the `strikerFormHandler` function, so the script adds exactly one name to the page's global scope.
