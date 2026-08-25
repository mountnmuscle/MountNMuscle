/*!
 * Mount N Muscle — lead source tracking
 * ------------------------------------------------------------------
 * Reads ?ref= (or ?utm_source=) from the URL, remembers it for the
 * visit, and stamps it into every Formspree form on the site so the
 * quote email says where the lead came from.
 *
 * Example: a resident at Bask Apartments scans the QR on their
 * welcome flyer -> https://mountnmuscle.com/?ref=bask#quote
 * -> the quote email arrives as:
 *      Subject: Mount N Muscle - Quote Request [bask]
 *      lead_source: bask
 *
 * No dependencies. Safe to run on every page.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'mnm_lead_source';
  var FIELD_NAME = 'lead_source';
  var DEFAULT_SOURCE = 'direct';

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
    // Keep it to a short, safe slug — this ends up in an email subject.
    return String(value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  }

  function resolveSource() {
    var fromUrl = sanitize(readSource());

    // sessionStorage keeps the source attached if the visitor browses
    // to another page before they actually submit the form.
    try {
      if (fromUrl) {
        sessionStorage.setItem(STORAGE_KEY, fromUrl);
        return fromUrl;
      }
      var stored = sanitize(sessionStorage.getItem(STORAGE_KEY) || '');
      if (stored) return stored;
    } catch (e) {
      // Private browsing or storage disabled — fall through to the URL value.
      if (fromUrl) return fromUrl;
    }

    return DEFAULT_SOURCE;
  }

  function stampForms(source) {
    var forms = document.querySelectorAll('form[action*="formspree.io"]');

    Array.prototype.forEach.call(forms, function (form) {
      // Never add the field twice.
      if (form.querySelector('input[name="' + FIELD_NAME + '"]')) return;

      var field = document.createElement('input');
      field.type = 'hidden';
      field.name = FIELD_NAME;
      field.value = source;
      form.appendChild(field);

      // Also append the source to the Formspree subject line so it is
      // visible in the inbox list without opening the message.
      var subject = form.querySelector('input[name="_subject"]');
      if (subject && source !== DEFAULT_SOURCE && subject.value.indexOf('[') === -1) {
        subject.value = subject.value + ' [' + source + ']';
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
