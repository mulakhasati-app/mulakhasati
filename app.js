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
  '': pageWelcome, stage: pageStage, level: pageLevel, subject: pageSubject, fields: pageFields, field: pageField, exams: pageExams, exam: pageExam,
  lesson: pageLesson, quiz: pageQuiz, me: pageMe, login: pageAuth,
  admin: (...a) => window.pageAdmin(...a)
};
async function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('access_token') || hash.startsWith('error')) return;
  if (S.recovery) return pageRecovery();
  const parts = hash.replace(/^\//, '').split('/');
  const name = parts[0] || '';
  setProtected(name === 'lesson' || name === 'quiz' || name === 'exam');
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
      <div class="payinfo">${payInfoHtml(S.settings.payment_info || 'تواصل مع المدير لمعرفة طريقة الدفع.')}</div>
      <label class="upzone" for="receipt" id="upzone">
        <span class="up-ic">📤</span>
        <b class="up-t">أرسل صورة الدفع من هنا</b>
        <span class="up-s">اضغط لاختيار صورة إيصال الدفع من هاتفك</span>
        <img id="uppv" alt="" hidden>
      </label>
      <input type="file" id="receipt" accept="image/*" hidden>
      <button class="btn-block" type="submit" style="margin-top:14px">إرسال طلب الاشتراك</button>
    </form>`;
  $app.innerHTML = html;

  $$('.cpbtn').forEach(b => b.onclick = () => copyText(b.dataset.n, b));
  $('#receipt').addEventListener('change', e => {
    const f = e.target.files[0], z = $('#upzone'), pv = $('#uppv');
    if (!f) { z.classList.remove('done'); pv.hidden = true; return; }
    z.classList.add('done'); $('.up-t', z).textContent = '✔ تم اختيار الصورة';
    $('.up-s', z).textContent = 'اضغط مرة أخرى لتغييرها';
    try { pv.src = URL.createObjectURL(f); pv.hidden = false; } catch (_) {}
  });
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
function payInfoHtml(t) {
  return esc(t).replace(/\d[\d ]{5,}\d/g, m => {
    const n = m.replace(/ /g, '');
    return `<span class="cpnum" dir="ltr">${m}</span><button type="button" class="cpbtn" data-n="${n}">📋 نسخ</button>`;
  });
}
async function copyText(txt, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch (_) {}
  if (!ok) {
    try { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (_) {}
  }
  toast(ok ? 'تم نسخ الرقم ✔' : 'تعذّر النسخ، انسخ الرقم يدويًا');
  if (ok && btn) { const o = btn.textContent; btn.textContent = '✔ تم'; setTimeout(() => btn.textContent = o, 1500); }
}
function plansView(plans, selectable) {
  if (!plans.length) return '<div class="notice n-info">لم يحدد المدير أسعار الاشتراك بعد.</div>';
  return `<div class="plans">${plans.map(p => `
    <label class="plan">${selectable ? `<input type="radio" name="plan" value="${p.id}">` : ''}
      <span><b>${esc(p.name)}</b><br><small class="muted">${durLabel(p.duration_days)}</small></span>
      <span class="price">${money(p.price)}</span></label>`).join('')}</div>`;
}

/* ---------- المادة ← المجالات ← الدروس ---------- */
const fieldIcon = '📂';

async function pageSubject(id) {
  const sj = await q(sb.from('subjects').select('*, levels(id,name)').eq('id', id).single());
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/level/${sj.levels.id}">${esc(sj.levels.name)}</a> › ${esc(sj.name)}</div>
    <h1>${subjIcon(sj.name)} ${esc(sj.name)}</h1>
    <div class="list">
      <a class="row" href="#/fields/${sj.id}"><span class="num">📂</span><span class="grow"><b>المجالات</b><br><small class="muted">الدروس والملخصات</small></span></a>
      <a class="row" href="#/exams/${sj.id}"><span class="num">📝</span><span class="grow"><b>الاختبارات</b><br><small class="muted">اختبارات QCM لقياس مستواك</small></span></a>
    </div>`;
}

