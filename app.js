'use strict';
/* =====================================================================
   ملخصاتي — واجهة الطالب + أدوات مشتركة
   (لوحة المدير في admin.js)
   ===================================================================== */

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const S = { user: null, profile: null, settings: {}, recovery: false, after: null };
let deferredInstall = null;

/* ---------- أدوات عامة ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => S.profile?.role === 'admin';

async function q(promise) {           // يرمي الخطأ إن وُجد ويعيد البيانات
  const r = await promise;
  if (r.error) throw r.error;
  return r.data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
}
function money(n) {
  return Number(n).toLocaleString('ar-u-nu-latn') + ' ' + (S.settings.currency || '');
}
function durLabel(d) {
  d = Number(d);
  if (d === 30) return 'شهر واحد';
  if (d >= 360) return 'سنة كاملة';
  if (d % 30 === 0) return (d / 30) + ' أشهر';
  return d + ' يوماً';
}
function openModal(html, wide) {
  closeModal();
  const d = document.createElement('div');
  d.className = 'back';
  d.innerHTML = `<div class="box ${wide ? 'wide' : ''}">${html}</div>`;
  d.addEventListener('click', e => { if (e.target === d) closeModal(); });
  $('#modal-root').appendChild(d);
  return d.firstElementChild;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// ضغط الصور قبل الرفع (يوفّر المساحة والبيانات)
async function compress(file, max = 1100, type = 'image/webp', quality = 0.8) {
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, type, quality));
  if (!blob) throw new Error('تعذّر معالجة الصورة');
  return blob;
}
const extOf = blob => blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';

// صورة خاصة عبر رابط مؤقت → blob محلي
async function privateImage(bucket, path, seconds = 120) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw error;
  const blob = await (await fetch(data.signedUrl)).blob();
  return URL.createObjectURL(blob);
}

/* ---------- الجلسة والإعدادات ---------- */
async function loadSession() {
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null;
  S.profile = null;
  if (S.user) {
    const { data } = await sb.from('profiles').select('*').eq('id', S.user.id).single();
    S.profile = data;
  }
}
async function loadSettings() {
  const { data } = await sb.from('settings').select('*');
  S.settings = Object.fromEntries((data || []).map(r => [r.key, r.value]));
}
function renderNav() {
  let h = '';
  if (S.user) {
    if (isAdmin()) h += '<a href="#/admin">لوحة المدير</a>';
    h += '<a href="#/me">حسابي</a><button id="logout">خروج</button>';
  } else h += '<a href="#/login">دخول</a>';
  $nav.innerHTML = h;
  $('#logout')?.addEventListener('click', async () => {
    await sb.auth.signOut();
    S.user = null; S.profile = null; renderNav(); go('#/');
  });
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

/* ---------- حماية المحتوى (علامة مائية + منع النسخ) ---------- */
function setProtected(on) {
  document.body.classList.toggle('protected', on);
  let wm = $('#wm');
  if (on && S.profile && !isAdmin()) {
    if (!wm) { wm = document.createElement('div'); wm.id = 'wm'; document.body.appendChild(wm); }
    const t = esc(`${S.profile.full_name} ${S.profile.phone}`);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='280' height='170'><text x='18' y='95' transform='rotate(-25 140 85)' font-size='15' fill='rgba(0,0,0,0.14)' font-family='sans-serif'>${t}</text></svg>`;
    wm.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  } else if (wm) wm.remove();
}
const isProt = () => document.body.classList.contains('protected');
document.addEventListener('contextmenu', e => { if (isProt()) e.preventDefault(); });
document.addEventListener('dragstart', e => { if (isProt()) e.preventDefault(); });
document.addEventListener('copy', e => { if (isProt()) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (!isProt()) return;
  const k = (e.key || '').toLowerCase();
  if (((e.ctrlKey || e.metaKey) && ['s', 'p', 'u', 'c', 'a'].includes(k)) || k === 'f12' || k === 'printscreen') e.preventDefault();
});
document.addEventListener('keyup', e => {
  if (isProt() && (e.key || '').toLowerCase() === 'printscreen') navigator.clipboard?.writeText(' ').catch(() => {});
});

/* ---------- المسارات ---------- */
const routes = {
  '': pageWelcome, stage: pageStage, level: pageLevel, subject: pageSubject,
  lesson: pageLesson, quiz: pageQuiz, me: pageMe, login: pageAuth,
  admin: (...a) => window.pageAdmin(...a)
};
async function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('access_token') || hash.startsWith('error')) return;
  if (S.recovery) return pageRecovery();
  const parts = hash.replace(/^\//, '').split('/');
  const name = parts[0] || '';
  setProtected(name === 'lesson' || name === 'quiz');
  window.scrollTo(0, 0);
  $app.innerHTML = '<div class="center muted">جارٍ التحميل…</div>';
  try { await (routes[name] || pageWelcome)(...parts.slice(1)); }
  catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="notice n-bad">حدث خطأ: ${esc(e.message || e)}</div><a class="btn btn-light" href="#/">الرئيسية</a>`;
  }
}
window.addEventListener('hashchange', route);

/* ---------- الصفحة الرئيسية ---------- */
async function pageWelcome() {
  const stages = await q(sb.from('stages').select('*').order('sort').order('name'));
  $app.innerHTML = `
    <div class="hero"><h1>📚 ملخصاتي</h1><p>دروس ملخصة بصور تعبيرية واختبارات لكل مستوى دراسي</p></div>
    <h2>اختر المرحلة الدراسية</h2>
    ${stages.length
      ? `<div class="grid">${stages.map(s => `<a class="card tile" href="#/stage/${s.id}"><span class="ico">🎓</span>${esc(s.name)}</a>`).join('')}</div>`
      : '<div class="notice n-info">لا توجد مراحل دراسية بعد.</div>'}
    <div id="inst"></div>`;
  renderInstall();
}
function renderInstall() {
  const box = $('#inst'); if (!box) return;
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
  if (deferredInstall) {
    box.innerHTML = '<div class="card" style="margin-top:18px;text-align:center"><b>ثبّت التطبيق على شاشتك</b><br><button id="doinst" style="margin-top:8px">تثبيت</button></div>';
    $('#doinst').onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; box.innerHTML = ''; };
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    box.innerHTML = '<div class="notice n-info" style="margin-top:18px">لتثبيت التطبيق على الآيفون: اضغط زر المشاركة في Safari ثم «إضافة إلى الشاشة الرئيسية».</div>';
  }
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; renderInstall(); });

