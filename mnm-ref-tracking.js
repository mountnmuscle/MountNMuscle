/*!
 * Mount N Muscle — lead source tracking + promo prefill
 * ------------------------------------------------------------------
 * Reads ?ref= (or ?utm_source=) from the URL, remembers it for the visit, and:
 *
 *   1. Stamps it into every Formspree form as a hidden `lead_source` field, so
 *      the quote email says which flyer, property, or campaign produced the lead.
 *   2. Appends it to the email subject line, so it's visible in the inbox list.
 *   3. Prefills the "Promo code" field when that ref has a code attached.
 *
 * Example: a resident at Matheson Mill scans the QR on their welcome flyer
 *   -> https://mountnmuscle.com/?ref=matheson#quote
 *   -> promo field is prefilled with MATHESON10
 *   -> quote email arrives as:
 *        Subject: Mount N Muscle - Quote Request [matheson]
 *        lead_source: matheson
 *
 * No dependencies. Safe to run on every page.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'mnm_lead_source';
  var FIELD_NAME = 'lead_source';
  var DEFAULT_SOURCE = 'direct';

  /* ------------------------------------------------------------------
   * Promo codes by referral source.
   *
   * Only add a code here when the property has actually agreed to one.
   * Most partner properties get no discount — their flyers carry the
   * Neighbor Program instead — so they belong in the list with no code,
   * or simply left out entirely.
   * ------------------------------------------------------------------ */
  var PROMO_BY_REF = {
    matheson: 'MATHESON10'
  };

  /* ------------------------------------------------------------------
   * Site-wide promotion.
   *
   * While this is running it OVERRIDES every per-property code above,
   * because promos don't stack and one promo per booking is the rule —
   * so everyone should get the better of the two. LABORDAY is 15% off;
   * MATHESON10 is 10%. Handing a Matheson resident the 10% code while
   * the page advertises 15% is the wrong way round.
   *
   * SELF-EXPIRING. At PROMO_ENDS this reverts to PROMO_BY_REF on its
   * own — no code change needed. To run a future promo, set the code
   * and the end date; to end one early, set PROMO_CODE to ''.
   *
   * Ends at the close of Sept 7, 2026 (month is 0-indexed: 8 = Sept).
   * ------------------------------------------------------------------ */
  var PROMO_CODE = 'LABORDAY';
  var PROMO_ENDS = new Date(2026, 8, 8, 0, 0, 0);

  function sitewidePromo() {
    try {
      return (PROMO_CODE && new Date() < PROMO_ENDS) ? PROMO_CODE : '';
    } catch (e) {
      return '';
    }
  }

  function readSource() {
    var params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return '';
    }
    // ?ref= is used by print material (flyers, yard signs, QR codes).
    // ?utm_source= is what Google / Facebook / email tools append.
    return params.get('ref') || params.get('utm_source') || '';
  }

  function sanitize(value) {
    // Keep it to a short, safe slug — this ends up in an email subject line.
    return String(value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  }

  function resolveSource() {
    var fromUrl = sanitize(readSource());

    // sessionStorage keeps the source attached if the visitor browses to
    // another page before they actually submit the form.
    try {
      if (fromUrl) {
        sessionStorage.setItem(STORAGE_KEY, fromUrl);
        return fromUrl;
      }
      var stored = sanitize(sessionStorage.getItem(STORAGE_KEY) || '');
      if (stored) return stored;
    } catch (e) {
      // Private browsing or storage disabled — fall back to the URL value.
      if (fromUrl) return fromUrl;
    }

    return DEFAULT_SOURCE;
  }

  function stampForms(source) {
    var forms = document.querySelectorAll('form[action*="formspree.io"]');

    Array.prototype.forEach.call(forms, function (form) {
      // Never add the field twice.
      if (!form.querySelector('input[name="' + FIELD_NAME + '"]')) {
        var field = document.createElement('input');
        field.type = 'hidden';
        field.name = FIELD_NAME;
        field.value = source;
        form.appendChild(field);
      }

      // Append the source to the Formspree subject so it's visible without
      // opening the message.
      var subject = form.querySelector('input[name="_subject"]');
      if (subject && source !== DEFAULT_SOURCE && subject.value.indexOf('[') === -1) {
        subject.value = subject.value + ' [' + source + ']';
      }

      // Prefill the promo code — but never overwrite something the visitor
      // already typed. A live site-wide promo wins over a per-property code.
      // hasOwnProperty guard: a bare lookup on a ref like "constructor"
      // would return an inherited Object.prototype member, not a code.
      var refPromo = Object.prototype.hasOwnProperty.call(PROMO_BY_REF, source)
        ? PROMO_BY_REF[source]
        : '';
      var promo = sitewidePromo() || refPromo;
      var promoField = form.querySelector('input[name="promo_code"]');
      if (promo && promoField && !promoField.value) {
        promoField.value = promo;
      }
    });
  }

  function init() {
    stampForms(resolveSource());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
