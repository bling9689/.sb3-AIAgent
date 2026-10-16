import { parseProject } from '../dsl.mjs';
import { CATALOG, toSb3 } from '../sb3core.mjs';
import { createSearchIndex, findNearest } from './generation.mjs';

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
const STORE_KEY = 'sb3forge.v040.projects';

const icons = {
  mark: '<svg viewBox="0 0 36 36" aria-hidden="true"><rect x="2" y="2" width="32" height="32" rx="9" fill="#2368e8"/><path d="M10 11h10a4 4 0 0 1 4 4v1M26 25H16a4 4 0 0 1-4-4v-1M12 13l-3 3 3 3M24 17l3 3-3 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  create: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5M12 7.5h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.2 3.7.6 1.8a7 7 0 0 1 1.4.8l1.8-.5 1.5 2.6-1.3 1.4a7 7 0 0 1 0 1.6l1.3 1.4-1.5 2.6-1.8-.5a7 7 0 0 1-1.4.8l-.6 1.8h-3l-.6-1.8a7 7 0 0 1-1.4-.8l-1.8.5-1.5-2.6 1.3-1.4a7 7 0 0 1 0-1.6L6.9 8.4l1.5-2.6 1.8.5a7 7 0 0 1 1.4-.8l.6-1.8z" transform="translate(0 0.5)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12.7" cy="10.6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 18v2h16v-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22 21H2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9v5m0 3h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
};