async function pageStage(id) {
  const [st, levels] = await Promise.all([
    q(sb.from('stages').select('*').eq('id', id).single()),
    q(sb.from('levels').select('*').eq('stage_id', id).order('sort').order('name'))
  ]);
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › ${esc(st.name)}</div>
    <h1>${esc(st.name)}</h1><h2>اختر المستوى</h2>
    ${levels.length
      ? `<div class="grid">${levels.map(l => `<a class="card tile" href="#/level/${l.id}"><span class="ico">📘</span>${esc(l.name)}</a>`).join('')}</div>`
      : '<div class="notice n-info">لا توجد مستويات في هذه المرحلة بعد.</div>'}`;
}

/* ---------- المستوى: الاشتراك أو المواد ---------- */
const subjIcon = n => /إسلام/.test(n) ? '🕌' : /عرب/.test(n) ? '📖' : /رياض/.test(n) ? '🔢' : /مدني/.test(n) ? '🏛️'
  : /تاريخ|جغراف/.test(n) ? '🌍' : /علوم/.test(n) ? '🔬' : /فرنس/.test(n) ? '🇫🇷' : '📘';

async function pageLevel(id) {
  const level = await q(sb.from('levels').select('*, stages(id,name)').eq('id', id).single());
  const crumbs = `<div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/stage/${level.stages.id}">${esc(level.stages.name)}</a> › ${esc(level.name)}</div>`;

  let sub = null, pastSub = null, payments = [];
  if (S.user) {
    const subs = await q(sb.from('subscriptions').select('*').eq('user_id', S.user.id).eq('level_id', id).order('ends_at', { ascending: false }));
    const now = Date.now();
    sub = subs.find(s => new Date(s.ends_at).getTime() > now) || null;
    pastSub = !sub && subs.length ? subs[0] : null;
    payments = await q(sb.from('payments').select('*').eq('user_id', S.user.id).eq('level_id', id).order('created_at', { ascending: false }).limit(3));
  }

  if (sub || isAdmin()) {
    const subjects = (await q(sb.from('subjects').select('*').eq('level_id', id).order('sort').order('name'))).filter(s => !s.hidden);
    $app.innerHTML = `${crumbs}<h1>${esc(level.name)}</h1>
      ${sub ? `<div class="notice n-ok">اشتراكك ساري حتى <b>${fmtDate(sub.ends_at)}</b></div>` : '<div class="notice n-info">عرض المدير</div>'}
      <h2>المواد</h2>
      ${subjects.length
        ? `<div class="grid">${subjects.map(s => `<a class="card tile" href="#/subject/${s.id}"><span class="ico">${subjIcon(s.name)}</span>${esc(s.name)}</a>`).join('')}</div>`
        : '<div class="notice n-info">لا توجد مواد بعد.</div>'}`;
    return;
  }

  const plans = await q(sb.from('plans').select('*').eq('level_id', id).eq('hidden', false).order('price'));
  let html = `${crumbs}<h1>${esc(level.name)}</h1>`;

  if (!S.user) {
    html += `<div class="notice n-info">المحتوى متاح للمشتركين فقط. أنشئ حساباً أو سجّل الدخول ثم اختر الاشتراك المناسب.</div>
      <h2>الاشتراكات المتاحة</h2>${plansView(plans, false)}
      <a class="btn btn-block" href="#/login" id="tologin" style="margin-top:12px">تسجيل الدخول / إنشاء حساب</a>`;
    $app.innerHTML = html;
    $('#tologin').onclick = () => { S.after = '#/level/' + id; };
    return;
  }

  const last = payments[0];
  if (pastSub) html += `<div class="notice n-warn">انتهى اشتراكك السابق بتاريخ ${fmtDate(pastSub.ends_at)}. يمكنك التجديد أدناه.</div>`;
  if (last?.status === 'pending') {
    html += `<div class="notice n-warn">⏳ طلبك (${esc(last.plan_name)}) قيد المراجعة. سيُفعَّل اشتراكك فور موافقة المدير على إيصال الدفع.</div>
             <button class="btn-light btn-block" onclick="route()">تحديث الحالة</button>`;
    $app.innerHTML = html; return;
  }
  if (last?.status === 'rejected') {
    html += `<div class="notice n-bad">تم رفض طلبك الأخير${last.reject_reason ? ': ' + esc(last.reject_reason) : ''}. يمكنك إعادة المحاولة.</div>`;
  }
  html += `<h2>اختر الاشتراك</h2>
    <form id="payform">
      ${plansView(plans, true)}
      <h2>طريقة الدفع</h2>
      <div class="payinfo">${esc(S.settings.payment_info || 'تواصل مع المدير لمعرفة طريقة الدفع.')}</div>
      <label for="receipt">صورة إيصال الدفع</label>
      <input type="file" id="receipt" accept="image/*">
      <button class="btn-block" type="submit" style="margin-top:14px">إرسال طلب الاشتراك</button>
    </form>`;
  $app.innerHTML = html;

  $$('.plan input').forEach(i => i.addEventListener('change', () => {
    $$('.plan').forEach(p => p.classList.toggle('sel', p.querySelector('input').checked));
  }));
  $('#payform').addEventListener('submit', async e => {
    e.preventDefault();
    const plan = $('input[name=plan]:checked')?.value;
    const file = $('#receipt').files[0];
    if (!plan) return toast('اختر نوع الاشتراك');
    if (!file) return toast('ارفع صورة الإيصال');
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'جارٍ الإرسال…';
    try {
      const blob = await compress(file, 1400, 'image/jpeg', 0.82);
      const path = `${S.user.id}/${Date.now()}.${extOf(blob)}`;
      const up = await sb.storage.from('receipts').upload(path, blob, { contentType: blob.type });
      if (up.error) throw up.error;
      const ins = await sb.from('payments').insert({ user_id: S.user.id, plan_id: plan, receipt_path: path });
      if (ins.error) throw ins.error;
      toast('تم إرسال الطلب ✔'); route();
    } catch (err) { toast('تعذّر الإرسال: ' + (err.message || err)); btn.disabled = false; btn.textContent = 'إرسال طلب الاشتراك'; }
  });
}
function plansView(plans, selectable) {
  if (!plans.length) return '<div class="notice n-info">لم يحدد المدير أسعار الاشتراك بعد.</div>';
  return `<div class="plans">${plans.map(p => `
    <label class="plan">${selectable ? `<input type="radio" name="plan" value="${p.id}">` : ''}
      <span><b>${esc(p.name)}</b><br><small class="muted">${durLabel(p.duration_days)}</small></span>
      <span class="price">${money(p.price)}</span></label>`).join('')}</div>`;
}

