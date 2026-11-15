'use strict';
/* =====================================================================
   ملخصاتي — لوحة المدير
   تعتمد على الأدوات المعرّفة في app.js (sb, q, esc, toast ...)
   ===================================================================== */

const ADM = { stage: null, level: null, subject: null, field: null, exam: null, lesson: null };
let payFilter = 'pending';
const admCache = {};

async function pageAdmin(tab = 'payments') {
  if (!isAdmin()) { $app.innerHTML = '<div class="notice n-bad">هذه الصفحة للمدير فقط.</div>'; return; }
  const tabs = [['payments', '💳 طلبات الدفع'], ['subs', '👥 المشتركون'], ['content', '📚 المحتوى والأسعار'], ['settings', '⚙️ الإعدادات'], ['stats', '📊 الإحصاءات']];
  $app.innerHTML = `<h1>لوحة المدير</h1>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="adm"></div>`;
  const fn = { payments: admPayments, subs: admSubs, content: admContent, settings: admSettings, stats: admStats }[tab] || admPayments;
  await fn($('#adm'));
}
window.pageAdmin = pageAdmin;

/* =============== طلبات الدفع =============== */
async function admPayments(box) {
  const rows = await q(sb.from('payments')
    .select('*, profiles(full_name,phone,email), levels(name)')
    .eq('status', payFilter).order('created_at', { ascending: false }).limit(100));
  const urls = {};
  if (rows.length) {
    const { data } = await sb.storage.from('receipts').createSignedUrls(rows.map(r => r.receipt_path), 900);
    (data || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
  }
  const filt = [['pending', 'قيد المراجعة'], ['approved', 'المقبولة'], ['rejected', 'المرفوضة']];
  box.innerHTML = `
    <div class="tabs">${filt.map(([k, l]) => `<a href="#" data-f="${k}" class="${k === payFilter ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${rows.length ? `<div class="list">${rows.map(r => `
      <div class="row" style="align-items:flex-start">
        ${urls[r.receipt_path] ? `<img class="receipt" data-big="${esc(urls[r.receipt_path])}" src="${esc(urls[r.receipt_path])}" alt="إيصال">` : '<div class="receipt"></div>'}
        <div class="grow">
          <b>${esc(r.profiles?.full_name || '—')}</b> <span class="muted small">${esc(r.profiles?.phone || '')}</span><br>
          <span class="small muted">${esc(r.profiles?.email || '')}</span><br>
          ${esc(r.levels?.name || '')} — ${esc(r.plan_name)} <b>(${money(r.amount)})</b><br>
          <span class="small muted">${fmtDate(r.created_at)}</span>
          ${r.reject_reason ? `<br><span class="small" style="color:var(--red)">سبب الرفض: ${esc(r.reject_reason)}</span>` : ''}
        </div>
        ${r.status === 'pending' ? `<div class="actions" style="flex-direction:column">
            <button class="btn-sm" data-ok="${r.id}">✔ موافقة</button>
            <button class="btn-sm btn-red" data-no="${r.id}">✘ رفض</button></div>`
          : `<span class="badge ${r.status === 'approved' ? 'b-green' : 'b-red'}">${r.status === 'approved' ? 'مقبول' : 'مرفوض'}</span>`}
      </div>`).join('')}</div>` : '<div class="notice n-info">لا توجد طلبات في هذه القائمة.</div>'}`;

  box.onclick = async e => {
    const f = e.target.closest('[data-f]');
    if (f) { e.preventDefault(); payFilter = f.dataset.f; return admPayments(box); }
    const big = e.target.closest('[data-big]');
    if (big) { openModal(`<img class="big" src="${esc(big.dataset.big)}" alt=""><button class="btn-light btn-block" style="margin-top:10px" onclick="closeModal()">إغلاق</button>`, true); return; }
    const ok = e.target.closest('[data-ok]');
    if (ok) {
      if (!confirm('تأكيد الموافقة وتفعيل الاشتراك؟')) return;
      const { error } = await sb.rpc('approve_payment', { p_payment: ok.dataset.ok });
      if (error) return toast('خطأ: ' + error.message);
      toast('تم تفعيل الاشتراك ✔'); return admPayments(box);
    }
    const no = e.target.closest('[data-no]');
    if (no) {
      const reason = prompt('سبب الرفض (اختياري):', '');
      if (reason === null) return;
      const { error } = await sb.from('payments').update({ status: 'rejected', reject_reason: reason.trim() || null, reviewed_at: new Date().toISOString() }).eq('id', no.dataset.no);
      if (error) return toast('خطأ: ' + error.message);
      toast('تم الرفض'); return admPayments(box);
    }
  };
}

/* =============== المشتركون =============== */
async function admSubs(box) {
  const rows = await q(sb.from('subscriptions')
    .select('*, profiles(full_name,phone,email), levels(name)')
    .order('ends_at', { ascending: false }).limit(300));
  const now = Date.now();
  const draw = term => {
    const t = term.trim().toLowerCase();
    const list = rows.filter(r => !t || [r.profiles?.full_name, r.profiles?.phone, r.profiles?.email].join(' ').toLowerCase().includes(t));
    $('#sublist').innerHTML = list.length ? list.map(r => {
      const on = new Date(r.ends_at).getTime() > now;
      return `<div class="row"><div class="grow"><b>${esc(r.profiles?.full_name || '—')}</b> <span class="muted small">${esc(r.profiles?.phone || '')}</span><br>
        <span class="small">${esc(r.levels?.name)} · ينتهي ${fmtDate(r.ends_at)}</span></div>
        <span class="badge ${on ? 'b-green' : 'b-gray'}">${on ? 'ساري' : 'منتهٍ'}</span>
        <div class="actions"><button class="btn-sm btn-light" data-ext="${r.id}">تمديد</button>
        ${on ? `<button class="btn-sm btn-red" data-end="${r.id}">إنهاء</button>` : ''}</div></div>`;
    }).join('') : '<div class="notice n-info">لا توجد نتائج.</div>';
  };
  box.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input type="text" id="sq" placeholder="ابحث بالاسم أو الهاتف أو البريد" style="flex:1">
      <button id="addsub">+ اشتراك يدوي</button></div>
    <div class="list" id="sublist"></div>`;
  draw('');
  $('#sq').oninput = e => draw(e.target.value);
  $('#addsub').onclick = () => manualSub(box);
  box.onclick = async e => {
    const ext = e.target.closest('[data-ext]');
    if (ext) {
      const d = parseInt(prompt('عدد أيام التمديد:', '30'), 10);
      if (!d || d < 1) return;
      const r = rows.find(x => x.id === ext.dataset.ext);
      const base = Math.max(Date.now(), new Date(r.ends_at).getTime());
      const { error } = await sb.from('subscriptions').update({ ends_at: new Date(base + d * 864e5).toISOString() }).eq('id', r.id);
      if (error) return toast('خطأ: ' + error.message);
      toast('تم التمديد'); return admSubs(box);
    }
    const end = e.target.closest('[data-end]');
    if (end) {
      if (!confirm('إنهاء هذا الاشتراك الآن؟')) return;
      const { error } = await sb.from('subscriptions').update({ ends_at: new Date().toISOString() }).eq('id', end.dataset.end);
      if (error) return toast('خطأ: ' + error.message);
      toast('تم الإنهاء'); return admSubs(box);
    }
  };
}
async function manualSub(box) {
  const levels = await q(sb.from('levels').select('id,name,stages(name)').order('name'));
  const m = openModal(`<h2 style="margin-top:0">إضافة اشتراك يدوي</h2>
    <label>ابحث عن المستخدم</label>
    <div style="display:flex;gap:8px"><input type="text" id="ms" placeholder="اسم أو هاتف أو بريد"><button id="msb" type="button">بحث</button></div>
    <div id="mres" class="list" style="margin:10px 0"></div>
    <label>المستوى</label><select id="ml">${levels.map(l => `<option value="${l.id}">${esc(l.stages?.name)} — ${esc(l.name)}</option>`).join('')}</select>
    <label>المدة (بالأيام)</label><input type="number" id="md" value="30" min="1">
    <button class="btn-block" id="msave" style="margin-top:14px">حفظ</button>`);
  $('#msb', m).onclick = async () => {
    const t = $('#ms', m).value.trim().replace(/[,()%]/g, '');
    if (!t) return;
    const ps = await q(sb.from('profiles').select('id,full_name,phone,email').or(`full_name.ilike.%${t}%,phone.ilike.%${t}%,email.ilike.%${t}%`).limit(8));
    $('#mres', m).innerHTML = ps.length ? ps.map(p => `<label class="plan"><input type="radio" name="mu" value="${p.id}">
      <span><b>${esc(p.full_name)}</b><br><small class="muted">${esc(p.phone)} · ${esc(p.email)}</small></span></label>`).join('') : '<div class="muted">لا نتائج</div>';
  };
  $('#msave', m).onclick = async () => {
    const uid = $('input[name=mu]:checked', m)?.value;
    const days = parseInt($('#md', m).value, 10);
    if (!uid) return toast('اختر المستخدم');
    if (!days || days < 1) return toast('أدخل عدد الأيام');
    const { error } = await sb.from('subscriptions').insert({ user_id: uid, level_id: $('#ml', m).value, ends_at: new Date(Date.now() + days * 864e5).toISOString() });
    if (error) return toast('خطأ: ' + error.message);
    closeModal(); toast('تمت إضافة الاشتراك'); admSubs(box);
  };
}

