import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "施工管理アプリ | 案件・工程・写真をひとつに",
  description:
    "現場の案件管理・工程表・写真共有をひとつのアプリで。元請と協力会社がリアルタイムにつながる、シンプルな施工管理アプリです。",
};

const features = [
  {
    title: "案件管理",
    description:
      "住所・施主・工期をまとめて登録。進行中の案件を一覧で把握し、詳細ページから工程や写真にすぐアクセスできます。",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 21h19.5M4.5 21V5.25A2.25 2.25 0 0 1 6.75 3h6a2.25 2.25 0 0 1 2.25 2.25V21M8.25 7.5h1.5m-1.5 3.75h1.5m-1.5 3.75h1.5M15 10.5h3.75a1.5 1.5 0 0 1 1.5 1.5v9"
        />
      </svg>
    ),
  },
  {
    title: "工程表",
    description:
      "案件ごとにタスクを追加し、担当者・期間・ステータスを管理。今どの工程が動いているか、誰でもひと目でわかります。",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.75 3v2.25M17.25 3v2.25M3.75 8.25h16.5M4.5 5.25h15a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75h-15a.75.75 0 0 1-.75-.75V6a.75.75 0 0 1 .75-.75Zm3 7.5h3m-3 3.75h6"
        />
      </svg>
    ),
  },
  {
    title: "写真共有",
    description:
      "現場写真を案件・工程に紐づけてアップロード。ギャラリーで整理され、報告や記録のための写真探しがなくなります。",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.827 6.175a2.31 2.31 0 0 1-1.64.68H4.5A2.25 2.25 0 0 0 2.25 9.1v7.65a2.25 2.25 0 0 0 2.25 2.25h15a2.25 2.25 0 0 0 2.25-2.25V9.1a2.25 2.25 0 0 0-2.25-2.25h-.687a2.31 2.31 0 0 1-1.64-.68l-.822-.821A2.25 2.25 0 0 0 14.76 4.5H9.24a2.25 2.25 0 0 0-1.591.659l-.822.821ZM15.75 12.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
        />
      </svg>
    ),
  },
];

const problems = [
  "電話・FAX・チャットに情報が散らばり、最新の工程がわからない",
  "現場写真がスマホや個人のフォルダに埋もれて、報告時に探し回る",
  "協力会社への共有が遅れ、手戻りや待ち時間が発生する",
];

const steps = [
  {
    step: "01",
    title: "アカウント登録",
    description: "メールアドレスとパスワードで登録。元請・協力会社のロールを選ぶだけで始められます。",
  },
  {
    step: "02",
    title: "案件を作成してメンバーを招待",
    description: "案件を登録し、表示名検索で協力会社をメンバーに追加。関係者全員が同じ情報を見られます。",
  },
  {
    step: "03",
    title: "工程と写真を共有",
    description: "工程表でタスクを管理し、現場写真をアップロード。進捗の確認も報告もアプリの中で完結します。",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-lg font-bold tracking-tight">
            施工管理<span className="text-orange-600">アプリ</span>
          </span>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500"
            >
              無料で始める
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-zinc-100 bg-gradient-to-b from-orange-50 to-white">
          <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:py-28">
            <p className="mb-4 inline-block rounded-full border border-orange-200 bg-white px-4 py-1 text-xs font-medium text-orange-700">
              元請と協力会社をつなぐ施工管理
            </p>
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              案件・工程・写真を、
              <br className="hidden sm:block" />
              現場のみんなでひとつに。
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg">
              電話や紙でバラバラだった現場の情報を、シンプルなアプリに集約。
              案件管理・工程表・写真共有の3つの機能で、元請と協力会社が同じ画面を見ながら仕事を進められます。
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="w-full rounded-md bg-orange-600 px-8 py-3 text-base font-semibold text-white hover:bg-orange-500 sm:w-auto"
              >
                無料でアカウント作成
              </Link>
              <Link
                href="/login"
                className="w-full rounded-md border border-zinc-300 bg-white px-8 py-3 text-base font-semibold text-zinc-800 hover:bg-zinc-50 sm:w-auto"
              >
                ログインはこちら
              </Link>
            </div>
          </div>
        </section>

        {/* Problems */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            現場のこんな悩み、ありませんか？
          </h2>
          <ul className="mx-auto mt-10 grid max-w-3xl gap-4">
            {problems.map((problem) => (
              <li
                key={problem}
                className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700">
                  !
                </span>
                <p className="text-sm leading-relaxed text-zinc-700 sm:text-base">{problem}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section className="border-y border-zinc-100 bg-zinc-50">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              3つの機能で、現場が回る
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-relaxed text-zinc-600 sm:text-base">
              迷わず使えるシンプルさにこだわりました。ITが得意でない方でも、その日から使い始められます。
            </p>
            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            使い始めは、たったの3ステップ
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {steps.map((item) => (
              <div key={item.step} className="relative">
                <span className="text-4xl font-bold text-orange-200">{item.step}</span>
                <h3 className="mt-2 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Audience */}
        <section className="border-y border-zinc-100 bg-zinc-50">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              元請にも、協力会社にも
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
                <p className="text-sm font-semibold text-orange-700">元請（工務店・ゼネコン）の方へ</p>
                <h3 className="mt-2 text-lg font-semibold">案件全体を見渡し、指示を確実に届ける</h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                  複数案件の進捗を一覧で管理し、協力会社をメンバーに追加するだけで工程と写真を共有。
                  電話やFAXでの伝達漏れがなくなります。
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
                <p className="text-sm font-semibold text-orange-700">協力会社（専門工事業者）の方へ</p>
                <h3 className="mt-2 text-lg font-semibold">自分の担当工程と最新情報がすぐわかる</h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                  招待された案件の工程表と写真をいつでも確認。現場からスマホで写真を上げるだけで、
                  報告が完了します。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="rounded-2xl bg-zinc-900 px-6 py-12 text-center sm:px-12 sm:py-16">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              今日から、現場の情報をひとつに。
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-300 sm:text-base">
              メールアドレスがあれば、すぐに無料で始められます。
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-block rounded-md bg-orange-600 px-8 py-3 text-base font-semibold text-white hover:bg-orange-500"
            >
              無料でアカウント作成
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row">
          <span className="text-sm font-semibold text-zinc-700">施工管理アプリ</span>
          <div className="flex items-center gap-4 text-sm text-zinc-500">
            <Link href="/login" className="hover:text-zinc-800">
              ログイン
            </Link>
            <Link href="/signup" className="hover:text-zinc-800">
              新規登録
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