/* ---------- المادة والدروس ---------- */
async function pageSubject(id) {
  const sj = await q(sb.from('subjects').select('*, levels(id,name)').eq('id', id).single());
  const lessons = (await q(sb.from('lessons').select('id,title,hidden,sort').eq('subject_id', id).order('sort').order('created_at'))).filter(l => !l.hidden);
  let best = {};
  if (lessons.length && S.user) {
    const rs = await q(sb.from('results').select('lesson_id,score_pct').eq('user_id', S.user.id).in('lesson_id', lessons.map(l => l.id)));
    rs.forEach(r => { best[r.lesson_id] = Math.max(best[r.lesson_id] ?? 0, r.score_pct); });
  }
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/level/${sj.levels.id}">${esc(sj.levels.name)}</a> › ${esc(sj.name)}</div>
    <h1>${subjIcon(sj.name)} ${esc(sj.name)}</h1>
    ${lessons.length ? `<div class="list">${lessons.map((l, i) => `
      <a class="row" href="#/lesson/${l.id}"><span class="num">${i + 1}</span><span class="grow">${esc(l.title)}</span>
      ${best[l.id] != null ? `<span class="badge b-green">${best[l.id]}%</span>` : ''}</a>`).join('')}</div>`
      : '<div class="notice n-info">لا توجد دروس في هذه المادة بعد.</div>'}`;
}

function fmtSummary(t) {
  let out = '', inUl = false;
  for (const raw of String(t || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (/^[-•*]\s/.test(l)) { if (!inUl) { out += '<ul>'; inUl = true; } out += `<li>${esc(l.slice(2))}</li>`; continue; }
    if (inUl) { out += '</ul>'; inUl = false; }
    if (!l) continue;
    out += l.startsWith('# ') ? `<h3>${esc(l.slice(2))}</h3>` : `<p>${esc(l)}</p>`;
  }
  return out + (inUl ? '</ul>' : '');
}

async function pageLesson(id) {
  const ls = await q(sb.from('lessons').select('*, subjects(id,name,level_id)').eq('id', id).single());
  let img = '';
  if (ls.image_path) {
    try { img = `<img class="lesson-img" draggable="false" alt="" src="${await privateImage('lesson-images', ls.image_path)}">`; }
    catch (e) { console.warn(e); }
  }
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/level/${ls.subjects.level_id}">المواد</a> › <a href="#/subject/${ls.subjects.id}">${esc(ls.subjects.name)}</a></div>
    <h1>${esc(ls.title)}</h1>
    ${img}
    <div class="summary">${fmtSummary(ls.summary)}</div>
    <a class="btn btn-block" style="margin-top:16px" href="#/quiz/${ls.id}">📝 اختبر نفسك</a>
    <a class="btn btn-line btn-block" style="margin-top:10px" href="#/subject/${ls.subjects.id}">الرجوع إلى الدروس</a>`;
}