/* =============== المحتوى والأسعار =============== */
const ENT = {
  stages: { table: 'stages', single: 'مرحلة', parent: null, label: r => r.name,
    fields: [{ k: 'name', l: 'اسم المرحلة', t: 'text' }, { k: 'sort', l: 'الترتيب', t: 'number' }] },
  levels: { table: 'levels', single: 'مستوى', parent: 'stage_id', label: r => r.name,
    fields: [{ k: 'name', l: 'اسم المستوى', t: 'text' }, { k: 'sort', l: 'الترتيب', t: 'number' }] },
  subjects: { table: 'subjects', single: 'مادة', parent: 'level_id', label: r => r.name,
    fields: [{ k: 'name', l: 'اسم المادة', t: 'text' }, { k: 'sort', l: 'الترتيب', t: 'number' }] },
  plans: { table: 'plans', single: 'اشتراك', parent: 'level_id', label: r => `${r.name} — ${money(r.price)} / ${durLabel(r.duration_days)}`,
    fields: [{ k: 'name', l: 'اسم الاشتراك (مثال: اشتراك شهري)', t: 'text' }, { k: 'price', l: 'السعر', t: 'number' }, { k: 'duration_days', l: 'المدة بالأيام (30 = شهر، 270 = سنة دراسية)', t: 'number' }] },
  fields: { table: 'fields', single: 'مجال', parent: 'subject_id', label: r => r.name,
    fields: [{ k: 'name', l: 'اسم المجال (مثال: القرآن الكريم وتفسيره)', t: 'text' }, { k: 'sort', l: 'الترتيب', t: 'number' }] },
  exams: { table: 'exams', single: 'اختبار', parent: 'subject_id', label: r => r.title,
    fields: [{ k: 'title', l: 'عنوان الاختبار (مثال: اختبار الفصل الأول)', t: 'text' }, { k: 'description', l: 'وصف قصير (اختياري)', t: 'text', opt: true }, { k: 'sort', l: 'الترتيب', t: 'number' }] },
  lessons: { table: 'lessons', single: 'درس', parent: 'field_id', label: r => r.title,
    fields: [{ k: 'title', l: 'عنوان الدرس', t: 'text' }, { k: 'sort', l: 'الترتيب', t: 'number' }] }
};
const parentId = key => ({ levels: ADM.stage, subjects: ADM.level, plans: ADM.level, fields: ADM.subject, exams: ADM.subject, lessons: ADM.field }[key] || {}).id;