app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#create" data-view="create" aria-label="sb3forge ホーム">
        <span class="brand-mark">${icons.mark}</span>
        <span class="brand-copy"><strong>sb3forge</strong><small>SCRATCH PROJECT STUDIO</small></span>
        <span class="version-tag">v0.4.0</span>
      </a>

      <div class="sidebar-caption">WORKSPACE</div>
      <nav class="primary-nav" aria-label="ワークスペース">
        <button class="nav-link active" type="button" data-view="create">${icons.create}<span>新規プロジェクト</span></button>
        <button class="nav-link" type="button" data-view="studio">${icons.code}<span>DSLエディター</span></button>
        <button class="nav-link" type="button" data-view="projects">${icons.folder}<span>プロジェクト</span><span class="nav-count" id="project-count">0</span></button>
        <button class="nav-link" type="button" data-view="dataset">${icons.database}<span>データセット</span></button>
      </nav>

      <div class="sidebar-bottom">
        <div class="engine-card">
          <span class="engine-status-dot"></span>
          <div><strong>生成エンジン</strong><small>テンプレート検索方式</small></div>
          <span class="engine-local">LOCAL</span>
        </div>
        <button class="nav-link nav-about" type="button" data-view="about">${icons.info}<span>sb3forgeについて</span></button>
        <div class="sidebar-footer"><span class="footer-mark">${icons.mark}</span><span>Built for Scratch creators</span></div>
      </div>
    </aside>

    <main class="main-area">
      <header class="topbar">
        <div class="breadcrumbs"><span>sb3forge</span><span class="crumb-separator">/</span><strong id="breadcrumb-current">新規プロジェクト</strong></div>
        <div class="topbar-right">
          <span class="runtime-pill"><span></span>ブラウザー内で処理</span>
          <button class="icon-button" type="button" data-view="about" aria-label="情報">${icons.info}</button>
        </div>
      </header>

      <div class="view-stack">
        <section class="view active" id="view-create">
          <div class="page-intro">
            <div class="eyebrow"><span class="eyebrow-line"></span>SCRATCH PROJECT GENERATOR</div>
            <h1>アイデアを、<span>動くプロジェクト</span>へ。</h1>
            <p>作りたい動きを日本語で説明してください。近いサンプルを探し、DSLを組み立てて、Scratch 3 の .sb3 に変換します。</p>
          </div>

          <div class="create-layout">
            <div class="create-main">
              <article class="panel prompt-panel">
                <div class="panel-heading">
                  <div><span class="step-label">STEP 01</span><h2>どんな作品を作りますか？</h2></div>
                  <span class="input-counter" id="prompt-counter">0 / 800</span>
                </div>
                <label class="visually-hidden" for="instruction-input">作りたいScratchプロジェクトの説明</label>
                <textarea id="instruction-input" class="instruction-input" maxlength="800" placeholder="例：旗を押すと、キャラクターが10歩ずつ進み、端に触れたら跳ね返る。"></textarea>
                <div class="prompt-tools"><span class="helper-text">具体的な動作や数値を書くと、対応する例を探しやすくなります。</span><button class="text-button" id="clear-prompt" type="button">クリア</button></div>
                <div class="example-section"><span class="subsection-label">アイデアから選ぶ</span><div class="example-chips">
                  <button class="example-chip" type="button" data-example="旗を押すと、スプライトが15歩動く。">旗から動かす</button>
                  <button class="example-chip" type="button" data-example="右矢印キーを押すとx座標を10増やし、左矢印キーで10減らす。">キー操作</button>
                  <button class="example-chip" type="button" data-example="旗を押すとずっと10歩進み、端に触れたら跳ね返る。">端で跳ね返る</button>
                  <button class="example-chip" type="button" data-example="旗を押すと、スプライトがこんにちはと2秒言う。">セリフ</button>
                </div></div>
                <div class="prompt-footer"><span class="engine-note">${icons.sparkle}<span>基礎データ 1,000 件を検索</span></span><button class="button button-primary" id="generate-button" type="button">プロジェクトを生成 ${icons.arrow}</button></div>
              </article>

              <div class="result-card" id="generation-result" hidden></div>

              <article class="panel recent-panel">
                <div class="section-heading"><div><span class="step-label">YOUR WORK</span><h2>最近のプロジェクト</h2></div><button class="text-button" type="button" data-view="projects">すべて見る ${icons.arrow}</button></div>
                <div id="recent-projects" class="recent-list"><div class="empty-inline">まだプロジェクトはありません。最初の作品を作ってみましょう。</div></div>
              </article>
            </div>

            <aside class="create-aside">
              <article class="panel workflow-panel">
                <div class="aside-heading"><span class="aside-icon">${icons.sparkle}</span><div><h2>シンプルな3ステップ</h2><p>指示から .sb3 まで</p></div></div>
                <div class="workflow-list">
                  <div class="workflow-step"><span class="workflow-number">01</span><div><strong>説明文を入力</strong><p>作りたい動作を日本語で記述します。</p></div></div>
                  <div class="workflow-step"><span class="workflow-number">02</span><div><strong>DSLを生成・検証</strong><p>最も近い学習例からコードを構成します。</p></div></div>
                  <div class="workflow-step"><span class="workflow-number">03</span><div><strong>.sb3を書き出す</strong><p>構造チェックを通過したプロジェクトを保存します。</p></div></div>
                </div>
              </article>
              <article class="panel stats-panel">
                <div class="stats-heading"><span>DATASET OVERVIEW</span><span class="status-tag">LOADED</span></div>
                <div class="stats-grid"><div><strong id="stat-examples">—</strong><span>基礎データ</span></div><div><strong id="stat-opcodes">110</strong><span>opcodeカタログ</span></div><div><strong id="stat-templates">—</strong><span>テンプレート</span></div></div>
                <div class="stats-foot"><span class="dot-green"></span><span id="dataset-status">データセットを読み込み中…</span></div>
              </article>
              <article class="notice-card"><span class="notice-icon">${icons.info}</span><div><strong>現在の生成方式について</strong><p>v0.4.0は学習済み生成モデルではありません。既存例の近傍検索と数値差し替えを行う試作版です。</p></div></article>
            </aside>
          </div>
        </section>

        <section class="view" id="view-studio">
          <div class="page-intro compact-intro"><div class="eyebrow"><span class="eyebrow-line"></span>DSL WORKSPACE</div><h1>コードを確認して、<span>組み立てる。</span></h1><p>プロジェクト全体DSLを編集できます。構文を検証してから .sb3 をビルドしてください。</p></div>
          <div class="studio-toolbar"><div class="editor-tabs"><span class="editor-tab active">project.dsl</span><span class="editor-language">SB3FORGE DSL</span></div><div class="toolbar-actions"><button class="button button-secondary" id="validate-dsl" type="button">${icons.check} 構文を検証</button><button class="button button-primary" id="build-dsl" type="button">.sb3を構築 ${icons.arrow}</button></div></div>
          <div class="studio-layout"><div class="editor-panel"><div class="editor-header"><span><i></i> project.dsl</span><span id="editor-line-count">1 行</span></div><textarea id="dsl-editor" class="dsl-editor" spellcheck="false" aria-label="プロジェクトDSLエディター" placeholder="stage:\n\n sprite \"Cat\":\n  when_flag():\n    move(10)"></textarea><div class="editor-footer"><span id="dsl-status">DSLを入力するか、新規プロジェクトから生成してください。</span><button class="text-button" id="format-reset" type="button">生成時のコードに戻す</button></div></div><aside class="studio-inspector"><div class="inspector-heading"><span>VALIDATION</span><span class="status-tag" id="validation-tag">未検証</span></div><div class="validation-body" id="validation-body"><div class="validation-empty">${icons.check}<strong>検証待ち</strong><p>DSLを検証すると、スクリプト数やプロジェクト構造をここに表示します。</p></div></div><div class="inspector-divider"></div><div class="inspector-heading"><span>BUILD OUTPUT</span></div><div class="build-output" id="build-output"><span class="muted">まだビルドされていません。</span></div><button class="button button-primary button-full" id="download-built" type="button" disabled>${icons.download} .sb3をダウンロード</button></aside></div>
        </section>

        <section class="view" id="view-projects">
          <div class="page-intro compact-intro"><div class="eyebrow"><span class="eyebrow-line"></span>PROJECT LIBRARY</div><h1>作ったプロジェクトを、<span>ここに。</span></h1><p>生成したDSLをこのブラウザーに保存しています。保存したプロジェクトは再編集して .sb3 に書き出せます。</p></div>
          <div class="library-toolbar"><div class="search-field"><span>${icons.folder}</span><input type="search" id="project-search" placeholder="名前や説明文で検索…" aria-label="プロジェクト検索"></div><span class="library-count" id="library-count">0 projects</span></div>
          <div class="project-grid" id="project-grid"><div class="library-empty"><span>${icons.folder}</span><h2>まだプロジェクトがありません</h2><p>新規プロジェクトから作成したものが、ここに保存されます。</p><button class="button button-primary" type="button" data-view="create">最初のプロジェクトを作る ${icons.arrow}</button></div></div>
        </section>

        <section class="view" id="view-dataset">
          <div class="page-intro compact-intro"><div class="eyebrow"><span class="eyebrow-line"></span>DATASET INSPECTOR</div><h1>生成の基礎データ。</h1><p>同梱の基礎データを確認できます。データはこの画面内で読み込まれ、サーバーへ送信されません。</p></div>
          <div class="dataset-overview" id="dataset-overview"></div>
          <div class="dataset-table-panel"><div class="dataset-table-head"><div><h2>サンプル一覧</h2><p>読み込み済みタスクの説明文とテンプレート</p></div><div class="search-field dataset-search"><span>${icons.database}</span><input id="dataset-search" type="search" placeholder="説明文、テンプレート、カテゴリで検索…" aria-label="データセット検索"></div></div><div class="table-scroll"><table class="dataset-table"><thead><tr><th>説明文</th><th>カテゴリ</th><th>テンプレート</th><th>分割</th></tr></thead><tbody id="dataset-rows"><tr><td colspan="4">データを読み込んでいます…</td></tr></tbody></table></div><div class="table-footer" id="dataset-table-footer"></div></div>
        </section>

        <section class="view" id="view-about">
          <div class="page-intro compact-intro"><div class="eyebrow"><span class="eyebrow-line"></span>ABOUT SB3FORGE</div><h1>しくみを知って、<span>正しく使う。</span></h1><p>sb3forgeはScratch 3プロジェクト（.sb3）の構築、DSL変換、構造検証を行うための基盤ツールです。</p></div>
          <div class="about-grid"><article class="panel about-card"><span class="about-icon">${icons.code}</span><h2>DSL ⇄ プロジェクト</h2><p>Python風のDSLからScratch用IRを解析し、プロジェクトJSONと.sb3を生成します。</p></article><article class="panel about-card"><span class="about-icon">${icons.check}</span><h2>生成物の構造検証</h2><p>ビルド後の構造検証を行い、検証に失敗したプロジェクトは正常な生成物として扱いません。</p></article><article class="panel about-card"><span class="about-icon">${icons.database}</span><h2>ローカル処理</h2><p>説明文・DSL・検証結果の処理はブラウザー内で実行します。外部AI APIへの送信はありません。</p></article><article class="panel about-card about-caveat"><span class="about-icon">${icons.info}</span><h2>現在の限界</h2><p>自然言語生成は近傍検索と数値差し替えのベースラインです。任意の依頼を自由に実装する学習済みAIではなく、Scratch/TurboWarpでの実機実行もこのUIだけでは保証しません。</p></article></div>
          <div class="about-version"><span>${icons.mark}</span><div><strong>sb3forge v0.4.0</strong><p>Scratch Project Studio</p></div><span class="status-tag">PILOT</span></div>
        </section>
      </div>
    </main>
  </div>