/* ---------- الاختبار QCM ---------- */
const levelLabel = p => p >= 85 ? ['ممتاز', 's-great'] : p >= 70 ? ['جيد', 's-good'] : p >= 50 ? ['متوسط', 's-mid'] : ['ضعيف', 's-low'];

async function pageQuiz(id) {
  const ls = await q(sb.from('lessons').select('id,title').eq('id', id).single());
  const { data: qs, error } = await sb.rpc('get_quiz', { p_lesson: id });
  if (error) throw error;
  if (!qs.length) {
    $app.innerHTML = `<h1>${esc(ls.title)}</h1><div class="notice n-info">لا يوجد اختبار لهذا الدرس بعد.</div>
      <a class="btn btn-light" href="#/lesson/${id}">العودة للدرس</a>`;
    return;
  }
  const opts = o => (Array.isArray(o) ? o : []);
  $app.innerHTML = `
    <div class="crumbs"><a href="#/lesson/${id}">← العودة للدرس</a></div>
    <h1>اختبار: ${esc(ls.title)}</h1>
    <form id="quiz">
      ${qs.map((x, i) => `
        <div class="q"><div class="qt">${i + 1}. ${esc(x.question)}</div>
          ${opts(x.options).map((o, j) => `<label class="opt"><input type="radio" name="q${i}" value="${j}"><span>${esc(o)}</span></label>`).join('')}
        </div>`).join('')}
      <button class="btn-block" type="submit">إنهاء الاختبار</button>
    </form>`;

  $('#quiz').addEventListener('submit', async e => {
    e.preventDefault();
    const answers = {}; let missing = 0;
    qs.forEach((x, i) => {
      const v = $(`input[name=q${i}]:checked`);
      if (v) answers[x.id] = Number(v.value); else missing++;
    });
    if (missing && !confirm(`لم تُجب عن ${missing} سؤال. هل تريد الإنهاء؟`)) return;
    const btn = e.submitter; btn.disabled = true;
    const { data, error } = await sb.rpc('submit_quiz', { p_lesson: id, p_answers: answers });
    if (error) { toast('تعذّر التصحيح: ' + error.message); btn.disabled = false; return; }
    showResult(id, ls, qs, data, opts);
  });
}
function showResult(id, ls, qs, res, opts) {
  const [label, cls] = levelLabel(res.score_pct);
  const det = Object.fromEntries(res.details.map(d => [d.id, d]));
  window.scrollTo(0, 0);
  $app.innerHTML = `
    <h1>نتيجة: ${esc(ls.title)}</h1>
    <div class="score ${cls}"><div class="pct">${res.score_pct}%</div>
      <div style="font-size:22px;font-weight:800">المستوى: ${label}</div>
      <div>${res.correct} من ${res.total} إجابة صحيحة</div>
      <div class="bar"><i style="width:${res.score_pct}%"></i></div></div>
    <a class="btn btn-block" href="#/quiz/${id}" onclick="route()">إعادة الاختبار</a>
    <a class="btn btn-line btn-block" style="margin-top:10px" href="#/lesson/${id}">العودة للدرس</a>
    <h2>مراجعة الإجابات</h2>
    ${qs.map((x, i) => {
      const d = det[x.id];
      return `<div class="q"><div class="qt">${i + 1}. ${esc(x.question)}</div>
        ${opts(x.options).map((o, j) => {
          const c = j === d.correct_index ? 'ok' : (j === d.chosen ? 'no' : '');
          return `<div class="opt ${c}">${c === 'ok' ? '✔' : c === 'no' ? '✘' : '○'} <span>${esc(o)}</span></div>`;
        }).join('')}</div>`;
    }).join('')}`;
}