function entSection(key, title, rows, canOpen) {
  admCache[key] = Object.fromEntries(rows.map(r => [r.id, r]));
  return `<div style="display:flex;justify-content:space-between;align-items:center"><h2>${title}</h2>
      <button class="btn-sm" data-act="add" data-ent="${key}">+ إضافة ${ENT[key].single}</button></div>
    ${rows.length ? `<div class="list">${rows.map(r => `<div class="row">
      <div class="grow">${esc(ENT[key].label(r))} ${r.hidden ? '<span class="badge b-gray">مخفي</span>' : ''}</div>
      <div class="actions">
        ${canOpen ? `<button class="btn-sm" data-act="open" data-ent="${key}" data-id="${r.id}">فتح</button>` : ''}
        <button class="btn-sm btn-light" data-act="edit" data-ent="${key}" data-id="${r.id}">تعديل</button>
        <button class="btn-sm btn-line" data-act="hide" data-ent="${key}" data-id="${r.id}">${r.hidden ? 'إظهار' : 'سحب'}</button>
        <button class="btn-sm btn-red" data-act="del" data-ent="${key}" data-id="${r.id}">حذف</button>
      </div></div>`).join('')}</div>` : '<div class="muted">لا يوجد شيء بعد.</div>'}`;
}

async function admContent(box) {
  const A = ADM;
  const crumbs = ['<a href="#" data-act="nav" data-to="0">المراحل</a>'];
  if (A.stage) crumbs.push(`<a href="#" data-act="nav" data-to="1">${esc(A.stage.name)}</a>`);
  if (A.level) crumbs.push(`<a href="#" data-act="nav" data-to="2">${esc(A.level.name)}</a>`);
  if (A.subject) crumbs.push(`<a href="#" data-act="nav" data-to="3">${esc(A.subject.name)}</a>`);
  if (A.field) crumbs.push(`<a href="#" data-act="nav" data-to="4">${esc(A.field.name)}</a>`);
  if (A.exam) crumbs.push(`<a href="#" data-act="nav" data-to="4">${esc(A.exam.name)}</a>`);
  if (A.lesson) crumbs.push(esc(A.lesson.name));
  let html = `<div class="crumbs">${crumbs.join(' › ')}</div>`;

  box.onclick = e => admContentClick(e, box);

  if (A.lesson) { box.innerHTML = html; return lessonEditor(box, A.lesson.id, html); }
  if (A.exam) { box.innerHTML = html; return examEditor(box, A.exam.id, html); }

  const get = (t, col, id) => q(sb.from(t).select('*').eq(col, id).order(t === 'plans' ? 'price' : 'sort').order((t === 'lessons' || t === 'exams') ? 'created_at' : 'id'));
  if (!A.stage) html += entSection('stages', 'المراحل الدراسية', await q(sb.from('stages').select('*').order('sort').order('name')), true);
  else if (!A.level) html += entSection('levels', `مستويات «${esc(A.stage.name)}»`, await get('levels', 'stage_id', A.stage.id), true);
  else if (!A.subject) {
    const [subs, plans] = await Promise.all([get('subjects', 'level_id', A.level.id), get('plans', 'level_id', A.level.id)]);
    html += entSection('subjects', `مواد «${esc(A.level.name)}»`, subs, true);
    html += entSection('plans', 'أسعار الاشتراك لهذا المستوى', plans, false);
  } else if (!A.field) {
    const [fds, exs] = await Promise.all([get('fields', 'subject_id', A.subject.id), get('exams', 'subject_id', A.subject.id)]);
    html += entSection('fields', `مجالات «${esc(A.subject.name)}»`, fds, true);
    html += entSection('exams', `اختبارات «${esc(A.subject.name)}»`, exs, true);
  }
  else html += entSection('lessons', `دروس «${esc(A.field.name)}»`, await get('lessons', 'field_id', A.field.id), true);
  box.innerHTML = html;
}