async function pageFields(id) {
  const sj = await q(sb.from('subjects').select('*, levels(id,name)').eq('id', id).single());
  const [fields, loose] = await Promise.all([
    q(sb.from('fields').select('id,name,hidden,sort').eq('subject_id', id).order('sort').order('name')),
    q(sb.from('lessons').select('id,title,hidden,sort').eq('subject_id', id).is('field_id', null).order('sort').order('created_at'))
  ]);
  const vf = fields.filter(f => !f.hidden);
  const vl = loose.filter(l => !l.hidden);
  // عدد الدروس الظاهرة في كل مجال
  const counts = {};
  if (vf.length) {
    const ls = await q(sb.from('lessons').select('id,field_id,hidden').in('field_id', vf.map(f => f.id)));
    ls.filter(l => !l.hidden).forEach(l => { counts[l.field_id] = (counts[l.field_id] || 0) + 1; });
  }
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/level/${sj.levels.id}">${esc(sj.levels.name)}</a> › <a href="#/subject/${sj.id}">${esc(sj.name)}</a> › المجالات</div>
    <h1>${subjIcon(sj.name)} ${esc(sj.name)}</h1>
    ${vf.length ? `<h2>اختر المجال</h2><div class="list">${vf.map(f => `
      <a class="row" href="#/field/${f.id}"><span class="num">${fieldIcon}</span><span class="grow">${esc(f.name)}</span>
      <span class="badge b-gray">${lessonCount(counts[f.id] || 0)}</span></a>`).join('')}</div>` : ''}
    ${vl.length ? `<h2>دروس أخرى</h2>${lessonRows(vl, {})}` : ''}
    ${!vf.length && !vl.length ? '<div class="notice n-info">لا توجد مجالات في هذه المادة بعد.</div>' : ''}`;
}

function lessonCount(n) {
  return n === 0 ? 'لا دروس' : n === 1 ? 'درس واحد' : n === 2 ? 'درسان' : n <= 10 ? n + ' دروس' : n + ' درساً';
}

function lessonRows(lessons, best) {
  return `<div class="list">${lessons.map((l, i) => `
    <a class="row" href="#/lesson/${l.id}"><span class="num">${i + 1}</span><span class="grow">${esc(l.title)}</span>
    ${best[l.id] != null ? `<span class="badge b-green">${best[l.id]}%</span>` : ''}</a>`).join('')}</div>`;
}

async function pageField(id) {
  const fd = await q(sb.from('fields').select('*, subjects(id,name,levels(id,name))').eq('id', id).single());
  const lessons = (await q(sb.from('lessons').select('id,title,hidden,sort').eq('field_id', id).order('sort').order('created_at'))).filter(l => !l.hidden);
  let best = {};
  if (lessons.length && S.user) {
    const rs = await q(sb.from('results').select('lesson_id,score_pct').eq('user_id', S.user.id).in('lesson_id', lessons.map(l => l.id)));
    rs.forEach(r => { best[r.lesson_id] = Math.max(best[r.lesson_id] ?? 0, r.score_pct); });
  }
  const sj = fd.subjects;
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/level/${sj.levels.id}">${esc(sj.levels.name)}</a> › <a href="#/subject/${sj.id}">${esc(sj.name)}</a> › <a href="#/fields/${sj.id}">المجالات</a> › ${esc(fd.name)}</div>
    <h1>${fieldIcon} ${esc(fd.name)}</h1>
    ${lessons.length ? lessonRows(lessons, best) : '<div class="notice n-info">لا توجد دروس في هذا المجال بعد.</div>'}
    <a class="btn btn-line btn-block" style="margin-top:14px" href="#/fields/${sj.id}">الرجوع إلى المجالات</a>`;
}