/* ---------- حسابي ---------- */
async function pageMe() {
  if (!S.user) { S.after = '#/me'; return go('#/login'); }
  const [subs, pays, rs] = await Promise.all([
    q(sb.from('subscriptions').select('*, levels(name)').eq('user_id', S.user.id).order('ends_at', { ascending: false })),
    q(sb.from('payments').select('*, levels(name)').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10)),
    q(sb.from('results').select('*, lessons(title)').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10))
  ]);
  const now = Date.now();
  const st = { pending: ['قيد المراجعة', 'b-amber'], approved: ['مقبول', 'b-green'], rejected: ['مرفوض', 'b-red'] };
  $app.innerHTML = `
    <h1>حسابي</h1>
    <div class="card"><b>${esc(S.profile?.full_name)}</b><br><span class="muted">${esc(S.profile?.phone)} · ${esc(S.profile?.email)}</span></div>
    <h2>اشتراكاتي</h2>
    ${subs.length ? `<div class="list">${subs.map(s => {
      const on = new Date(s.ends_at).getTime() > now;
      return `<a class="row" href="#/level/${s.level_id}"><span class="grow">${esc(s.levels?.name)}<br><small class="muted">حتى ${fmtDate(s.ends_at)}</small></span>
        <span class="badge ${on ? 'b-green' : 'b-gray'}">${on ? 'ساري' : 'منتهٍ'}</span></a>`;
    }).join('')}</div>` : '<div class="notice n-info">لا توجد اشتراكات بعد.</div>'}
    <h2>طلبات الدفع</h2>
    ${pays.length ? `<div class="list">${pays.map(p => `<div class="row"><span class="grow">${esc(p.levels?.name)} — ${esc(p.plan_name)}<br>
      <small class="muted">${fmtDate(p.created_at)}${p.reject_reason ? ' · ' + esc(p.reject_reason) : ''}</small></span>
      <span class="badge ${st[p.status][1]}">${st[p.status][0]}</span></div>`).join('')}</div>` : '<div class="muted">—</div>'}
    <h2>آخر نتائجي</h2>
    ${rs.length ? `<div class="list">${rs.map(r => `<div class="row"><span class="grow">${esc(r.lessons?.title || 'درس')}<br><small class="muted">${fmtDate(r.created_at)}</small></span>
      <span class="badge b-green">${r.score_pct}% · ${levelLabel(r.score_pct)[0]}</span></div>`).join('')}</div>` : '<div class="muted">—</div>'}`;
}

