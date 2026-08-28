(function (global) {
  'use strict';

  global.SIGT_CONFIG = Object.freeze({
    // Sustituir por la URL /exec del deployment público Google_Portal_Publico.
    // Las URLs de captura de Flutter no deben utilizarse en este portal.
    API_BASE_URL: 'https://script.google.com/macros/s/AKfycbyt8T5oi8tcsfDOZYL9rAZDQ7ByG75OsJXGJO7vzp0-MajTrNIVEn1sEEgZH6Q4QZfwmw/exec',
    DEFAULT_LIMIT: 100,
    MAP_CENTER: Object.freeze([4.6486, -74.107]),
    MAP_ZOOM: 11
  });
}(window));
