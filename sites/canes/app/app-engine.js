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
        <details class="redeem"><summary>＋ ${say('Add a new class code', 'Redeem another access code')}</summary>
          ${redeemForm()}</details>
      </div>`);
    document.querySelectorAll('.libcard').forEach(b => b.onclick = () => renderClass(library[b.dataset.i]));
    wireRedeem();
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

  function showTab(kind, content, l) {
    const el = $('#tabBody');
    $('#player').style.display = kind === 'video' ? '' : 'none';
    if (kind === 'video') { el.innerHTML = ''; return; }
    const data = content[kind];
    if (!data) {
      el.innerHTML = `<div class="placeholder">${say('Coming soon! Cane is still working on this part. 🐕',
        'This material publishes with the lesson — check back soon.')}</div>`;
      return;
    }
    if (kind === 'study_guide') {
      el.innerHTML = `<div class="study">${(data.sections || []).map(s =>
        `<h3>${s.heading}</h3><p>${s.text}</p>`).join('')}</div>`;
    }
    if (kind === 'flashcards') renderFlashcards(el, data, l);
    if (kind === 'quiz') renderQuiz(el, data, l);
    if (kind === 'game') renderGame(el, data, l);
  }

  // ---------- flash cards ----------
  function renderFlashcards(el, data, l) {
    let i = 0, flipped = false;
    const cards = data.cards || [];
    const draw = () => {
      el.innerHTML = `
        <div class="flash ${flipped ? 'flip' : ''}" id="flashCard">
          <div class="face">${flipped ? cards[i].back : cards[i].front}</div>
          <span class="hint">${say('Tap to flip!', 'Tap card to flip')} · ${i + 1}/${cards.length}</span>
        </div>
        <div class="row">
          <button class="cta ghost" id="prevC">←</button>
          <button class="cta" id="nextC">${i === cards.length - 1 ? say('All done! 🌟', 'Finish deck') : 'Next →'}</button>
        </div>`;
      $('#flashCard').onclick = () => { flipped = !flipped; draw(); };
      $('#prevC').onclick = () => { i = Math.max(0, i - 1); flipped = false; draw(); };
      $('#nextC').onclick = () => {
        if (i === cards.length - 1) saveProgress(l, { flashcardsDone: true }, say('Card champion! 🃏', 'Deck complete'));
        else { i++; flipped = false; draw(); }
      };
    };
    cards.length ? draw() : el.innerHTML = '<div class="placeholder">No cards yet.</div>';
  }

  // ---------- quiz ----------
  function renderQuiz(el, data, l) {
    const qs = data.questions || [];
    let i = 0, right = 0;
    const timed = !kid && data.timedSeconds;
    const draw = () => {
      if (i >= qs.length) {
        const score = Math.round(right / qs.length * 100);
        el.innerHTML = `<div class="placeholder big">
          ${score >= 70 ? say('🎉 WOW! Cane is SO proud!', '🎉 Passed!') : say('Good try! Watch again and re-quiz!', 'Keep studying — try again!')}
          <strong>${score}%</strong></div>
          <button class="cta" id="redo">${say('Play again', 'Retake quiz')}</button>`;
        $('#redo').onclick = () => { i = 0; right = 0; draw(); };
        saveProgress(l, { quizScore: score }, score >= 70 ? say('Quiz star! ⭐', `Quiz passed: ${score}%`) : null);
        return;
      }
      const q = qs[i];
      el.innerHTML = `
        <div class="quiz">
          <p class="qq">${i + 1}. ${q.q}</p>
          ${q.choices.map((c, ci) => `<button class="choice" data-ci="${ci}">${c}</button>`).join('')}
          <p class="hint">${i + 1} of ${qs.length}${timed ? ' · ⏱️ timed practice' : ''}</p>
        </div>`;
      document.querySelectorAll('.choice').forEach(b => b.onclick = () => {
        const correct = Number(b.dataset.ci) === q.answer;
        if (correct) right++;
        b.classList.add(correct ? 'right' : 'wrong');
        setTimeout(() => { i++; draw(); }, 650);
      });
    };
    qs.length ? draw() : el.innerHTML = '<div class="placeholder">No quiz yet.</div>';
  }

  // ---------- game: memory match built from flashcards/pairs ----------
  function renderGame(el, data, l) {
    const pairs = (data.pairs || data.cards || []).slice(0, kid ? 6 : 8);
    if (!pairs.length) { el.innerHTML = '<div class="placeholder">No game yet.</div>'; return; }
    let deck = [];
    pairs.forEach((p, i) => {
      deck.push({ id: i, label: p.front || p.a }, { id: i, label: p.back || p.b });
    });
    deck.sort(() => Math.random() - 0.5);
    let open = [], matched = new Set(), lock = false;
    const draw = () => {
      el.innerHTML = `<p class="hint">${say('Match the pairs! 🐾', 'Match each term with its meaning')}</p>
        <div class="memory ${kid ? 'kidgrid' : ''}">
          ${deck.map((c, idx) => `
            <button class="mem ${matched.has(c.id) ? 'matched' : ''} ${open.includes(idx) ? 'open' : ''}"
              data-idx="${idx}">${matched.has(c.id) || open.includes(idx) ? c.label : '❓'}</button>`).join('')}
        </div>`;
      document.querySelectorAll('.mem').forEach(b => b.onclick = () => {
        const idx = Number(b.dataset.idx);
        if (lock || open.includes(idx) || matched.has(deck[idx].id)) return;
        open.push(idx);
        if (open.length === 2) {
          lock = true;
          const [a, b2] = open;
          setTimeout(() => {
            if (deck[a].id === deck[b2].id) {
              matched.add(deck[a].id);
              if (matched.size === pairs.length) {
                saveProgress(l, { gameDone: true }, say('You matched them ALL! 🏆', 'Game complete!'));
              }
            }
            open = []; lock = false; draw();
          }, 700);
        }
        draw();
      });
    };
    draw();
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
