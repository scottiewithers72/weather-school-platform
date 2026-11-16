/* Weather School Platform — PWA Companion App Engine
   One engine, two schools. window.SCHOOL is set by each site's app/index.html.
   Screens: auth -> profile picker -> library -> class -> lesson (video / study
   guide / flash cards / quiz / game). Progress posts drive the discount and
   graduation automations server-side. */
(() => {
  const S = window.SCHOOL;
  const API = '/api';
  const $ = (sel) => document.querySelector(sel);
  let token = localStorage.getItem('wsp_token') || '';
  let students = [];
  let activeStudent = JSON.parse(localStorage.getItem('wsp_student') || 'null');
  let library = [];
  let officeHours = [];

  // ---------- tiny fetch helper ----------
  async function api(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {})
      }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

  // ---------- rendering ----------
  const app = $('#app');
  const kid = S.uxMode === 'k4';
  const say = (k4, big) => (kid ? k4 : big);

  // ---------- PWA install ("download") support ----------
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const btn = document.getElementById('installBtn');
    if (btn) btn.hidden = false;
  });
  const isInstalled = () =>
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function installUI() {
    if (isInstalled()) return '';
    if (isIOS()) {
      return `<div class="installbar">📲 <strong>Install this app:</strong> tap the
        <span class="shareicon">Share</span> button below, then <strong>"Add to Home Screen."</strong></div>`;
    }
    return `<div class="installbar">
      <button class="cta" id="installBtn" ${deferredInstall ? '' : 'hidden'}>📲 Install the app</button>
      <span class="hint">Installs straight from the browser — no app store.</span></div>`;
  }
  function wireInstall() {
    const btn = document.getElementById('installBtn');
    if (btn) btn.onclick = async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      btn.hidden = true;
    };
  }

  function screen(html) { app.innerHTML = html; wireInstall(); }

  function toast(msg, emoji = '✅') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = `${emoji} ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ---------- auth ----------
  function renderAuth(mode = 'login') {
    screen(`
      <div class="authbox">
        <img src="${S.logo}" alt="${S.name}" class="logo">
        <h1>${say('Hi! Ready to learn? 🐾', 'Family Sign-In')}</h1>
        <div class="tabs">
          <button class="${mode === 'login' ? 'on' : ''}" id="tabLogin">Sign in</button>
          <button class="${mode === 'register' ? 'on' : ''}" id="tabReg">New family</button>
        </div>
        <form id="authForm">
          ${mode === 'register' ? `<input id="f_name" placeholder="Parent name" required>` : ''}
          <input id="f_email" type="email" placeholder="Parent email" required>
          <input id="f_pass" type="password" placeholder="Password (8+ characters)" required minlength="8">
          ${mode === 'register' ? `<input id="f_kid1" placeholder="First student's first name" required>
            <p class="hint">You can add up to 4 students. First names only — that's all we ever store about kids.</p>` : ''}
          <button class="cta" type="submit">${mode === 'register' ? 'Create family account' : 'Sign in'}</button>
        </form>
        <p class="hint" id="authMsg"></p>
        ${installUI()}
      </div>`);
    $('#tabLogin').onclick = () => renderAuth('login');
    $('#tabReg').onclick = () => renderAuth('register');
    $('#authForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const body = mode === 'register'
          ? { action: 'register', name: $('#f_name').value, email: $('#f_email').value,
              password: $('#f_pass').value, students: [{ firstName: $('#f_kid1').value }] }
          : { action: 'login', email: $('#f_email').value, password: $('#f_pass').value };
        const { token: t } = await post('/auth', body);
        token = t; localStorage.setItem('wsp_token', t);
        await loadStudents(); renderProfiles();
      } catch (err) { $('#authMsg').textContent = err.message; }
    };
  }

  async function loadStudents() {
    students = (await post('/auth', { action: 'list_students' })).students;
  }

  // ---------- profile picker ----------
  const AVATARS = { cloud: '⛅', sun: '☀️', bolt: '⚡', rainbow: '🌈', snow: '❄️', wave: '🌊', star: '⭐', tornado: '🌪️' };
  function renderProfiles() {
    screen(`
      <div class="authbox">
        <img src="${S.logo}" alt="${S.name}" class="logo">
        <h1>${say("Who's learning today?", 'Choose a student')}</h1>
        <div class="profiles">
          ${students.map(s => `
            <button class="profile" data-id="${s.id}">
              <span class="av">${AVATARS[s.avatar] || '⛅'}</span>${s.first_name}
            </button>`).join('')}
          ${students.length < 4 ? `<button class="profile add" id="addStu"><span class="av">＋</span>Add student</button>` : ''}
        </div>
        <button class="linkbtn" id="signout">Sign out</button>
      </div>`);
    document.querySelectorAll('.profile[data-id]').forEach(b => {
      b.onclick = () => {
        activeStudent = students.find(s => String(s.id) === b.dataset.id);
        localStorage.setItem('wsp_student', JSON.stringify(activeStudent));
        renderLibrary();
      };
    });
    const add = $('#addStu');
    if (add) add.onclick = async () => {
      const name = prompt('Student first name:');
      if (!name) return;
      const avatars = Object.keys(AVATARS);
      await post('/auth', { action: 'add_student', firstName: name,
        avatar: avatars[students.length % avatars.length] });
      await loadStudents(); renderProfiles();
    };
    $('#signout').onclick = () => {
      localStorage.clear(); token = ''; activeStudent = null; renderAuth();
    };
  }

  // ---------- library ----------
  async function renderLibrary() {
    screen(`<div class="page"><p class="loading">${say('Fetching your classes… 🐕', 'Loading your library…')}</p></div>`);
    try { library = (await api(`/library?school=${S.schoolId}`)).library; }
    catch (e) { return renderAuth(); }
    try { officeHours = (await api(`/office-hours?school=${S.schoolId}`)).officeHours || []; }
    catch (e) { officeHours = []; }
    const head = headerBar();
    if (!library.length) {
      return screen(`${head}
        <div class="page">
          <h2>${say('Let’s unlock your first class!', 'Redeem your access code')}</h2>
          <p>Enter the code from your purchase email:</p>
          ${redeemForm()}
          <p class="hint">Don't have a class yet? <a href="/">Browse the catalog →</a></p>
        </div>`), wireRedeem();
    }
    screen(`${head}
      <div class="page">
        <h2>${say(`${activeStudent.first_name}'s classes`, 'Your classes')}</h2>
        <div class="libgrid">
          ${library.map((c, i) => {
            const done = countDone(c);
            return `
            <button class="libcard" data-i="${i}">
              ${c.source === 'graduation_gift' ? '<span class="gifttag">🎓 Graduation gift</span>' : ''}
              <strong>${c.title}</strong>
              <span class="sub2">${c.lessons.filter(l => l.unlocked).length}/${c.lessons.length} lessons unlocked
                ${c.nextUnlock ? ` · next: ${c.nextUnlock}` : ''}</span>
              <span class="bar"><i style="width:${Math.round(done / c.lessons.length * 100)}%"></i></span>
            </button>`;
          }).join('')}
        </div>
        ${officeHoursBlock(officeHours)}
        <details class="redeem"><summary>＋ ${say('Add a new class code', 'Redeem another access code')}</summary>
          ${redeemForm()}</details>
      </div>`);
    document.querySelectorAll('.libcard').forEach(b => b.onclick = () => renderClass(library[b.dataset.i]));
    wireRedeem();
  }


  // ---------- live office hours (weekly Zoom Q&A) ----------
  function fmtSession(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  function officeHoursBlock(list) {
    if (!list || !list.length) return '';
    return `
      <div class="officehours">
        <h3>🎥 ${say('Live Q&A with Scott', 'Live office hours with Scott')}</h3>
        <p class="hint">${say('Bring your questions! A grown-up joins with you on Zoom.',
          'Weekly 30-minute Zoom Q&A for your course. If no one joins in the first 5 minutes, that week’s session closes.')}</p>
        ${list.map(o => `
          <div class="ohrow">
            <span><strong>${o.label}</strong><small>${o.start ? fmtSession(o.start) : 'Schedule coming soon'}</small></span>
            ${o.joinable && o.zoomUrl
              ? `<a class="cta" href="${o.zoomUrl}" target="_blank" rel="noopener">Join now</a>`
              : `<small class="ohsoon">${o.linkReady || !o.start ? 'Join button appears 10 min before' : 'Link posted before the session'}</small>`}
          </div>`).join('')}
      </div>`;
  }

  const progressCache = {};
  function countDone(c) {
    return c.lessons.filter(l => progressCache[l.id]?.video_done).length;
  }

  function headerBar() {
    return `
      <header class="appbar">
        <img src="${S.logo}" alt="${S.name}">
        <span class="who">${activeStudent ? (AVATARS[activeStudent.avatar] || '⛅') + ' ' + activeStudent.first_name : ''}</span>
        <button class="linkbtn" onclick="window.WSP.profiles()">Switch</button>
      </header>`;
  }

  function redeemForm() {
    return `<form class="codeform"><input id="codeInput" placeholder="CODE-XXXX-XXXX" autocapitalize="characters">
            <button class="cta" type="submit">Unlock</button><p class="hint" id="codeMsg"></p></form>`;
  }
  function wireRedeem() {
    const f = document.querySelector('.codeform');
    if (!f) return;
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const { title } = await post('/redeem', { code: $('#codeInput').value });
        toast(say(`${title} is unlocked! 🎉`, `${title} unlocked`), '🎉');
        renderLibrary();
      } catch (err) { $('#codeMsg').textContent = err.message; }
    };
  }

  // ---------- class ----------
  function renderClass(c) {
    screen(`${headerBar()}
      <div class="page">
        <button class="linkbtn" onclick="window.WSP.library()">← ${say('All my classes', 'Library')}</button>
        <h2>${c.title}</h2>
        <p class="sub2">${c.subtitle || ''}</p>
        <div class="lessons">
          ${c.lessons.map(l => `
            <button class="lesson ${l.unlocked ? '' : 'locked'}" ${l.unlocked ? `data-id="${l.id}"` : 'disabled'}>
              <span class="num">${l.unlocked ? l.position : '🔒'}</span>
              <span class="ltitle">${l.title}<small>${l.durationMin ? l.durationMin + ' min' : ''}
                ${progressCache[l.id]?.video_done ? ' · ✅ watched' : ''}</small></span>
            </button>`).join('')}
        </div>
        ${c.nextUnlock ? `<p class="hint">📅 ${say('Next lesson opens', 'Next lesson unlocks')} ${c.nextUnlock}</p>` : ''}
        ${officeHoursBlock(officeHours.filter(o => o.classId === c.classId || (!o.classId && c.schoolId === S.schoolId)))}
      </div>`);
    document.querySelectorAll('.lesson[data-id]').forEach(b => {
      const l = c.lessons.find(x => String(x.id) === b.dataset.id);
      b.onclick = () => renderLesson(c, l);
    });
  }

  // ---------- lesson ----------
  async function renderLesson(c, l) {
    screen(`${headerBar()}
      <div class="page">
        <button class="linkbtn" id="backToClass">← ${c.title}</button>
        <h2>${say('📺 ', '')}${l.title}</h2>
        <div class="player" id="player"><p class="loading">${say('Starting the show…', 'Loading video…')}</p></div>
        <nav class="lessontabs">
          <button class="on" data-t="video">🎬 ${say('Watch', 'Video')}</button>
          <button data-t="study_guide">📚 ${say('Read', 'Study Guide')}</button>
          <button data-t="flashcards">🃏 ${say('Cards', 'Flash Cards')}</button>
          <button data-t="quiz">⭐ Quiz</button>
          <button data-t="game">🎮 ${say('Play', 'Game')}</button>
          <button data-t="documents">📄 ${say('Print', 'Printables')}</button>
        </nav>
        <div id="tabBody"></div>
      </div>`);
    $('#backToClass').onclick = () => renderClass(c);

    // video
    try {
      const { embedUrl } = await api(`/video-token?lessonId=${l.id}`);
      $('#player').innerHTML =
        `<iframe src="${embedUrl}" loading="lazy" allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
          allowfullscreen style="border:0;width:100%;aspect-ratio:16/9;border-radius:14px"></iframe>
         <button class="cta" id="markWatched">✅ ${say('I watched it!', 'Mark lesson watched')}</button>`;
      $('#markWatched').onclick = () => saveProgress(l, { videoDone: true },
        say('Great watching! 🐾', 'Lesson marked complete'));
    } catch (e) {
      $('#player').innerHTML = `<div class="placeholder">🎬 ${e.message}</div>`;
    }

    // companion content
    let content = {};
    try { content = (await api(`/content?lessonId=${l.id}`)).content; } catch (e) {}

    const tabs = document.querySelectorAll('.lessontabs button');
    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      showTab(t.dataset.t, content, l);
    });
    showTab('video', content, l);
  }

  // ---------- weekly printables ----------
  async function renderDocuments(el, l) {
    el.innerHTML = `<p class="loading">${say('Finding your papers…', 'Loading documents…')}</p>`;
    let documents = [];
    try { ({ documents } = await api(`/documents?lessonId=${l.id}`)); }
    catch (e) { el.innerHTML = `<div class="placeholder">${e.message}</div>`; return; }
    if (!documents.length) {
      el.innerHTML = `<div class="placeholder">${say('Cane is still printing this week\'s papers! 🐕', 'This week\'s documents publish soon.')}</div>`;
      return;
    }
    const row = d => `
      <div class="docrow">
        <span class="docname">${d.kind === 'certificate' ? '🎓' : '📄'} ${d.label}${d.kb ? `<small>${d.kb} KB · PDF</small>` : ''}</span>
        <span class="docbtns">
          <a class="docbtn ghost" href="${d.viewUrl}" target="_blank" rel="noopener">Open</a>
          <a class="docbtn" href="${d.url}" download="${d.fileName}">Download</a>
        </span>
      </div>`;
    const parent = documents.filter(d => d.group === 'parent');
    const student = documents.filter(d => d.group !== 'parent');
    el.innerHTML = `<div class="docs">
      ${student.length ? `<h3>${say('🖍️ For Students', 'Student materials')}</h3>${student.map(row).join('')}` : ''}
      ${parent.length ? `<h3>👨‍👩‍👧 For Parents & Teachers</h3>
        <p class="hint">${say('Grown-ups: answers and teaching tips are in here.', 'Includes answer keys and teaching notes.')}</p>
        ${parent.map(row).join('')}` : ''}
      <p class="hint">Links refresh each time you open this tab.</p>
    </div>`;
  }

  function showTab(kind, content, l) {
    const el = $('#tabBody');
    $('#player').style.display = kind === 'video' ? '' : 'none';
    if (kind === 'video') { el.innerHTML = ''; return; }
    if (kind === 'documents') { renderDocuments(el, l); return; }
    const data = content[kind];
    if (!data) {
      el.innerHTML = `<div class="placeholder">${say('Coming soon! Cane is still working on this part. 🐕',
        'This material publishes with the lesson — check back soon.')}</div>`;
      return;
    }
    if (kind === 'study_guide') renderStudy(el, data, l);
    if (kind === 'flashcards') renderFlashcards(el, data, l);
    if (kind === 'quiz') renderQuiz(el, data, l);
    if (kind === 'game') renderGame(el, data, l);
  }

  // ---------- shared helpers for practice screens ----------
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = kid ? 0.88 : 1; u.pitch = 1.05;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  const speakBtn = (id) => ('speechSynthesis' in window)
    ? `<button class="speak" id="${id}" aria-label="Read aloud">🔊 ${say('Read to me', 'Listen')}</button>` : '';
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cheers = ['Pawsome! 🐾', 'You got it! ⭐', 'Weather genius! 🌦️', 'Cane is wagging! 🐕', 'Super smart! 🌟'];

  // ---------- study guide: illustrated storybook ----------
  function renderStudy(el, data, l) {
    // legacy shape: { sections:[{heading,text}] }
    if (!data.pages) {
      el.innerHTML = `<div class="study">${(data.sections || []).map(s => `<h3>${s.heading}</h3><p>${s.text}</p>`).join('')}</div>`;
      return;
    }
    const pages = data.pages; let i = 0;
    const draw = () => {
      const pg = pages[i], last = i === pages.length - 1;
      el.innerHTML = `
        <div class="book">
          <p class="book-title">📖 ${esc(data.title || '')}</p>
          <img class="book-art" src="${pg.img}" alt="">
          <p class="book-text">${pg.text}</p>
          ${pg.ask ? `<div class="ask"><b>${say('Your turn!', 'Ask!')}</b> ${esc(pg.ask)}</div>` : ''}
          ${last && data.rule ? `<div class="rule">🐾 ${say("Cane's big rule", 'The big rule')}<strong>${esc(data.rule)}</strong></div>` : ''}
          <div class="book-nav">
            <button class="cta ghost" id="bPrev" ${i === 0 ? 'disabled' : ''}>←</button>
            ${speakBtn('bSpeak')}
            <button class="cta" id="bNext">${last ? say('The end! 🌈', 'Finish') : 'Next →'}</button>
          </div>
          <p class="hint">${say('Page', 'Page')} ${i + 1} of ${pages.length}</p>
        </div>`;
      $('#bPrev').onclick = () => { if (i > 0) { i--; draw(); } };
      $('#bNext').onclick = () => { if (last) { speechSynthesis?.cancel?.(); i = 0; draw(); toast(say('Great reading! 📚', 'Reading complete')); } else { i++; draw(); } };
      const sp = $('#bSpeak'); if (sp) sp.onclick = () => speak(plain(pg.text) + (pg.ask ? ' ' + pg.ask : '') + (last && data.rule ? ' ' + data.rule : ''));
    };
    draw();
  }

  // ---------- flash cards: picture front, word + meaning back ----------
  function renderFlashcards(el, data, l) {
    const cards = data.cards || [];
    if (!cards.length) { el.innerHTML = '<div class="placeholder">No cards yet.</div>'; return; }
    let i = 0, flipped = false;
    const draw = () => {
      const c = cards[i], last = i === cards.length - 1;
      el.innerHTML = `
        <div class="fc ${flipped ? 'flipped' : ''}" id="fc" role="button" tabindex="0">
          ${c.front || c.img ? `
            <div class="fc-side fc-front">
              <img src="${c.front || c.img}" alt="">
              <span class="fc-q">${say("What's this weather word? 🤔", 'What word is this?')}</span>
            </div>
            <div class="fc-side fc-back">
              <img src="${c.back || c.front || c.img}" alt="">
              <span class="fc-word">${esc(c.word)}</span>
              <span class="fc-def">${esc(c.def)}</span>
            </div>` : `
            <div class="fc-side fc-front"><span class="fc-word">${c.front}</span></div>
            <div class="fc-side fc-back"><span class="fc-def">${c.back}</span></div>`}
        </div>
        <p class="hint">${say('Tap the card to flip it!', 'Tap card to flip')} · ${i + 1}/${cards.length}</p>
        <div class="book-nav">
          <button class="cta ghost" id="prevC" ${i === 0 ? 'disabled' : ''}>←</button>
          ${c.word ? speakBtn('fcSpeak') : ''}
          <button class="cta" id="nextC">${last ? say('All done! 🌟', 'Finish deck') : 'Next →'}</button>
        </div>`;
      const flip = () => { flipped = !flipped; $('#fc').classList.toggle('flipped', flipped); if (flipped && c.word) speak(c.word); };
      $('#fc').onclick = flip;
      $('#fc').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
      $('#prevC').onclick = () => { if (i > 0) { i--; flipped = false; draw(); } };
      const sp = $('#fcSpeak'); if (sp) sp.onclick = () => speak(`${c.word}. ${c.def}`);
      $('#nextC').onclick = () => {
        if (last) { saveProgress(l, { flashcardsDone: true }, say('Card champion! 🃏', 'Deck complete')); i = 0; flipped = false; draw(); }
        else { i++; flipped = false; draw(); }
      };
    };
    draw();
  }

  // ---------- quiz: start screen, cheers, finish screen ----------
  function renderQuiz(el, data, l) {
    const qs = data.questions || [];
    if (!qs.length) { el.innerHTML = '<div class="placeholder">No quiz yet.</div>'; return; }
    let i = -1, right = 0, picked = new Set();
    const timed = !kid && data.timedSeconds;
    const draw = () => {
      if (i === -1) {
        el.innerHTML = `<div class="stage">
          ${data.start ? `<img class="stage-art" src="${data.start}" alt="">` : ''}
          <h3>${esc(data.title || 'Quiz time!')}</h3>
          <p>${say(`${qs.length} questions. Cane will cheer you on!`, `${qs.length} questions`)}</p>
          <button class="cta" id="go">${say("Let's go! 🐾", 'Start quiz')}</button></div>`;
        $('#go').onclick = () => { i = 0; draw(); };
        return;
      }
      if (i >= qs.length) {
        const score = Math.round(right / qs.length * 100);
        const stars = right === qs.length ? 3 : score >= 70 ? 2 : 1;
        el.innerHTML = `<div class="stage">
          ${data.finish ? `<img class="stage-art" src="${data.finish}" alt="">` : ''}
          <div class="stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
          <h3>${score >= 70 ? say(data.finalWeek ? '🎓 You did it, graduate!' : '🎉 WOW! Cane is SO proud!', '🎉 Passed!') : say('Good try! Watch again and play again!', 'Keep studying — try again!')}</h3>
          <p><strong>${right} of ${qs.length}</strong> ${say('right!', 'correct')}</p>
          ${data.bonus ? `<div class="ask"><b>${say('Bonus — say it out loud!', 'Bonus')}</b> ${esc(data.bonus.prompt)}
             <button class="linkbtn" id="reveal">${say('Show me', 'Show answer')}</button><span id="bAns" hidden> <strong>${esc(data.bonus.answer)}</strong></span></div>` : ''}
          <button class="cta" id="redo">${say('Play again', 'Retake quiz')}</button></div>`;
        $('#redo').onclick = () => { i = 0; right = 0; draw(); };
        const rv = $('#reveal'); if (rv) rv.onclick = () => { $('#bAns').hidden = false; rv.remove(); speak(data.bonus.answer); };
        saveProgress(l, { quizScore: score }, score >= 70 ? say('Quiz star! ⭐', `Quiz passed: ${score}%`) : null);
        return;
      }
      // Shuffle answer order each time (most printed answers are "a"); keep True/False in order.
      const src = qs[i];
      const keep = src.choices.length === 2 && /^(true|yes)$/i.test(src.choices[0]);
      const order = keep ? src.choices.map((_, k) => k) : shuffle(src.choices.map((_, k) => k));
      const q = { ...src, choices: order.map(k => src.choices[k]),
        answer: src.answer != null ? order.indexOf(src.answer) : undefined,
        answers: src.answers ? src.answers.map(a => order.indexOf(a)) : undefined };
      picked = new Set();
      el.innerHTML = `
        <div class="quiz">
          <p class="qq">${i + 1}. ${esc(q.q)}</p>
          ${q.multi ? `<p class="hint">${say(`Tap all ${q.answers.length}!`, `Select all that apply (${q.answers.length})`)}</p>` : ''}
          <div class="choices ${q.choices.length === 4 ? 'four' : ''}">
          ${q.choices.map((c, ci) => `<button class="choice" data-ci="${ci}">${esc(c)}</button>`).join('')}
          </div>
          ${q.multi ? `<button class="cta" id="check" disabled>${say('Check! ✅', 'Check answer')}</button>` : ''}
          <div class="row" style="justify-content:space-between;align-items:center">
            <p class="hint">${i + 1} of ${qs.length}${timed ? ' · ⏱️ timed practice' : ''}</p>${speakBtn('qSpeak')}
          </div>
          <p class="cheer" id="cheer"></p>
        </div>`;
      const sp = $('#qSpeak'); if (sp) sp.onclick = () => speak(q.q + '. ' + q.choices.map(c => c.replace(/[^\p{L}\p{N}\s'-]/gu, '')).join(', '));
      const next = (ok) => {
        if (ok) { right++; $('#cheer').textContent = cheers[Math.floor(Math.random() * cheers.length)]; }
        else $('#cheer').textContent = say('Nice try! 🐾', 'Not quite.');
        setTimeout(() => { i++; draw(); }, ok ? 900 : 1300);
      };
      const btns = document.querySelectorAll('.choice');
      if (!q.multi) {
        btns.forEach(b => b.onclick = () => {
          btns.forEach(x => x.disabled = true);
          const ok = Number(b.dataset.ci) === q.answer;
          b.classList.add(ok ? 'right' : 'wrong');
          if (!ok) btns[q.answer].classList.add('right');
          next(ok);
        });
      } else {
        btns.forEach(b => b.onclick = () => {
          const ci = Number(b.dataset.ci);
          picked.has(ci) ? picked.delete(ci) : picked.add(ci);
          b.classList.toggle('picked', picked.has(ci));
          $('#check').disabled = picked.size === 0;
        });
        $('#check').onclick = () => {
          const want = new Set(q.answers);
          const ok = picked.size === want.size && [...picked].every(x => want.has(x));
          btns.forEach((b, ci) => { b.disabled = true; if (want.has(ci)) b.classList.add('right'); else if (picked.has(ci)) b.classList.add('wrong'); });
          $('#check').disabled = true;
          next(ok);
        };
      }
    };
    draw();
  }

  // ---------- game: picture-word memory match ----------
  function renderGame(el, data, l) {
    let pairs = data.pairs || (data.cards || []).map(c => ({ a: c.front, b: c.back }));
    pairs = pairs.slice(0, kid ? 6 : 8);
    if (!pairs.length) { el.innerHTML = '<div class="placeholder">No game yet.</div>'; return; }
    const deck = shuffle(pairs.flatMap((p, id) => [
      p.img ? { id, img: p.img } : { id, label: p.a },
      { id, label: p.word || p.b }
    ]));
    let open = [], matched = new Set(), lock = false, tries = 0;
    const start = () => {
      el.innerHTML = `<div class="stage">
        ${data.start ? `<img class="stage-art" src="${data.start}" alt="">` : ''}
        <h3>${say('Weather Word Match! 🐾', 'Memory match')}</h3>
        <p>${say('Flip two cards. Find each picture and its word!', 'Match each picture with its word')}</p>
        <button class="cta" id="go">${say('Play! 🎮', 'Start')}</button></div>`;
      $('#go').onclick = draw;
    };
    const tile = (c, idx) => {
      const show = matched.has(c.id) || open.includes(idx);
      const face = c.img ? `<img src="${c.img}" alt="">` : `<span>${esc(c.label)}</span>`;
      return `<button class="mem ${matched.has(c.id) ? 'matched' : ''} ${open.includes(idx) ? 'open' : ''} ${c.img ? 'pic' : 'word'}"
        data-idx="${idx}">${show ? face : '<span class="paw">⛅</span>'}</button>`;
    };
    const draw = () => {
      el.innerHTML = `<p class="hint">${say('Find the matches!', 'Match the pairs')} · ${matched.size}/${pairs.length} · ${tries} ${say('tries', 'tries')}</p>
        <div class="memory ${kid ? 'kidgrid' : ''}">${deck.map(tile).join('')}</div>`;
      document.querySelectorAll('.mem').forEach(b => b.onclick = () => {
        const idx = Number(b.dataset.idx);
        if (lock || open.includes(idx) || matched.has(deck[idx].id)) return;
        open.push(idx);
        if (!deck[idx].img) speak(deck[idx].label);
        if (open.length === 2) {
          lock = true; tries++;
          const [a, b2] = open;
          setTimeout(() => {
            if (deck[a].id === deck[b2].id) matched.add(deck[a].id);
            open = []; lock = false;
            if (matched.size === pairs.length) {
              el.innerHTML = `<div class="stage">
                ${data.finish ? `<img class="stage-art" src="${data.finish}" alt="">` : ''}
                <h3>${say('You matched them ALL! 🏆', 'Game complete!')}</h3>
                <p>${tries} ${say('tries', 'tries')}</p>
                <button class="cta" id="again">${say('Play again', 'Play again')}</button></div>`;
              $('#again').onclick = () => renderGame(el, data, l);
              saveProgress(l, { gameDone: true }, say('Match master! 🏆', 'Game complete!'));
            } else draw();
          }, 800);
        }
        draw();
      });
    };
    start();
  }

  // ---------- progress ----------
  async function saveProgress(l, fields, msg) {
    if (!activeStudent) return;
    try {
      const { notices } = await post('/progress', { studentId: activeStudent.id, lessonId: l.id, ...fields });
      progressCache[l.id] = { ...(progressCache[l.id] || {}), video_done: fields.videoDone || progressCache[l.id]?.video_done };
      if (msg) toast(msg);
      (notices || []).forEach(n => {
        if (n.type === 'discount') toast(`You earned ${'15'}% off your next class! Code: ${n.code}`, '💝');
        if (n.type === 'graduation') toast(say(`🎓 CANE'S GIFT: ${n.giftClass} is FREE at EarthSphere Academy!`,
          `🎓 Graduation! ${n.giftClass} unlocked free at EarthSphere Academy`), '🎓');
      });
    } catch (e) { console.error(e); }
  }

  // ---------- boot ----------
  window.WSP = {
    profiles: renderProfiles,
    library: renderLibrary
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  (async () => {
    if (!token) return renderAuth();
    try { await loadStudents(); activeStudent && students.find(s => s.id === activeStudent.id) ? renderLibrary() : renderProfiles(); }
    catch (e) { renderAuth(); }
  })();
})();
