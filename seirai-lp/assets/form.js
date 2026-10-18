/* ============================================================
   申込みフォームの送信処理
   - 送信先が未設定のときは、押せない状態＋案内を表示する
   - 送信は fetch で行い、ページ遷移せずに完了メッセージを出す
   - JavaScriptが動かない環境では、通常のフォーム送信にそのまま任せる
   ============================================================ */
(function () {
  'use strict';

  var form = document.getElementById('applyForm');
  if (!form) return;

  var kind = form.getAttribute('data-form');               // 'join' | 'event'
  var endpoint = (window.SEIRAI_FORM && window.SEIRAI_FORM[kind]) || '';
  var submit = form.querySelector('[type=submit]');
  var status = form.querySelector('.form__status');
  var thanks = document.getElementById('thanks');

  /* --- 送信先が未設定のとき --- */
  if (!endpoint) {
    var note = document.createElement('p');
    note.className = 'setup-note';
    note.textContent =
      'ただいま受付の準備中です。公開前に送信先の設定が必要です（assets/form-config.js）。';
    form.insertBefore(note, form.firstChild);
    if (submit) {
      submit.setAttribute('disabled', '');
      submit.textContent = '準備中';
    }
    return;
  }

  form.setAttribute('action', endpoint);
  form.setAttribute('method', 'POST');

  function setStatus(message, isError) {
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('form__status--error', !!isError);
  }

  form.addEventListener('submit', function (e) {
    /* ブラウザの必須チェックに任せる */
    if (!form.checkValidity()) return;

    e.preventDefault();
    submit.setAttribute('disabled', '');
    var label = submit.textContent;
    submit.textContent = '送信中…';
    setStatus('');

    fetch(endpoint, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        form.style.display = 'none';
        if (thanks) {
          thanks.classList.add('is-shown');
          thanks.scrollIntoView({ behavior: 'smooth', block: 'start' });
          thanks.setAttribute('tabindex', '-1');
          thanks.focus({ preventScroll: true });
        }
      })
      .catch(function () {
        submit.removeAttribute('disabled');
        submit.textContent = label;
        setStatus(
          '送信できませんでした。通信環境をご確認のうえ、もう一度お試しください。' +
          '繰り返し失敗する場合は、お手数ですがメールにてご連絡ください。',
          true
        );
      });
  });
})();