/* ---------- رسومات هندسية مدمجة: سطر [[شكل: المفتاح | تعليق اختياري]] داخل الملخص ---------- */
const GEO = (() => {
  const W = 220, H = 150, f = n => Math.round(n * 10) / 10;
  const L = (x1, y1, x2, y2, o = '') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${o}/>`;
  const D = (x1, y1, x2, y2) => L(x1, y1, x2, y2, 'stroke-dasharray="5 4" stroke-width="1.4" opacity=".75"');
  const T = (x, y, s, o = '') => `<text x="${f(x)}" y="${f(y)}" ${/text-anchor/.test(o) ? '' : 'text-anchor="middle"'} ${/font-size/.test(o) ? '' : 'font-size="14"'} font-family="sans-serif" fill="currentColor" stroke="none" ${o}>${s}</text>`;
  const P = (x, y, s) => `<circle cx="${f(x)}" cy="${f(y)}" r="2.6" fill="currentColor" stroke="none"/>` + (s ? T(x, y - 8, s) : '');
  const poly = pts => `<polygon points="${pts.map(p => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="rgba(46,125,90,.12)"/>`;
  const R = (x, y, dx, dy) => `<path d="M${f(x + dx * 11)},${f(y)} L${f(x + dx * 11)},${f(y + dy * 11)} L${f(x)},${f(y + dy * 11)}" fill="none" stroke-width="1.4"/>`;
  const tick = (x1, y1, x2, y2) => { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2; return L(mx - 5 * Math.cos(a), my - 5 * Math.sin(a), mx + 5 * Math.cos(a), my + 5 * Math.sin(a), 'stroke-width="2"'); };
  const arrow = (x, y, a) => `<polygon points="${f(x)},${f(y)} ${f(x - 11 * Math.cos(a - .4))},${f(y - 11 * Math.sin(a - .4))} ${f(x - 11 * Math.cos(a + .4))},${f(y - 11 * Math.sin(a + .4))}" fill="currentColor" stroke="none"/>`;
  const angle = (deg, la, lb) => {
    const ox = deg === 180 ? 110 : deg > 90 ? 95 : 45, oy = 115, r = 90, a = deg * Math.PI / 180, ex = ox + r * Math.cos(a), ey = oy - r * Math.sin(a);
    const ax = deg === 180 ? 20 : 200, ay = oy, rr = 28, ar = deg === 180 ? '' :
      `<path d="M${f(ox + rr)},${oy} A${rr},${rr} 0 0 0 ${f(ox + rr * Math.cos(a))},${f(oy - rr * Math.sin(a))}" fill="none" stroke-width="1.6"/>`;
    const mark = deg === 90 ? R(ox, oy, 1, -1) : ar;
    return L(ox, oy, deg === 180 ? 20 : 200, oy) + L(ox, oy, deg === 180 ? 200 : ex, deg === 180 ? oy : ey) + mark +
      P(ox, oy) + T(ox, oy + 20, 'O') + T(deg === 180 ? 14 : 205, oy + 20, deg === 180 ? 'A' : 'B') + T(deg === 180 ? 206 : ex + (ex > 150 ? 12 : 0), deg === 180 ? oy + 20 : ey - 8, deg === 180 ? 'B' : 'A') +
      (deg === 180 ? '' : T(ox + 52, oy - 10, deg + '°', 'font-size="13"'));
  };
  const S = {
    line: () => L(8, 75, 212, 75) + arrow(8, 75, Math.PI) + arrow(212, 75, 0) + P(70, 75, 'A') + P(150, 75, 'B') + T(110, 110, '(AB)'),
    ray: () => L(40, 75, 205, 75) + arrow(205, 75, 0) + P(40, 75, 'A') + P(120, 75, 'B') + T(110, 110, '[AB)'),
    segment: () => L(40, 75, 180, 75) + P(40, 75, 'A') + P(180, 75, 'B') + T(110, 110, '[AB]'),
    midpoint: () => L(30, 75, 190, 75) + P(30, 75, 'A') + P(110, 75, 'M') + P(190, 75, 'B') + tick(30, 75, 110, 75) + tick(110, 75, 190, 75) + T(110, 110, 'AM = MB'),
    parallel: () => L(15, 50, 205, 50) + L(15, 100, 205, 100) + T(190, 40, '(m₁)') + T(190, 120, '(m₂)') + D(110, 50, 110, 100),
    cross: () => L(30, 110, 190, 40) + L(30, 40, 190, 110) + P(110, 75, '') + T(122, 70, 'O'),
    perp: () => L(15, 105, 205, 105) + L(90, 20, 90, 135) + R(90, 105, 1, -1) + T(110, 98, 'O') + T(200, 120, '(m₁)') + T(72, 32, '(m₂)'),
    angle_acute: () => angle(50), angle_right: () => angle(90), angle_obtuse: () => angle(130), angle_straight: () => angle(180),
    square: () => poly([[60, 20], [160, 20], [160, 120], [60, 120]]) + '<rect x="60" y="20" width="100" height="100" fill="none"/>' + D(60, 20, 160, 120) + D(160, 20, 60, 120) +
      R(60, 20, 1, 1) + R(160, 20, -1, 1) + R(160, 120, -1, -1) + R(60, 120, 1, -1) + T(48, 16, 'A') + T(172, 16, 'B') + T(172, 138, 'C') + T(48, 138, 'D') + T(110, 78, 'O', 'font-size="12"') + T(110, 14, 'a'),
    rectangle: () => poly([[30, 30], [190, 30], [190, 110], [30, 110]]) + D(30, 30, 190, 110) + D(190, 30, 30, 110) + R(30, 30, 1, 1) + R(190, 30, -1, 1) + R(190, 110, -1, -1) + R(30, 110, 1, -1) +
      T(110, 22, 'L') + T(206, 74, 'w') + T(18, 26, 'A') + T(202, 26, 'B') + T(202, 128, 'C') + T(18, 128, 'D'),
    triangle_scalene: () => poly([[30, 120], [190, 120], [80, 25]]) + T(24, 138, 'A') + T(196, 138, 'B') + T(80, 18, 'C'),
    triangle_isosceles: () => poly([[30, 120], [190, 120], [110, 25]]) + tick(30, 120, 110, 25) + tick(190, 120, 110, 25) + T(24, 138, 'B') + T(196, 138, 'C') + T(110, 18, 'A'),
    triangle_equilateral: () => poly([[50, 125], [170, 125], [110, 21]]) + tick(50, 125, 170, 125) + tick(50, 125, 110, 21) + tick(170, 125, 110, 21) + T(44, 142, 'B') + T(176, 142, 'C') + T(110, 14, 'A'),
    triangle_right: () => poly([[50, 125], [190, 125], [50, 25]]) + R(50, 125, 1, -1) + T(44, 142, 'A') + T(196, 142, 'B') + T(44, 18, 'C'),
    triangle_obtuse: () => poly([[30, 125], [190, 125], [70, 62]]) + T(24, 142, 'A') + T(196, 142, 'B') + T(70, 54, 'C') + T(92, 92, '>90°', 'font-size="12"'),
    triangle_h: () => poly([[30, 120], [190, 120], [80, 25]]) + D(80, 25, 80, 120) + R(80, 120, 1, -1) + T(24, 138, 'A') + T(196, 138, 'B') + T(80, 18, 'C') + T(110, 138, 'b (القاعدة)') + T(68, 76, 'h'),
    parallelogram: () => poly([[30, 115], [150, 115], [200, 35], [80, 35]]) + D(80, 35, 80, 115) + R(80, 115, 1, -1) + T(24, 132, 'A') + T(156, 132, 'B') + T(208, 32, 'C') + T(76, 28, 'D') + T(90, 78, 'h') + T(90, 132, 'b'),
    rhombus: () => poly([[30, 75], [110, 20], [190, 75], [110, 130]]) + D(30, 75, 190, 75) + D(110, 20, 110, 130) + R(110, 75, 1, -1) + tick(30, 75, 110, 20) + tick(110, 20, 190, 75) + tick(190, 75, 110, 130) + tick(110, 130, 30, 75) +
      T(20, 72, 'A') + T(110, 14, 'B') + T(202, 72, 'C') + T(110, 146, 'D') + T(124, 70, 'O', 'font-size="12"'),
    trapezoid: () => poly([[20, 120], [200, 120], [150, 35], [70, 35]]) + D(70, 35, 70, 120) + R(70, 120, 1, -1) + T(14, 136, 'A') + T(206, 136, 'B') + T(158, 28, 'C') + T(62, 28, 'D') + T(110, 28, 'b') + T(110, 138, 'B (القاعدة الكبرى)') + T(58, 82, 'h'),
    trapezoid_right: () => poly([[20, 120], [200, 120], [150, 35], [20, 35]]) + R(20, 120, 1, -1) + R(20, 35, 1, 1) + T(14, 136, 'A') + T(206, 136, 'B') + T(158, 28, 'C') + T(14, 28, 'D') + T(85, 28, 'b') + T(110, 138, 'B'),
    circle: () => '<circle cx="110" cy="75" r="55" fill="rgba(46,125,90,.12)"/>' + L(55, 75, 165, 75) + P(110, 75, '') + T(110, 92, 'O') + T(140, 68, 'r') + T(80, 68, 'r') + T(110, 11, 'd = 2 × r', 'font-size="12"'),
    cube: () => D(80, 20, 80, 100) + D(80, 100, 160, 100) + D(40, 135, 80, 100) + poly([[40, 55], [120, 55], [120, 135], [40, 135]]) + L(40, 55, 80, 20) + L(120, 55, 160, 20) + L(80, 20, 160, 20) + L(160, 20, 160, 100) + L(120, 135, 160, 100) + T(80, 150, 'a'),
    cuboid: () => D(80, 15, 80, 95) + D(80, 95, 190, 95) + D(30, 130, 80, 95) + poly([[30, 55], [140, 55], [140, 130], [30, 130]]) + L(30, 55, 80, 15) + L(140, 55, 190, 15) + L(80, 15, 190, 15) + L(190, 15, 190, 95) + L(140, 130, 190, 95) +
      T(85, 148, 'L') + T(176, 120, 'w') + T(18, 95, 'h'),
    cylinder: () => `<ellipse cx="110" cy="35" rx="55" ry="15" fill="rgba(46,125,90,.18)"/>` + L(55, 35, 55, 115) + L(165, 35, 165, 115) + `<path d="M55,115 A55,15 0 0 0 165,115" fill="none"/><path d="M55,115 A55,15 0 0 1 165,115" fill="none" stroke-dasharray="5 4" opacity=".75"/>` +
      D(110, 35, 165, 35) + D(110, 35, 110, 115) + T(140, 28, 'r') + T(122, 78, 'h', 'text-anchor="start"'),
    sphere: () => '<circle cx="110" cy="75" r="60" fill="rgba(46,125,90,.12)"/><ellipse cx="110" cy="75" rx="60" ry="16" fill="none" stroke-dasharray="5 4" opacity=".75"/>' + L(110, 75, 170, 75) + P(110, 75, '') + T(110, 95, 'O') + T(145, 68, 'r')
  };

  const MAP_PTS = [[-17.05,21.34],[-13.0,21.34],[-13.0,23.45],[-12.0,23.45],[-12.0,26.0],[-8.67,27.29],[-8.67,25.0],[-4.83,24.99],[-5.6,16.5],[-5.3,15.4],[-8.0,15.2],[-10.6,15.5],[-11.5,15.6],[-12.2,14.75],[-14.3,16.6],[-16.5,16.07],[-16.3,17.5],[-16.2,19.3],[-16.6,20.3],[-17.05,20.8]];
  const mx = lon => (lon + 17.5) * 15 + 6, my = lat => (27.8 - lat) * 15 + 6;
  const CITY = [['نواكشوط', -15.98, 18.09], ['نواذيبو', -17.03, 20.93], ['أطار', -13.05, 20.52], ['ازويرات', -12.48, 22.73], ['كيفة', -11.4, 16.62], ['النعمة', -7.26, 16.62], ['روصو', -15.8, 16.5], ['تجكجة', -11.43, 18.56]];
  const mapPoly = () => `<polygon points="${MAP_PTS.map(q => f(mx(q[0])) + ',' + f(my(q[1]))).join(' ')}" fill="rgba(46,125,90,.14)"/>`;
  const cities = list => CITY.filter(c => !list || list.includes(c[0])).map(c => P(mx(c[1]), my(c[2]), '').replace(/<text.*$/, '') + (c[1] < -15 ? T(mx(c[1]) + 6, my(c[2]) + 3, c[0], 'font-size="9.5" text-anchor="start"') : T(mx(c[1]), my(c[2]) - 6, c[0], 'font-size="9.5"'))).join('');
  const compass = (x, y) => L(x, y + 14, x, y - 14, 'stroke-width="1.6"') + L(x - 14, y, x + 14, y, 'stroke-width="1.6"') + arrow(x, y - 14, -Math.PI / 2) + T(x, y - 18, 'ش', 'font-size="11"') + T(x, y + 27, 'ج', 'font-size="11"') + T(x + 20, y + 4, 'ق', 'font-size="11"') + T(x - 20, y + 4, 'غ', 'font-size="11"');
  const SZ = { mauritania: [240, 215], mauritania_cities: [240, 215], map_scale: [240, 140], compass: [200, 200], numberline: [260, 90] };
  S.mauritania = () => mapPoly() + compass(210, 40) + T(120, 14, 'موريتانيا', 'font-size="12"');
  S.mauritania_cities = () => mapPoly() + cities() + compass(210, 40) + T(120, 14, 'موريتانيا (رسم تقريبي)', 'font-size="11"');
  S.map_scale = () => L(30, 50, 210, 50, 'stroke-width="2.5"') + P(30, 50, 'A') + P(210, 50, 'B') + T(120, 40, 'على الخريطة: 6 سم', 'font-size="12"') +
    L(30, 70, 30, 90) + L(210, 70, 210, 90) + L(30, 80, 210, 80, 'stroke-dasharray="4 3"') + T(120, 104, 'في الواقع: 600 كم', 'font-size="12"') + T(120, 126, 'السلم = (على الخريطة) ÷ (الحقيقية)', 'font-size="11"');
  S.compass = () => L(100, 30, 100, 170, 'stroke-width="2"') + L(30, 100, 170, 100, 'stroke-width="2"') + arrow(100, 30, -Math.PI / 2) + `<circle cx="100" cy="100" r="62" fill="none" stroke-width="1" opacity=".5"/>` + T(100, 20, 'الشمال (ش)') + T(100, 190, 'الجنوب (ج)') + T(172, 96, 'شرق', 'text-anchor="start"') + T(28, 96, 'غرب', 'text-anchor="end"');
  S.numberline = () => L(15, 45, 245, 45) + arrow(245, 45, 0) + [0, 1, 2, 3, 4].map(i => L(30 + i * 50, 38, 30 + i * 50, 52) + T(30 + i * 50, 70, String(i))).join('') + L(30, 45, 80, 45, 'stroke-width="4" opacity=".5"');
  return (key, cap) => {
    const g = S[key]; if (!g) return '';
    const [vw, vh] = SZ[key] || [W, H];
    return `<figure style="margin:12px 0;text-align:center"><svg viewBox="0 0 ${vw} ${vh}" width="100%" style="max-width:${vw > 230 ? 340 : 300}px;color:var(--green-d)" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" role="img" aria-label="${esc(cap || key)}" direction="ltr">${g()}</svg>${cap ? `<figcaption style="font-size:15px;color:#555">${esc(cap)}</figcaption>` : ''}</figure>`;
  };
})();

