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
   * LABORDAY ran through Sept 7, 2026 and is now over. The hero strip that
   * advertised it was removed from all 23 pages in the same deploy, so the
   * prefill is switched off here to match - a code prefilled into the quote
   * form that the site no longer advertises is a discount given away for
   * nothing. With PROMO_CODE empty, matheson scans correctly get MATHESON10.
   *
   * To run the next promo: set PROMO_CODE, set PROMO_ENDS to midnight on the
   * morning AFTER the last valid day (month is 0-indexed: 8 = Sept), and add
   * the <div class="promo-strip"> block back to the hero. The .promo-strip
   * styles are still in site.css, ready to use.
   * ------------------------------------------------------------------ */
  var PROMO_CODE = '';
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

      // Which page the form was submitted from. Stamped here from the real
      // URL rather than a hand-typed hidden field, so it can never drift from
      // the file it sits in - the old hidden fields had done exactly that.
      if (!form.querySelector('input[name="page"]')) {
        var page = document.createElement('input');
        page.type = 'hidden';
        page.name = 'page';
        page.value = ((window.location.pathname || '/').replace(/^\/|\.html$/g, '') || 'home').replace(/^index$/, 'home');
        form.appendChild(page);
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


  /* ------------------------------------------------------------------
   * Campaign attribution (added Nov 27 2026).
   *
   * Captures the full UTM set plus ad click IDs (Google gclid/gbraid/wbraid,
   * Meta fbclid, Microsoft msclkid), the page the visitor landed on and the
   * site that sent them. Kept for 30 days in localStorage, so a visitor who
   * clicks an ad today and comes back next week to fill the form is still
   * credited. A new visit that carries campaign tags replaces the old ones.
   * Only fields that have a value are added to the form, so organic leads
   * don't arrive with a pile of empty lines.
   * ------------------------------------------------------------------ */
  var ATTR_KEY = 'mnm_attr';
  var ATTR_DAYS = 30;
  var ATTR_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid'];

  function cleanValue(v) {
    return String(v || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 150);
  }

  function externalReferrer() {
    try {
      if (!document.referrer) return '';
      var host = new URL(document.referrer).hostname.replace(/^www\./, '');
      return host && host !== window.location.hostname.replace(/^www\./, '') ? host : '';
    } catch (e) { return ''; }
  }

  function resolveAttribution() {
    var now = Date.now(), fresh = {}, has = false, params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { params = null; }
    if (params) {
      ATTR_PARAMS.forEach(function (k) {
        var v = cleanValue(params.get(k));
        if (v) { fresh[k] = v; has = true; }
      });
    }
    var ref = externalReferrer();
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null'); } catch (e) { stored = null; }
    if (stored && (!stored.ts || now - stored.ts > ATTR_DAYS * 864e5)) stored = null;

    // A campaign click always wins; otherwise keep the first touch we have.
    if (!has && stored && !(ref && !stored.referrer && !stored.utm_source)) return stored;
    fresh.landing_page = cleanValue(window.location.pathname || '/');
    if (ref) fresh.referrer = ref;
    fresh.ts = now;
    try { localStorage.setItem(ATTR_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }

  function addHidden(form, name, value) {
    if (!value || form.querySelector('input[name="' + name + '"]')) return;
    var el = document.createElement('input');
    el.type = 'hidden'; el.name = name; el.value = value;
    form.appendChild(el);
  }

  function stampAttribution(attr) {
    var forms = document.querySelectorAll('form[action*="formspree.io"]');
    Array.prototype.forEach.call(forms, function (form) {
      ATTR_PARAMS.concat(['landing_page', 'referrer']).forEach(function (k) {
        addHidden(form, k, attr[k]);
      });
    });
  }

  function init() {
    var attr = {};
    try { attr = resolveAttribution() || {}; } catch (e) { attr = {}; }
    var source = resolveSource();
    // No ?ref= or utm_source: fall back to the site that sent them
    // (google, bing, facebook...) instead of calling it "direct".
    if (source === DEFAULT_SOURCE && attr.referrer) {
      source = sanitize(attr.referrer.replace(/\.(com|org|net|co)(\.[a-z]{2})?$/, '').split('.').pop());
      if (!source) source = DEFAULT_SOURCE;
    }
    stampForms(source);
    try { stampAttribution(attr); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