`;

const state = {
  tasks: [],
  train: [],
  searchIndex: null,
  currentDraft: null,
  built: null,
  sourceDsl: '',
  recentLimit: 3,
  datasetLoaded: false,
  datasetError: null
};

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-symbol">${type === 'error' ? icons.alert : type === 'success' ? icons.check : icons.info}</span><span>${escapeHtml(message)}</span>`;
  toastRegion.append(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  window.setTimeout(() => {
    el.classList.remove('visible');
    window.setTimeout(() => el.remove(), 220);
  }, 3600);
}

function setView(view) {
  const allowed = ['create', 'studio', 'projects', 'dataset', 'about'];
  const target = allowed.includes(view) ? view : 'create';
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${target}`));
  document.querySelectorAll('[data-view]').forEach((el) => {
    if (el.classList.contains('nav-link')) el.classList.toggle('active', el.dataset.view === target);
  });
  const labels = { create: '新規プロジェクト', studio: 'DSLエディター', projects: 'プロジェクト', dataset: 'データセット', about: 'sb3forgeについて' };
  document.querySelector('#breadcrumb-current').textContent = labels[target];
  if (target === 'projects') renderProjects();
  if (target === 'dataset') renderDatasetRows();
  if (target === 'studio') updateEditorLines();
  window.history.replaceState(null, '', `#${target}`);
}