/* نص رياضي: الكسر {3/5} أو {أ+ب/ج}، والأس a^2 */
function rich(t) {
  return esc(t)
    .replace(/\{([^{}\/]+)\/([^{}\/]+)\}/g, (m, a, b) => `<span dir="ltr" style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 3px;font-size:.92em;line-height:1.25"><span style="border-bottom:1.5px solid currentColor;padding:0 4px">${a.trim()}</span><span style="padding:0 4px">${b.trim()}</span></span>`)
    .replace(/\^([0-9a-zA-Z]+)/g, '<sup>$1</sup>')
    /* أرقام لاتينية مفصولة بمسافات (12 000) تبقى بترتيبها الصحيح داخل النص العربي */
    .split(/(<[^>]+>)/).map(x => x.startsWith('<') ? x : x.replace(/\d+(?:[ \u00a0]\d{3})+(?:\.\d+)?/g, '<span dir="ltr">$&</span>')).join('');
}
/* نص سؤال: يسمح بسطر رسم [[شكل: key | تعليق]] في بدايته أو نهايته */
function richQ(t) {
  let figs = '';
  const rest = String(t || '').replace(/\[\[\s*(?:شكل|رسم|خريطة)\s*[:：]\s*([a-z_]+)\s*(?:\|\s*(.*?))?\s*\]\]/gi, (m, k, c) => { figs += GEO(k.toLowerCase(), c || ''); return ''; });
  return rich(rest.trim()) + figs;
}

