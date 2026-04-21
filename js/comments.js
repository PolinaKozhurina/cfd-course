// ============================================================
// Comments System — shared across all lecture pages
// ============================================================
(function(){
  if (typeof firebase === 'undefined') return;
  var db, auth;
  try { db = firebase.firestore(); auth = firebase.auth(); } catch(e) { return; }
  var PAGE_ID = location.pathname.split('/').pop().replace('.html','') || 'index';
  var ADMINS = (typeof ADMIN_EMAILS !== 'undefined') ? ADMIN_EMAILS : [];
  function esc(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function loadComments() {
    var list = document.getElementById('comments-list'); if (!list) return;
    db.collection('comments').where('page','==',PAGE_ID).get().then(function(snap) {
      var docs = []; snap.forEach(function(d) { docs.push(d); });
      docs.sort(function(a,b) { return (b.data().createdAt?b.data().createdAt.seconds:0) - (a.data().createdAt?a.data().createdAt.seconds:0); });
      if (!docs.length) { list.innerHTML = '<p style="color:#9a8d7e;font-size:.85rem;font-style:italic">Пока нет комментариев</p>'; return; }
      var user = auth.currentUser, isAdm = user && ADMINS.indexOf(user.email) >= 0, html = '';
      docs.forEach(function(doc) {
        var c = doc.data(), date = c.createdAt ? new Date(c.createdAt.seconds*1000).toLocaleDateString('ru',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        var del = isAdm ? ' <button onclick="window._deleteComment(\''+doc.id+'\')" style="font-size:.7rem;color:#c44;background:none;border:none;cursor:pointer">удалить</button>' : '';
        var badge = c.authorRole === 'superadmin' ? ' <span style="font-size:.6rem;background:#faeeda;color:#854f0b;padding:1px 4px;border-radius:3px;font-weight:700">преподаватель</span>' : '';
        html += '<div style="padding:.6rem 0;border-bottom:1px solid #ede6da"><div style="display:flex;justify-content:space-between;align-items:baseline"><strong style="font-size:.88rem">'+(c.authorFio||c.authorEmail)+badge+'</strong><span style="font-size:.72rem;color:#9a8d7e">'+date+del+'</span></div><p style="font-size:.88rem;margin-top:.2rem;margin-bottom:0">'+esc(c.text)+'</p></div>';
      });
      list.innerHTML = html;
    }).catch(function(e) { list.innerHTML = '<p style="color:#c44;font-size:.85rem">Ошибка: '+e.message+'</p>'; });
  }
  window._postComment = function() {
    var text = document.getElementById('comment-text').value.trim(); if (!text) return;
    var user = auth.currentUser; if (!user) return;
    var fio = user.email, role = ADMINS.indexOf(user.email) >= 0 ? 'superadmin' : 'student';
    db.collection('users').doc(user.uid).get().then(function(ud) { if (ud.exists && ud.data().fio) fio = ud.data().fio; }).catch(function(){}).finally(function() {
      db.collection('comments').add({ page: PAGE_ID, text: text, authorEmail: user.email, authorFio: fio, authorUid: user.uid, authorRole: role, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function() { document.getElementById('comment-text').value = ''; loadComments(); }).catch(function(e) { alert('Ошибка: '+e.message); });
    });
  };
  window._deleteComment = function(id) { if (!confirm('Удалить?')) return; db.collection('comments').doc(id).delete().then(loadComments).catch(function(e){alert(e.message);}); };
  var _r = 0;
  function checkAuth() {
    var user = auth.currentUser, form = document.getElementById('comment-form'), login = document.getElementById('comment-login');
    if (!form || !login) return;
    if (user && window._userApproved) { form.style.display = ''; login.style.display = 'none'; _r = 0; }
    else if (user && typeof window._userApproved === 'undefined' && _r < 15) { _r++; setTimeout(checkAuth, 400); }
    else if (user) { form.style.display = 'none'; login.style.display = ''; login.querySelector('p').textContent = 'Ваш профиль ещё не подтверждён.'; _r = 0; }
    else { form.style.display = 'none'; login.style.display = ''; _r = 0; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadComments); else loadComments();
  function safeCheck() { if (document.getElementById('comment-form')) checkAuth(); else setTimeout(safeCheck, 200); }
  auth.onAuthStateChanged(function() { setTimeout(safeCheck, 500); });
  window.addEventListener('authReady', safeCheck);
})();