function getProjects() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setProjects(projects) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(projects.slice(0, 100)));
  } catch {
    showToast('ブラウザーの保存容量が不足しています。古いプロジェクトを削除してください。', 'error');
  }
  updateProjectCounts();
}

function updateProjectCounts() {
  const count = getProjects().length;
  document.querySelector('#project-count').textContent = String(count);
  document.querySelector('#library-count').textContent = `${count} projects`;
}

function buildSearchIndex() {
  state.searchIndex = createSearchIndex(state.tasks);
  state.train = state.searchIndex.train;
}

function validateDsl(dsl) {
  const spec = parseProject(dsl);
  const result = toSb3(spec);
  if (result.problems.length) {
    throw new Error(result.problems.slice(0, 8).join('\n'));
  }
  return { spec, result };
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function countScripts(spec) {
  let scripts = (spec.stage?.scripts?.length || 0) + (spec.stage?.procs?.length || 0);
  let sprites = spec.sprites?.length || 0;
  for (const sprite of spec.sprites || []) scripts += (sprite.scripts?.length || 0) + (sprite.procs?.length || 0);
  return { scripts, sprites };
}

function toFilename(name) {
  const clean = String(name || 'sb3forge-project')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${clean || 'sb3forge-project'}.sb3`;
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/x.scratch.sb3' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveDraftRecord(draft, result) {
  const records = getProjects();
  const id = draft.id || `p-${Date.now().toString(36)}`;
  const record = {
    id,
    name: draft.name || `Scratch Project ${new Date().toLocaleDateString('ja-JP')}`,
    instruction: draft.instruction || '',
    dsl: draft.dsl,
    template: draft.template || 'manual',
    category: draft.category || 'custom',
    score: draft.score ?? null,
    createdAt: draft.createdAt || new Date().toISOString(),
    fileSize: result?.bytes?.length || draft.fileSize || 0,
    stats: result ? countScripts(result.spec) : draft.stats || null
  };
  const next = [record, ...records.filter((item) => item.id !== id)];
  setProjects(next);
  renderRecentProjects();
  return record;
}

function updateDatasetStats() {
  const templates = new Set(state.tasks.map((task) => task.template));
  document.querySelector('#stat-examples').textContent = state.tasks.length.toLocaleString('ja-JP');
  document.querySelector('#stat-opcodes').textContent = String(Object.keys(CATALOG).length);
  document.querySelector('#stat-templates').textContent = templates.size.toLocaleString('ja-JP');
  document.querySelector('#dataset-status').textContent = `${state.train.length}件の訓練用サンプルを利用可能`;
  const counts = { train: 0, val: 0, heldout_template: 0, other: 0 };
  state.tasks.forEach((task) => {
    if (Object.hasOwn(counts, task.split)) counts[task.split]++;
    else counts.other++;
  });
  document.querySelector('#dataset-overview').innerHTML = `
    <div class="dataset-stat-card"><span class="dataset-stat-label">TOTAL EXAMPLES</span><strong>${state.tasks.length.toLocaleString('ja-JP')}</strong><span>読み込み済みレコード</span></div>
    <div class="dataset-stat-card"><span class="dataset-stat-label">TRAIN</span><strong>${counts.train.toLocaleString('ja-JP')}</strong><span>類似例検索に使用</span></div>
    <div class="dataset-stat-card"><span class="dataset-stat-label">VALIDATION</span><strong>${counts.val.toLocaleString('ja-JP')}</strong><span>検証用データ</span></div>
    <div class="dataset-stat-card"><span class="dataset-stat-label">HELDOUT</span><strong>${counts.heldout_template.toLocaleString('ja-JP')}</strong><span>未知テンプレート評価用</span></div>`;
}

function renderRecentProjects() {
  const container = document.querySelector('#recent-projects');
  const projects = getProjects().slice(0, state.recentLimit);
  if (!projects.length) {
    container.innerHTML = '<div class="empty-inline">まだプロジェクトはありません。最初の作品を作ってみましょう。</div>';
    return;
  }
  container.innerHTML = projects.map((project) => `
    <article class="recent-item">
      <div class="file-symbol">SB3</div>
      <button class="recent-main" type="button" data-open-project="${escapeHtml(project.id)}"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.instruction || 'DSLエディターから作成')}</span></button>
      <span class="recent-date">${new Date(project.createdAt).toLocaleDateString('ja-JP')}</span>
      <button class="small-icon-button" type="button" data-download-project="${escapeHtml(project.id)}" aria-label="${escapeHtml(project.name)}をダウンロード">${icons.download}</button>
    </article>`).join('');
}

function renderProjects() {
  updateProjectCounts();
  const query = document.querySelector('#project-search').value.trim().toLowerCase();
  const records = getProjects().filter((project) => `${project.name} ${project.instruction} ${project.template}`.toLowerCase().includes(query));
  const container = document.querySelector('#project-grid');
  if (!records.length) {
    container.innerHTML = `<div class="library-empty"><span>${icons.folder}</span><h2>${query ? '一致するプロジェクトがありません' : 'まだプロジェクトがありません'}</h2><p>${query ? '検索条件を変更してください。' : '新規プロジェクトから作成したものが、ここに保存されます。'}</p>${query ? '' : `<button class="button button-primary" type="button" data-view="create">最初のプロジェクトを作る ${icons.arrow}</button>`}</div>`;
    return;
  }
  container.innerHTML = records.map((project) => `
    <article class="project-card">
      <div class="project-card-top"><div class="project-file-icon">${icons.code}</div><span class="project-template">${escapeHtml(project.template)}</span></div>
      <h2>${escapeHtml(project.name)}</h2>
      <p class="project-instruction">${escapeHtml(project.instruction || 'DSLエディターで作成されたプロジェクト')}</p>
      <div class="project-meta"><span>${new Date(project.createdAt).toLocaleDateString('ja-JP')}</span><span>${project.fileSize ? formatBytes(project.fileSize) : '未ビルド'}</span></div>
      <div class="project-card-actions"><button class="button button-secondary" type="button" data-open-project="${escapeHtml(project.id)}">編集する</button><button class="button button-primary" type="button" data-download-project="${escapeHtml(project.id)}">${icons.download} .sb3</button></div>
    </article>`).join('');
}

function openProject(id) {
  const project = getProjects().find((item) => item.id === id);
  if (!project) return;
  state.currentDraft = { ...project, id: project.id };
  state.sourceDsl = project.dsl;
  document.querySelector('#dsl-editor').value = project.dsl;
  document.querySelector('#dsl-status').textContent = `「${project.name}」を開いています。`;
  setView('studio');
  runValidation(project.dsl, false);
}

function downloadProject(id) {
  const project = getProjects().find((item) => item.id === id);
  if (!project) return;
  try {
    const built = validateDsl(project.dsl);
    downloadBytes(built.result.bytes, toFilename(project.name));
    showToast('プロジェクトを書き出しました。', 'success');
  } catch (error) {
    showToast(`ビルドに失敗しました: ${error.message}`, 'error');
  }
}

function renderDatasetRows() {
  if (!state.datasetLoaded) return;
  const input = document.querySelector('#dataset-search');
  const query = input.value.trim().toLowerCase();
  const matches = state.tasks.filter((task) => `${task.instruction_ja} ${task.template} ${task.category} ${task.split}`.toLowerCase().includes(query));
  const maxRows = 60;
  document.querySelector('#dataset-rows').innerHTML = matches.slice(0, maxRows).map((task) => `
    <tr>
      <td><div class="sample-instruction">${escapeHtml(task.instruction_ja)}</div><div class="sample-title">${escapeHtml(task.title_ja || '')}</div></td>
      <td><span class="category-chip">${escapeHtml(task.category || 'other')}</span></td>
      <td><code>${escapeHtml(task.template || '—')}</code></td>
      <td><span class="split-chip split-${escapeHtml(task.split)}">${escapeHtml(task.split)}</span></td>
    </tr>`).join('') || '<tr><td colspan="4" class="table-no-results">検索結果がありません。</td></tr>';
  document.querySelector('#dataset-table-footer').textContent = `${matches.length.toLocaleString('ja-JP')} 件中 ${Math.min(matches.length, maxRows)} 件を表示`;
}

function updateEditorLines() {
  const value = document.querySelector('#dsl-editor').value;
  const count = value ? value.split('\n').length : 1;
  document.querySelector('#editor-line-count').textContent = `${count} 行`;
}

function renderValidation(data, passed) {
  const tag = document.querySelector('#validation-tag');
  const body = document.querySelector('#validation-body');
  tag.textContent = passed ? '合格' : 'エラー';
  tag.classList.toggle('status-tag-success', passed);
  tag.classList.toggle('status-tag-error', !passed);
  if (!passed) {
    body.innerHTML = `<div class="validation-error">${icons.alert}<div><strong>検証に失敗しました</strong><pre>${escapeHtml(data.message || String(data))}</pre></div></div>`;
    return;
  }
  const { spec, result } = data;
  const stats = countScripts(spec);
  body.innerHTML = `
    <div class="validation-success">${icons.check}<div><strong>構文とSB3構造は正常です</strong><span>ビルダーの検証を通過しました。</span></div></div>
    <div class="inspector-stats"><div><span>スプライト</span><strong>${stats.sprites}</strong></div><div><span>スクリプト</span><strong>${stats.scripts}</strong></div><div><span>コード量</span><strong>${document.querySelector('#dsl-editor').value.length.toLocaleString('ja-JP')} 字</strong></div></div>
    <div class="validation-detail"><span>検証結果</span><strong>${result.problems.length} errors</strong></div>
    <div class="validation-detail"><span>ビルダー</span><strong>sb3core v0.4.0</strong></div>`;
}

function runValidation(dsl, build = true) {
  try {
    const data = validateDsl(dsl);
    renderValidation(data, true);
    if (build) {
      state.built = { ...data, dsl };
      document.querySelector('#build-output').innerHTML = `<div class="output-file">${icons.check}<div><strong>${escapeHtml(toFilename(state.currentDraft?.name || 'sb3forge-project'))}</strong><span>${formatBytes(data.result.bytes.length)} · ZIP/SB3</span></div></div>`;
      const downloadButton = document.querySelector('#download-built');
      downloadButton.disabled = false;
      downloadButton.onclick = () => {
        downloadBytes(state.built.result.bytes, toFilename(state.currentDraft?.name || 'sb3forge-project'));
        if (state.currentDraft) saveDraftRecord({ ...state.currentDraft, dsl }, state.built.result);
        showToast('.sb3を書き出しました。', 'success');
      };
      document.querySelector('#dsl-status').textContent = `構築済み · ${new Date().toLocaleTimeString('ja-JP')}`;
    } else {
      document.querySelector('#build-output').innerHTML = '<span class="muted">構文検証済み。必要に応じて「.sb3を構築」を押してください。</span>';
      state.built = null;
      document.querySelector('#download-built').disabled = true;
    }
    return data;
  } catch (error) {
    renderValidation({ message: error.message }, false);
    document.querySelector('#dsl-status').textContent = '構文または構造にエラーがあります。';
    state.built = null;
    document.querySelector('#build-output').innerHTML = '<span class="text-error">ビルドできません。エラーを修正してください。</span>';
    document.querySelector('#download-built').disabled = true;
    return null;
  }
}

async function generateProject() {
  const input = document.querySelector('#instruction-input');
  const instruction = input.value.trim();
  if (!instruction) {
    input.focus();
    showToast('作りたい動作を入力してください。', 'error');
    return;
  }
  if (!state.datasetLoaded) {
    showToast('データセットを読み込み中です。少し待ってから再試行してください。', 'error');
    return;
  }
  const button = document.querySelector('#generate-button');
  button.disabled = true;
  button.classList.add('is-loading');
  button.innerHTML = '<span class="spinner"></span> 近い例を検索中…';
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const match = findNearest(instruction, state.searchIndex);
    const check = validateDsl(match.dsl);
    const draft = {
      id: `p-${Date.now().toString(36)}`,
      name: instruction.length > 32 ? `${instruction.slice(0, 32)}…` : instruction,
      instruction,
      dsl: match.dsl,
      template: match.source.template,
      category: match.source.category,
      score: match.score,
      sourceId: match.source.id,
      createdAt: new Date().toISOString(),
      fileSize: check.result.bytes.length,
      stats: countScripts(check.spec)
    };
    state.currentDraft = draft;
    state.sourceDsl = match.dsl;
    state.built = { ...check, dsl: match.dsl };
    document.querySelector('#dsl-editor').value = match.dsl;
    updateEditorLines();
    document.querySelector('#dsl-status').textContent = `「${draft.name}」の生成コード`;
    const confidence = Math.round(match.score * 100);
    const numberNote = match.numbersSwapped
      ? '説明文中の数値をテンプレートへ反映しました。'
      : match.queryNumbers === match.sourceNumbers
        ? '数値の差し替えはありません。'
        : `説明文と元サンプルの数値の個数が異なるため、数値の差し替えは行っていません（入力 ${match.queryNumbers} 個 / 元サンプル ${match.sourceNumbers} 個）。`;
    document.querySelector('#generation-result').hidden = false;
    document.querySelector('#generation-result').innerHTML = `
      <div class="result-topline"><div class="result-check">${icons.check}</div><div><span class="result-overline">BUILD SUCCESSFUL</span><h2>プロジェクトの土台ができました</h2></div><button class="close-result" type="button" id="close-result" aria-label="閉じる">×</button></div>
      <p class="result-copy">選択したサンプルをDSLへ変換し、.sb3構造の検証を通過しました。ファイルを保存する前にコードを確認できます。</p>
      <div class="result-stats"><div><span>類似度の目安</span><strong>${confidence}%</strong><small>文字n-gram cosine</small></div><div><span>スプライト</span><strong>${draft.stats.sprites}</strong><small>生成されたスプライト</small></div><div><span>スクリプト</span><strong>${draft.stats.scripts}</strong><small>トップレベルのコード</small></div><div><span>.sb3サイズ</span><strong>${formatBytes(draft.fileSize)}</strong><small>検証済みZIP</small></div></div>
      <div class="result-source"><span class="source-label">MATCHED TEMPLATE</span><strong>${escapeHtml(match.source.title_ja || match.source.template)}</strong><code>${escapeHtml(match.source.template)}</code></div>
      <div class="result-warning">${icons.info}<p>${escapeHtml(numberNote)} 類似度は自然言語の意味理解スコアではなく、説明文の文字パターンに基づく目安です。実際の動作はScratch/TurboWarpで確認してください。</p></div>
      <div class="result-actions"><button class="button button-secondary" type="button" id="edit-generated">DSLを確認・編集</button><button class="button button-primary" type="button" id="download-generated">${icons.download} .sb3をダウンロード</button></div>`;
    saveDraftRecord(draft, check.result);
    renderRecentProjects();
    showToast('DSLを解析し、.sb3構造の検証に成功しました。', 'success');
    document.querySelector('#close-result').addEventListener('click', () => { document.querySelector('#generation-result').hidden = true; });
    document.querySelector('#edit-generated').addEventListener('click', () => setView('studio'));
    document.querySelector('#download-generated').addEventListener('click', () => {
      downloadBytes(check.result.bytes, toFilename(draft.name));
      showToast('.sb3を書き出しました。', 'success');
    });
  } catch (error) {
    showToast(`生成に失敗しました: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.innerHTML = `プロジェクトを生成 ${icons.arrow}`;
  }
}