/* ---------- الدخول والتسجيل ---------- */
const authErr = m => /Invalid login/i.test(m) ? 'البريد أو كلمة المرور غير صحيحة'
  : /already registered/i.test(m) ? 'هذا البريد مسجّل من قبل، سجّل الدخول'
  : /at least 6/i.test(m) ? 'كلمة المرور قصيرة (6 أحرف على الأقل)'
  : /rate limit/i.test(m) ? 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة' : m;

async function pageAuth(mode = 'login') {
  if (S.user) return go(S.after || '#/');
  const tabs = `<div class="tabs"><a href="#/login" class="${mode === 'login' ? 'on' : ''}">دخول</a>
    <a href="#/login/signup" class="${mode === 'signup' ? 'on' : ''}">حساب جديد</a></div>`;
  if (mode === 'forgot') {
    $app.innerHTML = `<h1>استرجاع كلمة المرور</h1><form id="af">
      <label>البريد الإلكتروني</label><input type="email" id="em" required autocomplete="email">
      <button class="btn-block" style="margin-top:14px">إرسال رابط الاسترجاع</button></form>
      <p><a href="#/login">رجوع</a></p>`;
    $('#af').onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.resetPasswordForEmail($('#em').value.trim(), { redirectTo: location.origin + location.pathname });
      toast(error ? authErr(error.message) : 'أُرسل الرابط إلى بريدك');
    };
    return;
  }
  $app.innerHTML = `<h1>${mode === 'signup' ? 'إنشاء حساب' : 'تسجيل الدخول'}</h1>${tabs}
    <form id="af">
      ${mode === 'signup' ? `<label>الاسم الكامل</label><input type="text" id="nm" required autocomplete="name">
        <label>رقم الهاتف</label><input type="tel" id="ph" required autocomplete="tel" inputmode="tel">` : ''}
      <label>البريد الإلكتروني</label><input type="email" id="em" required autocomplete="email">
      <label>كلمة المرور</label><input type="password" id="pw" required minlength="6" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}">
      <button class="btn-block" style="margin-top:14px">${mode === 'signup' ? 'إنشاء الحساب' : 'دخول'}</button>
    </form>
    ${mode === 'login' ? '<p><a href="#/login/forgot">نسيت كلمة المرور؟</a></p>' : ''}`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    const email = $('#em').value.trim(), password = $('#pw').value;
    let res;
    if (mode === 'signup') {
      res = await sb.auth.signUp({ email, password, options: { data: { full_name: $('#nm').value.trim(), phone: $('#ph').value.trim() } } });
      if (!res.error && !res.data.session) {
        btn.disabled = false;
        return toast('تحقّق من بريدك لتأكيد الحساب ثم سجّل الدخول');
      }
    } else res = await sb.auth.signInWithPassword({ email, password });
    if (res.error) { btn.disabled = false; return toast(authErr(res.error.message)); }
    await loadSession(); renderNav();
    const to = S.after || '#/'; S.after = null; go(to);
  };
}
async function pageRecovery() {
  $app.innerHTML = `<h1>كلمة مرور جديدة</h1><form id="af">
    <label>كلمة المرور الجديدة</label><input type="password" id="pw" required minlength="6" autocomplete="new-password">
    <button class="btn-block" style="margin-top:14px">حفظ</button></form>`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $('#pw').value });
    if (error) return toast(authErr(error.message));
    S.recovery = false; toast('تم تغيير كلمة المرور'); await loadSession(); renderNav(); go('#/');
  };
}

/* ---------- التشغيل ---------- */
sb.auth.onAuthStateChange(ev => {
  if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; route(); }
});
(async function init() {
  try {
    await Promise.all([loadSession(), loadSettings()]);
    renderNav();
    await route();
  } catch (e) {
    $app.innerHTML = `<div class="notice n-bad">تعذّر الاتصال بالخادم. تأكد من ملف config.js ومن اتصال الإنترنت.<br><small>${esc(e.message || e)}</small></div>`;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