async function admContentClick(e, box) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  e.preventDefault();
  const { act, ent, id } = b.dataset;
  if (act === 'nav') {
    const to = +b.dataset.to;
    if (to <= 0) ADM.stage = null;
    if (to <= 1) ADM.level = null;
    if (to <= 2) ADM.subject = null;
    if (to <= 3) ADM.field = null;
    ADM.exam = null;
    ADM.lesson = null;
    return admContent(box);
  }
  const row = id ? admCache[ent][id] : null;
  if (act === 'open') {
    const name = ENT[ent].label(row);
    if (ent === 'stages') ADM.stage = { id, name };
    if (ent === 'levels') ADM.level = { id, name };
    if (ent === 'subjects') ADM.subject = { id, name };
    if (ent === 'fields') ADM.field = { id, name };
    if (ent === 'exams') ADM.exam = { id, name };
    if (ent === 'lessons') ADM.lesson = { id, name };
    return admContent(box);
  }
  if (act === 'add' || act === 'edit') return entityForm(ent, row, box);
  if (act === 'hide') {
    const { error } = await sb.from(ENT[ent].table).update({ hidden: !row.hidden }).eq('id', id);
    if (error) return toast('خطأ: ' + error.message);
    return admContent(box);
  }
  if (act === 'del') {
    if (!confirm(`حذف «${ENT[ent].label(row)}» نهائياً مع كل ما بداخله؟ (للإخفاء المؤقت استخدم «سحب»)`)) return;
    if (ent === 'lessons' && row.image_path) await sb.storage.from('lesson-images').remove([row.image_path]);
    if (ent === 'fields') {
      const ls = await q(sb.from('lessons').select('image_path').eq('field_id', id));
      const paths = ls.map(l => l.image_path).filter(Boolean);
      if (paths.length) await sb.storage.from('lesson-images').remove(paths);
    }
    if (ent === 'subjects') {
      const ls = await q(sb.from('lessons').select('image_path').eq('subject_id', id));
      const paths = ls.map(l => l.image_path).filter(Boolean);
      if (paths.length) await sb.storage.from('lesson-images').remove(paths);
    }
    const { error } = await sb.from(ENT[ent].table).delete().eq('id', id);
    if (error) return toast('خطأ: ' + error.message);
    toast('تم الحذف'); return admContent(box);
  }
}