function fmtSummary(t) {
  let out = '', inUl = false;
  for (const raw of String(t || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (/^[-•*]\s/.test(l)) { if (!inUl) { out += '<ul>'; inUl = true; } out += `<li>${rich(l.slice(2))}</li>`; continue; }
    if (inUl) { out += '</ul>'; inUl = false; }
    if (!l) continue;
    const gm = l.match(/^\[\[\s*(?:شكل|رسم|خريطة)\s*[:：]\s*([a-z_]+)\s*(?:\|\s*(.*?))?\s*\]\]$/i);
    if (gm) { out += GEO(gm[1].toLowerCase(), gm[2] || ''); continue; }
    out += l.startsWith('# ') ? `<h3>${rich(l.slice(2))}</h3>` : `<p>${rich(l)}</p>`;
  }
  return out + (inUl ? '</ul>' : '');
}

async function pageLesson(id) {
  const ls = await q(sb.from('lessons').select('*, subjects(id,name,level_id), fields(id,name)').eq('id', id).single());
  const backHref = ls.fields ? `#/field/${ls.fields.id}` : `#/fields/${ls.subjects.id}`;
  let img = '';
  if (ls.image_path) {
    try { img = `<img class="lesson-img" draggable="false" alt="" src="${await privateImage('lesson-images', ls.image_path)}">`; }
    catch (e) { console.warn(e); }
  }
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/level/${ls.subjects.level_id}">المواد</a> › <a href="#/subject/${ls.subjects.id}">${esc(ls.subjects.name)}</a>${ls.fields ? ` › <a href="${backHref}">${esc(ls.fields.name)}</a>` : ''}</div>
    <h1>${esc(ls.title)}</h1>
    ${img}
    <div class="summary">${fmtSummary(ls.summary)}</div>
    <a class="btn btn-block" style="margin-top:16px" href="#/quiz/${ls.id}">📝 اختبر نفسك</a>
    <a class="btn btn-line btn-block" style="margin-top:10px" href="${backHref}">الرجوع إلى الدروس</a>`;
}

/* ---------- اختبارات المادة ---------- */
async function pageExams(id) {
  const sj = await q(sb.from('subjects').select('*, levels(id,name)').eq('id', id).single());
  const exams = (await q(sb.from('exams').select('id,title,description,hidden,sort').eq('subject_id', id).order('sort').order('created_at'))).filter(e => !e.hidden);
  let best = {};
  if (exams.length && S.user) {
    const rs = await q(sb.from('exam_results').select('exam_id,score_pct').eq('user_id', S.user.id).in('exam_id', exams.map(e => e.id)));
    rs.forEach(r => { best[r.exam_id] = Math.max(best[r.exam_id] ?? 0, r.score_pct); });
  }
  $app.innerHTML = `
    <div class="crumbs"><a href="#/">الرئيسية</a> › <a href="#/level/${sj.levels.id}">${esc(sj.levels.name)}</a> › <a href="#/subject/${sj.id}">${esc(sj.name)}</a> › الاختبارات</div>
    <h1>📝 اختبارات ${esc(sj.name)}</h1>
    ${exams.length ? `<div class="list">${exams.map((e, i) => `
      <a class="row" href="#/exam/${e.id}"><span class="num">${i + 1}</span>
      <span class="grow">${esc(e.title)}${e.description ? `<br><small class="muted">${esc(e.description)}</small>` : ''}</span>
      ${best[e.id] != null ? `<span class="badge b-green">${best[e.id]}%</span>` : ''}</a>`).join('')}</div>`
      : '<div class="notice n-info">لا توجد اختبارات في هذه المادة بعد.</div>'}
    <a class="btn btn-line btn-block" style="margin-top:14px" href="#/subject/${sj.id}">الرجوع</a>`;
}

async function pageExam(id) {
  const ex = await q(sb.from('exams').select('id,title,subject_id').eq('id', id).single());
  return runQuiz({ id, title: ex.title, get: 'get_exam', submit: 'submit_exam', arg: 'p_exam',
    back: `#/exams/${ex.subject_id}`, backText: 'العودة للاختبارات', self: `#/exam/${id}`, head: 'اختبار: ', empty: 'لا توجد أسئلة في هذا الاختبار بعد.' });
}

/* ---------- الاختبار QCM ---------- */
const levelLabel = p => p >= 85 ? ['ممتاز', 's-great'] : p >= 70 ? ['جيد', 's-good'] : p >= 50 ? ['متوسط', 's-mid'] : ['ضعيف', 's-low'];

async function pageQuiz(id) {
  const ls = await q(sb.from('lessons').select('id,title').eq('id', id).single());
  return runQuiz({ id, title: ls.title, get: 'get_quiz', submit: 'submit_quiz', arg: 'p_lesson',
    back: `#/lesson/${id}`, backText: 'العودة للدرس', self: `#/quiz/${id}`, head: 'اختبار: ', empty: 'لا يوجد اختبار لهذا الدرس بعد.' });
}

async function runQuiz(c) {
  const id = c.id, ls = { title: c.title };
  const { data: qs, error } = await sb.rpc(c.get, { [c.arg]: id });
  if (error) throw error;
  if (!qs.length) {
    $app.innerHTML = `<h1>${esc(ls.title)}</h1><div class="notice n-info">${c.empty}</div>
      <a class="btn btn-light" href="${c.back}">${c.backText}</a>`;
    return;
  }
  const opts = o => (Array.isArray(o) ? o : []);
  $app.innerHTML = `
    <div class="crumbs"><a href="${c.back}">← ${c.backText}</a></div>
    <h1>${c.head}${esc(ls.title)}</h1>
    <form id="quiz">
      ${qs.map((x, i) => `
        <div class="q"><div class="qt">${i + 1}. ${richQ(x.question)}</div>
          ${opts(x.options).map((o, j) => `<label class="opt"><input type="radio" name="q${i}" value="${j}"><span>${rich(o)}</span></label>`).join('')}
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
    const { data, error } = await sb.rpc(c.submit, { [c.arg]: id, p_answers: answers });
    if (error) { toast('تعذّر التصحيح: ' + error.message); btn.disabled = false; return; }
    showResult(c, ls, qs, data, opts);
  });
}
function showResult(c, ls, qs, res, opts) {
  const [label, cls] = levelLabel(res.score_pct);
  const det = Object.fromEntries(res.details.map(d => [d.id, d]));
  window.scrollTo(0, 0);
  $app.innerHTML = `
    <h1>نتيجة: ${esc(ls.title)}</h1>
    <div class="score ${cls}"><div class="pct">${res.score_pct}%</div>
      <div style="font-size:22px;font-weight:800">المستوى: ${label}</div>
      <div>${res.correct} من ${res.total} إجابة صحيحة</div>
      <div class="bar"><i style="width:${res.score_pct}%"></i></div></div>
    <a class="btn btn-block" href="${c.self}" onclick="route()">إعادة الاختبار</a>
    <a class="btn btn-line btn-block" style="margin-top:10px" href="${c.back}">${c.backText}</a>
    <h2>مراجعة الإجابات</h2>
    ${qs.map((x, i) => {
      const d = det[x.id];
      return `<div class="q"><div class="qt">${i + 1}. ${richQ(x.question)}</div>
        ${opts(x.options).map((o, j) => {
          const c = j === d.correct_index ? 'ok' : (j === d.chosen ? 'no' : '');
          return `<div class="opt ${c}">${c === 'ok' ? '✔' : c === 'no' ? '✘' : '○'} <span>${rich(o)}</span></div>`;
        }).join('')}</div>`;
    }).join('')}`;
}