async function loadDataset() {
  const status = document.querySelector('#dataset-status');
  try {
    const response = await fetch(new URL('../dataset_basic_v1/tasks.jsonl', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`tasks.jsonl を取得できませんでした（HTTP ${response.status}）。`);
    const text = await response.text();
    state.tasks = text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`tasks.jsonl の ${index + 1} 行目を解析できません。`); }
    });
    if (!state.tasks.length) throw new Error('tasks.jsonl が空です。');
    buildSearchIndex();
    state.datasetLoaded = true;
    updateDatasetStats();
    renderDatasetRows();
    status.textContent = `${state.train.length}件の訓練用サンプルを利用可能`;
  } catch (error) {
    state.datasetError = error;
    status.textContent = 'データセットのアップロードが必要です';
    status.closest('.stats-foot').classList.add('status-error-text');
    const panel = document.querySelector('.stats-panel');
    if (!document.querySelector('#dataset-upload')) {
      const label = document.createElement('label');
      label.className = 'dataset-upload-label';
      label.htmlFor = 'dataset-upload';
      label.textContent = 'tasks.jsonl を選択';
      const picker = document.createElement('input');
      picker.id = 'dataset-upload';
      picker.type = 'file';
      picker.accept = '.jsonl,application/x-ndjson,text/plain';
      picker.style.display = 'none';
      picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        if (!file) return;
        try {
          const rows = (await file.text()).split(/\\r?\\n/).filter(Boolean).map((line, index) => {
            try { return JSON.parse(line); }
            catch { throw new Error(`tasks.jsonl の ${index + 1} 行目を解析できません。`); }
          });
          if (!rows.length) throw new Error('選択したファイルにデータがありません。');
          state.tasks = rows;
          buildSearchIndex();
          state.datasetLoaded = true;
          updateDatasetStats();
          renderDatasetRows();
          label.remove();
          showToast(`データセットを読み込みました（${rows.length}件）。`, 'success');
        } catch (uploadError) {
          showToast(`データセットを読み込めませんでした: ${uploadError.message}`, 'error');
        }
      });
      label.addEventListener('click', () => picker.click());
      panel.append(label, picker);
    }
    showToast('同じフォルダーにデータセットが見つかりません。tasks.jsonl を選択してください。', 'info');
  }
}

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    event.preventDefault();
    setView(viewButton.dataset.view);
  }
  const example = event.target.closest('[data-example]');
  if (example) {
    const input = document.querySelector('#instruction-input');
    input.value = example.dataset.example;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
  const openButton = event.target.closest('[data-open-project]');
  if (openButton) openProject(openButton.dataset.openProject);
  const downloadButton = event.target.closest('[data-download-project]');
  if (downloadButton) downloadProject(downloadButton.dataset.downloadProject);
});