function entityForm(key, row, box) {
  const E = ENT[key];
  const count = Object.keys(admCache[key] || {}).length;
  const defs = { sort: count + 1, price: 0, duration_days: 30 };
  const m = openModal(`<h2 style="margin-top:0">${row ? 'تعديل' : 'إضافة'} ${E.single}</h2>
    <form id="ef">${E.fields.map(f => `<label>${f.l}</label>
      <input type="${f.t}" id="f_${f.k}" ${f.t === 'number' ? 'step="any"' : ''} value="${esc(row ? row[f.k] : (defs[f.k] ?? ''))}" ${f.opt ? '' : 'required'}>`).join('')}
    <button class="btn-block" style="margin-top:14px">حفظ</button></form>`);
  $('#ef', m).onsubmit = async ev => {
    ev.preventDefault();
    const vals = {};
    for (const f of E.fields) {
      const v = $('#f_' + f.k, m).value.trim();
      vals[f.k] = f.t === 'number' ? Number(v) : v;
    }
    if (key === 'plans' && (!(vals.duration_days >= 1) || !(vals.price >= 0))) return toast('تحقق من السعر والمدة');
    let res;
    if (row) res = await sb.from(E.table).update(vals).eq('id', row.id);
    else res = await sb.from(E.table).insert(E.parent
      ? { ...vals, [E.parent]: parentId(key), ...(key === 'lessons' ? { subject_id: ADM.subject.id } : {}) } : vals).select().single();
    if (res.error) return toast('خطأ: ' + res.error.message);
    closeModal(); toast('تم الحفظ ✔');
    if (!row && key === 'lessons') ADM.lesson = { id: res.data.id, name: res.data.title };
    if (!row && key === 'exams') ADM.exam = { id: res.data.id, name: res.data.title };
    admContent(box);
  };
}