/* ---------- حسابي ---------- */
async function pageMe() {
  if (!S.user) { S.after = '#/me'; return go('#/login'); }
  const [subs, pays, rs0, xs] = await Promise.all([
    q(sb.from('subscriptions').select('*, levels(name)').eq('user_id', S.user.id).order('ends_at', { ascending: false })),
    q(sb.from('payments').select('*, levels(name)').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10)),
    q(sb.from('results').select('*, lessons(title)').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10)),
    q(sb.from('exam_results').select('*, exams(title)').eq('user_id', S.user.id).order('created_at', { ascending: false }).limit(10))
  ]);
  const rs = [...rs0.map(r => ({ ...r, title: r.lessons?.title || 'درس' })), ...xs.map(r => ({ ...r, title: 'اختبار: ' + (r.exams?.title || '') }))]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
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
    ${rs.length ? `<div class="list">${rs.map(r => `<div class="row"><span class="grow">${esc(r.title)}<br><small class="muted">${fmtDate(r.created_at)}</small></span>
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

/* ---------- إصلاح عرض الأرقام: 10 000 كانت تظهر 000 10 في النص العربي ----------
   كل رقمين فأكثر تفصل بينهما مسافة يُلفّان في عنصر من اليسار إلى اليمين، في كل أنحاء التطبيق */
(function fixNumbers() {
  const RX = /\d+(?:[ \u00a0]\d+)+(?:\.\d+)?/g, SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|SVG|CODE)$/;
  const walk = root => {
    if (!root) return;
    if (root.nodeType === 3) return wrap(root);
    if (root.nodeType !== 1 || SKIP.test(root.nodeName.toUpperCase())) return;
    if (root.closest && root.closest('[dir=ltr]')) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
    for (let n; (n = w.nextNode());) list.push(n);
    list.forEach(wrap);
  };
  const wrap = t => {
    const p = t.parentNode; if (!p || SKIP.test(p.nodeName.toUpperCase()) || (p.closest && p.closest('[dir=ltr]'))) return;
    const s = t.data; RX.lastIndex = 0; if (!RX.test(s)) return; RX.lastIndex = 0;
    const f = document.createDocumentFragment(); let i = 0, m;
    while ((m = RX.exec(s))) {
      if (m.index > i) f.appendChild(document.createTextNode(s.slice(i, m.index)));
      const sp = document.createElement('span'); sp.dir = 'ltr'; sp.style.unicodeBidi = 'isolate'; sp.textContent = m[0]; f.appendChild(sp); i = m.index + m[0].length;
    }
    if (i < s.length) f.appendChild(document.createTextNode(s.slice(i)));
    p.replaceChild(f, t);
  };
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(walk))).observe(document.body, { childList: true, subtree: true });
  walk(document.body);
})();

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
