/* ============================================================
   申込みフォームの送信処理
   - 送信先が未設定のときは、押せない状態＋案内を表示する
   - mode:'post'  … 通常のフォーム送信（サービス側の仕様に左右されない）
   - mode:'fetch' … ページ遷移せずに送信し、完了メッセージをその場に出す
   ============================================================ */
(function () {
  'use strict';

  var form = document.getElementById('applyForm');
  if (!form) return;

  var cfg = window.SEIRAI_FORM || {};
  var conf = cfg[form.getAttribute('data-form')] || {};   // 'join' | 'event'
  var endpoint = conf.endpoint || '';
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

  /* 送信完了後の戻り先。フォームサービス側の設定欄が使えない場合に備え、
     よく使われる名前の隠しフィールドでも渡しておく（無視されても害はない） */
  if (conf.redirect) {
    ['_redirect', '_next', 'redirect_to'].forEach(function (name) {
      if (form.querySelector('[name="' + name + '"]')) return;
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = name; i.value = conf.redirect;
      form.appendChild(i);
    });
  }

  /* --- 通常のフォーム送信：ブラウザに任せる --- */
  if (cfg.mode !== 'fetch') {
    form.addEventListener('submit', function () {
      if (!form.checkValidity()) return;
      submit.setAttribute('disabled', '');
      submit.textContent = '送信中…';
    });
    return;
  }

  /* --- ページ遷移せずに送信する場合 --- */
  form.addEventListener('submit', function (e) {
    if (!form.checkValidity()) return;
    e.preventDefault();

    var label = submit.textContent;
    submit.setAttribute('disabled', '');
    submit.textContent = '送信中…';
    if (status) { status.textContent = ''; status.classList.remove('form__status--error'); }

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
        }
      })
      .catch(function () {
        submit.removeAttribute('disabled');
        submit.textContent = label;
        if (status) {
          status.textContent =
            '送信できませんでした。通信環境をご確認のうえ、もう一度お試しください。';
          status.classList.add('form__status--error');
        }
      });
  });
})();