/* ---------- محرر أسئلة QCM المشترك (الدروس والاختبارات) ---------- */
function mountQcm(box, questions) {
  const ql = $('#qlist', box);
  const renderQs = () => {
    ql.innerHTML = questions.length ? questions.map((x, i) => `<div class="qedit" data-i="${i}">
      <label style="margin-top:0">السؤال ${i + 1}</label>
      <input type="text" data-f="question" value="${esc(x.question)}" placeholder="نص السؤال">
      ${x.options.map((o, j) => `<div class="oprow">
        <input type="radio" name="c${i}" data-f="correct" data-j="${j}" ${x.correct === j ? 'checked' : ''}>
        <input type="text" data-f="opt" data-j="${j}" value="${esc(o)}" placeholder="الخيار ${j + 1}">
        <button type="button" class="btn-sm btn-red" data-rmopt="${j}">×</button></div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn-sm btn-light" data-addopt>+ خيار</button>
        <button type="button" class="btn-sm btn-red" data-rmq>حذف السؤال</button></div></div>`).join('')
      : '<div class="notice n-info">لا توجد أسئلة بعد. اضغط «+ سؤال».</div>';
  };
  renderQs();
  const blank = () => ({ question: '', options: ['', '', '', ''], correct: 0 });
  $('#addq', box).onclick = () => { questions.push(blank()); renderQs(); };
  ql.addEventListener('input', e => {
    const card = e.target.closest('.qedit'); if (!card) return;
    const x = questions[+card.dataset.i], f = e.target.dataset.f;
    if (f === 'question') x.question = e.target.value;
    if (f === 'opt') x.options[+e.target.dataset.j] = e.target.value;
    if (f === 'correct') x.correct = +e.target.dataset.j;
  });
  ql.addEventListener('click', e => {
    const card = e.target.closest('.qedit'); if (!card) return;
    const i = +card.dataset.i, x = questions[i];
    if (e.target.closest('[data-rmq]')) { questions.splice(i, 1); renderQs(); }
    else if (e.target.closest('[data-addopt]')) { x.options.push(''); renderQs(); }
    else if (e.target.closest('[data-rmopt]')) {
      const j = +e.target.closest('[data-rmopt]').dataset.rmopt;
      if (x.options.length <= 2) return toast('يلزم خياران على الأقل');
      x.options.splice(j, 1);
      if (x.correct === j) x.correct = 0; else if (x.correct > j) x.correct--;
      renderQs();
    }
  });
  return { render: renderQs };
}

// تنظيف الأسئلة وإعادة حساب موضع الإجابة الصحيحة؛ يرجع null مع رسالة عند وجود خطأ
function cleanQs(questions, parentKey, parentVal) {
  const clean = [];
  for (let i = 0; i < questions.length; i++) {
    const x = questions[i];
    if (!x.question.trim() && x.options.every(o => !o.trim())) continue;   // سؤال فارغ تماماً
    if (!x.question.trim()) { toast(`السؤال ${i + 1}: اكتب نص السؤال`); return null; }
    const opts = []; let corr = -1;
    x.options.forEach((o, j) => { if (o.trim()) { if (j === x.correct) corr = opts.length; opts.push(o.trim()); } });
    if (opts.length < 2) { toast(`السؤال ${i + 1}: يلزم خياران على الأقل`); return null; }
    if (corr < 0) { toast(`السؤال ${i + 1}: حدّد إجابة صحيحة غير فارغة`); return null; }
    clean.push({ [parentKey]: parentVal, question: x.question.trim(), options: opts, correct_index: corr, sort: clean.length + 1 });
  }
  return clean;
}

/* ---------- محرر الاختبار + أسئلة QCM + استيراد من الدروس ---------- */
async function examEditor(box, examId, crumbHtml) {
  const [ex, qs] = await Promise.all([
    q(sb.from('exams').select('*').eq('id', examId).single()),
    q(sb.from('exam_questions').select('*').eq('exam_id', examId).order('sort').order('id'))
  ]);
  const questions = qs.map(x => ({ question: x.question, options: [...(x.options || [])], correct: x.correct_index }));
  box.innerHTML = `${crumbHtml}
    <h2 style="margin-top:6px">تحرير الاختبار</h2>
    <div class="card" style="text-align:start">
      <label>عنوان الاختبار</label><input type="text" id="x_title" value="${esc(ex.title)}">
      <label>وصف قصير (اختياري)</label><input type="text" id="x_desc" value="${esc(ex.description)}">
      <label>الترتيب</label><input type="number" id="x_sort" value="${ex.sort}">
      <label><input type="checkbox" id="x_hid" ${ex.hidden ? 'checked' : ''}> مخفي عن المشتركين (سحب الاختبار)</label>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>أسئلة الاختبار (QCM)</h2>
      <span><button class="btn-sm btn-light" type="button" id="impq">📥 من الدروس</button>
      <button class="btn-sm" type="button" id="addq">+ سؤال</button></span></div>
    <div class="small muted">اختر الدائرة بجانب الإجابة الصحيحة. «من الدروس» ينسخ أسئلة دروس هذه المادة إلى الاختبار (نسخة مستقلة، لا يتأثر الدرس).</div>
    <div id="qlist"></div>
    <button class="btn-block" id="savex" style="margin-top:14px">💾 حفظ الاختبار والأسئلة</button>
    <button class="btn-line btn-block" id="backx" style="margin-top:10px">رجوع</button>`;
  const qcm = mountQcm(box, questions);
  $('#backx', box).onclick = () => { ADM.exam = null; admContent(box); };

  $('#impq', box).onclick = async () => {
    const lessons = await q(sb.from('lessons').select('id,title,sort,fields(name)').eq('subject_id', ex.subject_id).order('sort').order('created_at'));
    if (!lessons.length) return toast('لا توجد دروس في هذه المادة');
    const qrows = await q(sb.from('questions').select('*').in('lesson_id', lessons.map(l => l.id)).order('sort').order('id'));
    const by = {}; qrows.forEach(r => (by[r.lesson_id] ||= []).push(r));
    const withQ = lessons.filter(l => by[l.id]);
    if (!withQ.length) return toast('لا توجد أسئلة في دروس هذه المادة بعد');
    const m = openModal(`<h2 style="margin-top:0">استيراد أسئلة من الدروس</h2>
      <div class="small muted">علّم الأسئلة المطلوبة ثم اضغط «إضافة». (نسخ مستقل)</div>
      <div id="imp" style="max-height:55vh;overflow:auto;text-align:start">${withQ.map(l => `
        <div class="card" style="margin:8px 0;padding:10px">
          <label style="margin:0"><input type="checkbox" data-all="${l.id}"> <b>${esc(l.title)}</b> <span class="muted small">${l.fields ? '· ' + esc(l.fields.name) : ''}</span></label>
          ${by[l.id].map(r => `<label style="display:block;margin:6px 0 0 0;font-weight:400"><input type="checkbox" data-q="${r.id}" data-l="${l.id}"> ${esc(r.question)}</label>`).join('')}
        </div>`).join('')}</div>
      <button class="btn-block" id="impgo" style="margin-top:12px">إضافة المحدد</button>`);
    m.addEventListener('change', e => {
      const a = e.target.dataset.all;
      if (a) m.querySelectorAll(`[data-l="${a}"]`).forEach(c => { c.checked = e.target.checked; });
    });
    $('#impgo', m).onclick = () => {
      const ids = new Set([...m.querySelectorAll('[data-q]:checked')].map(c => c.dataset.q));
      if (!ids.size) return toast('لم تحدد أي سؤال');
      qrows.filter(r => ids.has(r.id)).forEach(r => questions.push({ question: r.question, options: [...(r.options || [])], correct: r.correct_index }));
      closeModal(); qcm.render(); toast(`أُضيف ${ids.size} سؤال — لا تنس الحفظ`);
    };
  };

  $('#savex', box).onclick = async ev => {
    const btn = ev.currentTarget;
    const title = $('#x_title', box).value.trim();
    if (!title) return toast('اكتب عنوان الاختبار');
    const clean = cleanQs(questions, 'exam_id', examId);
    if (!clean) return;
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    try {
      const u = await sb.from('exams').update({
        title, description: $('#x_desc', box).value.trim(), sort: Number($('#x_sort', box).value) || 0,
        hidden: $('#x_hid', box).checked
      }).eq('id', examId);
      if (u.error) throw u.error;
      const d = await sb.from('exam_questions').delete().eq('exam_id', examId);
      if (d.error) throw d.error;
      if (clean.length) { const i = await sb.from('exam_questions').insert(clean); if (i.error) throw i.error; }
      ADM.exam.name = title;
      toast('تم حفظ الاختبار ✔');
      admContent(box);
    } catch (err) {
      toast('تعذّر الحفظ: ' + (err.message || err));
      btn.disabled = false; btn.textContent = '💾 حفظ الاختبار والأسئلة';
    }
  };
}

/* ---------- محرر الدرس + أسئلة QCM ---------- */
async function lessonEditor(box, lessonId, crumbHtml) {
  const [ls, qs] = await Promise.all([
    q(sb.from('lessons').select('*').eq('id', lessonId).single()),
    q(sb.from('questions').select('*').eq('lesson_id', lessonId).order('sort').order('id'))
  ]);
  const sameSubjectFields = await q(sb.from('fields').select('id,name').eq('subject_id', ls.subject_id).order('sort').order('name'));
  let questions = qs.map(x => ({ question: x.question, options: [...(x.options || [])], correct: x.correct_index }));
  let imgUrl = '';
  if (ls.image_path) { try { imgUrl = await privateImage('lesson-images', ls.image_path, 600); } catch (e) { /* ignore */ } }

  box.innerHTML = `${crumbHtml}
    <h2 style="margin-top:6px">تحرير الدرس</h2>
    <div class="card" style="text-align:start">
      <label>عنوان الدرس</label><input type="text" id="l_title" value="${esc(ls.title)}">
      <label>الملخص</label>
      <textarea id="l_sum" style="min-height:220px">${esc(ls.summary)}</textarea>
      <div class="small muted">للتنسيق: سطر يبدأ بـ «# » عنوان فرعي، وسطر يبدأ بـ «- » نقطة في قائمة، وبقية الأسطر فقرات.</div>
      <label>المجال</label>
      <select id="l_field">${sameSubjectFields.map(f => `<option value="${f.id}" ${f.id === ls.field_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
      <label>الترتيب</label><input type="number" id="l_sort" value="${ls.sort}">
      <label><input type="checkbox" id="l_hid" ${ls.hidden ? 'checked' : ''}> مخفي عن المشتركين (سحب الدرس)</label>
      <label>الصورة التعبيرية</label>
      ${imgUrl ? `<img class="lesson-img" id="l_prev" src="${esc(imgUrl)}" alt="" style="max-height:220px">
        <label><input type="checkbox" id="l_rmimg"> حذف الصورة الحالية</label>` : '<div class="muted small">لا توجد صورة.</div>'}
      <input type="file" id="l_img" accept="image/*">
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center"><h2>أسئلة الاختبار (QCM)</h2>
      <button class="btn-sm" type="button" id="addq">+ سؤال</button></div>
    <div class="small muted">اختر الدائرة بجانب الإجابة الصحيحة.</div>
    <div id="qlist"></div>
    <button class="btn-block" id="savel" style="margin-top:14px">💾 حفظ الدرس والأسئلة</button>
    <button class="btn-line btn-block" id="backl" style="margin-top:10px">رجوع إلى قائمة الدروس</button>`;

  const qcm = mountQcm(box, questions);
  $('#backl', box).onclick = () => { ADM.lesson = null; admContent(box); };

  $('#savel', box).onclick = async ev => {
    const btn = ev.currentTarget;
    const title = $('#l_title', box).value.trim();
    if (!title) return toast('اكتب عنوان الدرس');

    const clean = cleanQs(questions, 'lesson_id', lessonId);
    if (!clean) return;

    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    try {
      let image_path = ls.image_path;
      const file = $('#l_img', box).files[0];
      const rm = $('#l_rmimg', box)?.checked;
      if (file) {
        const blob = await compress(file, 1100, 'image/webp', 0.8);
        const path = `${lessonId}/${Date.now()}.${extOf(blob)}`;
        const up = await sb.storage.from('lesson-images').upload(path, blob, { contentType: blob.type });
        if (up.error) throw up.error;
        if (ls.image_path) await sb.storage.from('lesson-images').remove([ls.image_path]);
        image_path = path;
      } else if (rm && ls.image_path) {
        await sb.storage.from('lesson-images').remove([ls.image_path]);
        image_path = null;
      }
      const u = await sb.from('lessons').update({
        title, summary: $('#l_sum', box).value, sort: Number($('#l_sort', box).value) || 0,
        hidden: $('#l_hid', box).checked, image_path,
        field_id: $('#l_field', box).value || ls.field_id
      }).eq('id', lessonId);
      if (u.error) throw u.error;

      const d = await sb.from('questions').delete().eq('lesson_id', lessonId);
      if (d.error) throw d.error;
      if (clean.length) { const i = await sb.from('questions').insert(clean); if (i.error) throw i.error; }

      ADM.lesson.name = title;
      const nf = sameSubjectFields.find(f => f.id === $('#l_field', box).value);
      if (nf) ADM.field = { id: nf.id, name: nf.name };       // يبقى المدير داخل المجال الجديد إن نقل الدرس
      toast('تم حفظ الدرس ✔');
      admContent(box);               // إعادة تحميل المحرر بالقيم المحفوظة
    } catch (err) {
      toast('تعذّر الحفظ: ' + (err.message || err));
      btn.disabled = false; btn.textContent = '💾 حفظ الدرس والأسئلة';
    }
  };
}

/* =============== الإعدادات =============== */
async function admSettings(box) {
  await loadSettings();
  box.innerHTML = `<div class="card" style="text-align:start">
    <label>تعليمات الدفع (تظهر للمشترك قبل رفع الإيصال)</label>
    <textarea id="s_pay" style="min-height:140px">${esc(S.settings.payment_info || '')}</textarea>
    <div class="small muted">اكتب رقم حسابك وطريقة التحويل والمبلغ المطلوب وأي ملاحظة.</div>
    <label>العملة (تظهر بجانب الأسعار)</label>
    <input type="text" id="s_cur" value="${esc(S.settings.currency || '')}">
    <button class="btn-block" id="s_save" style="margin-top:14px">حفظ الإعدادات</button></div>`;
  $('#s_save', box).onclick = async () => {
    const { error } = await sb.from('settings').upsert([
      { key: 'payment_info', value: $('#s_pay', box).value },
      { key: 'currency', value: $('#s_cur', box).value.trim() }
    ]);
    if (error) return toast('خطأ: ' + error.message);
    await loadSettings(); toast('تم الحفظ ✔');
  };
}

/* =============== الإحصاءات =============== */
async function admStats(box) {
  const nowIso = new Date().toISOString();
  const soon = new Date(Date.now() + 7 * 864e5).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const cnt = (t, f) => f(sb.from(t).select('id', { count: 'exact', head: true })).then(r => r.count ?? 0);

  const [active, pending, students, revRows, ending, recent] = await Promise.all([
    cnt('subscriptions', x => x.gt('ends_at', nowIso)),
    cnt('payments', x => x.eq('status', 'pending')),
    cnt('profiles', x => x.eq('role', 'student')),
    q(sb.from('payments').select('amount').eq('status', 'approved').gte('reviewed_at', monthStart)),
    q(sb.from('subscriptions').select('*, profiles(full_name,phone), levels(name)').gt('ends_at', nowIso).lte('ends_at', soon).order('ends_at').limit(15)),
    q(sb.from('results').select('lesson_id, lessons(title)').order('created_at', { ascending: false }).limit(1000))
  ]);
  const revenue = revRows.reduce((a, r) => a + Number(r.amount), 0);
  const tally = {};
  recent.forEach(r => { const t = r.lessons?.title || '—'; tally[t] = (tally[t] || 0) + 1; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5);

  box.innerHTML = `<div class="stats">
      <div class="stat"><b>${active}</b>اشتراكات سارية</div>
      <div class="stat"><b>${pending}</b>طلبات بانتظار المراجعة</div>
      <div class="stat"><b>${students}</b>حسابات الطلاب</div>
      <div class="stat"><b>${revenue.toLocaleString('ar-u-nu-latn')}</b>إيراد هذا الشهر (${esc(S.settings.currency || '')})</div></div>
    <h2>اشتراكات تنتهي خلال 7 أيام</h2>
    ${ending.length ? `<div class="list">${ending.map(r => `<div class="row"><div class="grow"><b>${esc(r.profiles?.full_name)}</b>
      <span class="muted small">${esc(r.profiles?.phone)}</span><br><span class="small">${esc(r.levels?.name)} · ${fmtDate(r.ends_at)}</span></div></div>`).join('')}</div>`
      : '<div class="muted">لا يوجد.</div>'}
    <h2>أكثر الدروس اختباراً</h2>
    ${top.length ? `<div class="list">${top.map(([t, n]) => `<div class="row"><span class="grow">${esc(t)}</span><span class="badge b-green">${n} محاولة</span></div>`).join('')}</div>`
      : '<div class="muted">لا توجد محاولات بعد.</div>'}`;
}