document.querySelector('#instruction-input').addEventListener('input', (event) => {
  document.querySelector('#prompt-counter').textContent = `${event.target.value.length} / 800`;
});
document.querySelector('#clear-prompt').addEventListener('click', () => {
  const input = document.querySelector('#instruction-input');
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
});
document.querySelector('#generate-button').addEventListener('click', generateProject);
document.querySelector('#instruction-input').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') generateProject();
});
document.querySelector('#validate-dsl').addEventListener('click', () => {
  const text = document.querySelector('#dsl-editor').value;
  runValidation(text, false);
});
document.querySelector('#build-dsl').addEventListener('click', () => {
  const text = document.querySelector('#dsl-editor').value;
  const data = runValidation(text, true);
  if (data) {
    const draft = state.currentDraft || {
      id: `p-${Date.now().toString(36)}`,
      name: 'Untitled Scratch Project',
      instruction: '',
      template: 'manual',
      category: 'custom',
      createdAt: new Date().toISOString()
    };
    state.currentDraft = saveDraftRecord({ ...draft, dsl: text }, data.result);
    showToast('.sb3の構築に成功しました。', 'success');
  }
});
document.querySelector('#dsl-editor').addEventListener('input', updateEditorLines);
document.querySelector('#format-reset').addEventListener('click', () => {
  if (!state.sourceDsl) {
    showToast('復元する生成時のDSLがありません。', 'info');
    return;
  }
  document.querySelector('#dsl-editor').value = state.sourceDsl;
  updateEditorLines();
  document.querySelector('#dsl-status').textContent = '生成時のコードに戻しました。';
  state.built = null;
  document.querySelector('#download-built').disabled = true;
  showToast('生成時のDSLに戻しました。', 'success');
});
document.querySelector('#project-search').addEventListener('input', renderProjects);
document.querySelector('#dataset-search').addEventListener('input', renderDatasetRows);

updateProjectCounts();
renderRecentProjects();
loadDataset();
const initialView = window.location.hash.slice(1);
if (initialView) setView(initialView);
