/* ============================================================
   申込みフォームの送信先
   ============================================================
   フォームサービスで発行された「送信先URL」をここに入れてください。
   入れるまでは送信ボタンを押せない状態になります
   （申込みが届かないまま受付中に見えるのを防ぐため）。

   mode は送信のしかたです。基本は 'post' のままで問題ありません。
     'post'  … 通常のフォーム送信。どのサービスでも確実に動きます
     'fetch' … ページを移動せずに送信（サービス側がCORSに対応している場合のみ）
   ============================================================ */
window.SEIRAI_FORM = {
  mode: 'post',

  join: {
    endpoint: 'https://ssgform.com/s/If5r3TcPbF6N',      // 入会申込みの送信先URL
    redirect: 'https://seirai-lp.vercel.app/thanks?t=join'
  },

  event: {
    endpoint: 'https://ssgform.com/s/ucyQxvc8KtCN',      // 説明会申込みの送信先URL
    redirect: 'https://seirai-lp.vercel.app/thanks?t=event'
  }
};
