//# sourceURL=krig://google-translate-inject.js
(function() {
  var TARGET_LANG = '__KRIG_TARGET_LANG__';

  // Language changed on an already-injected page — switch via cookie + select
  if (window.__mirroTranslateInjected) {
    if (window.__mirroCurrentLang === TARGET_LANG) return;
    window.__mirroCurrentLang = TARGET_LANG;

    document.cookie = 'googtrans=/auto/' + TARGET_LANG + '; path=/';

    var select = document.querySelector('#google_translate_element select');
    if (select) {
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === TARGET_LANG) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change'));
          return;
        }
      }
    }

    // If select not found or target lang not in options, re-init the widget
    var el = document.getElementById('google_translate_element');
    if (el) el.innerHTML = '';
    new google.translate.TranslateElement({
      pageLanguage: 'auto',
      includedLanguages: TARGET_LANG,
      autoDisplay: false,
      layout: google.translate.TranslateElement.InlineLayout.SIMPLE
    }, 'google_translate_element');

    setTimeout(function() {
      var sel = document.querySelector('#google_translate_element select');
      if (sel) {
        for (var j = 0; j < sel.options.length; j++) {
          if (sel.options[j].value === TARGET_LANG) {
            sel.selectedIndex = j;
            sel.dispatchEvent(new Event('change'));
            break;
          }
        }
      }
    }, 500);
    return;
  }

  // First injection on this page
  window.__mirroTranslateInjected = true;
  window.__mirroCurrentLang = TARGET_LANG;

  document.cookie = 'googtrans=/auto/' + TARGET_LANG + '; path=/';

  var div = document.createElement('div');
  div.id = 'google_translate_element';
  div.style.display = 'none';
  document.body.appendChild(div);

  window.googleTranslateElementInit = function() {
    new google.translate.TranslateElement({
      pageLanguage: 'auto',
      includedLanguages: TARGET_LANG,
      autoDisplay: false,
      layout: google.translate.TranslateElement.InlineLayout.SIMPLE
    }, 'google_translate_element');

    setTimeout(function() {
      var select = document.querySelector('#google_translate_element select');
      if (select) {
        for (var i = 0; i < select.options.length; i++) {
          if (select.options[i].value === TARGET_LANG) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event('change'));
            break;
          }
        }
      }
    }, 500);
  };

  // NOTE: element.js is loaded by the main process via executeJavaScript
  // to bypass CSP restrictions. No <script src> tag is needed here.

  var style = document.createElement('style');
  style.textContent = [
    '#google_translate_element { display: none !important; }',
    '.skiptranslate { display: none !important; }',
    '.goog-te-banner-frame { display: none !important; }',
    'body { top: 0 !important; position: static !important; }',
  ].join('\n');
  document.head.appendChild(style);

  // 防止 Google Translate 覆盖页面背景色（保持暗色主题一致）
  // GT 翻译时会在 <body> 上设置 inline background-color，需要持续移除
  var bgObs = new MutationObserver(function() {
    if (document.body && document.body.style.backgroundColor) {
      document.body.style.removeProperty('background-color');
    }
  });
  if (document.body) {
    bgObs.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      bgObs.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    });
  }
})();
