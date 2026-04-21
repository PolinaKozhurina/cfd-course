// ============================================================
// Checklist Sync — saves/loads checkbox state to/from Firestore
// ============================================================
// Each checkbox gets an ID based on its position.
// State is stored per group in Firestore:
//   groups/{groupId}/checklist/{itemId} = { checked, checkedBy, timestamp }
// ============================================================

(function() {
  "use strict";

  // Wait for Firebase
  if (typeof firebase === 'undefined') {
    console.warn('Firebase not loaded — checklist sync disabled');
    return;
  }
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let userGroup = null;
  let checkboxes = [];
  let isAdmin = false;
  var _isDirty = false;

  // ===== Assign IDs to all checkboxes =====
  function initCheckboxes() {
    const allCB = document.querySelectorAll('input[type="checkbox"]');
    checkboxes = [];
    allCB.forEach((cb, index) => {
      // Build meaningful ID from table row context
      const row = cb.closest('tr');
      const section = cb.closest('.block, table');
      let itemId = 'cb_' + index;
      
      // Try to get a better ID from the CHECK: tag in same row
      if (row) {
        const tag = row.querySelector('.tag');
        if (tag) {
          const tagText = tag.textContent.replace('CHECK: ', '').trim();
          if (tagText && tagText !== 'CHECK: TAG') itemId = tagText;
        } else {
          // Use row number + block context
          const blockNum = section ? section.querySelector('.block-num') : null;
          const bn = blockNum ? blockNum.textContent.trim() : '0';
          const cells = row.querySelectorAll('td');
          const rowDesc = cells.length > 1 ? cells[1].textContent.trim().slice(0, 30) : '';
          itemId = 'b' + bn + '_r' + index + '_' + rowDesc.replace(/\s+/g, '_').replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
        }
      }

      cb.dataset.itemId = itemId;
      checkboxes.push({ el: cb, id: itemId });

      // Add change listener
      cb.addEventListener('change', function() {
        saveCheckboxState(this.dataset.itemId, this.checked);
        updateProgressBar();
      });
    });

    // Add progress bar
    addProgressBar();
  }

  // ===== Progress bar =====
  function addProgressBar() {
    const existing = document.getElementById('checklist-progress');
    if (existing) existing.remove();

    const total = checkboxes.length;
    const bar = document.createElement('div');
    bar.id = 'checklist-progress';
    bar.style.cssText = 'position:sticky;top:0;z-index:99;background:var(--surface,#1a1d27);border-bottom:1px solid var(--border,#2d3548);padding:8px 16px;display:flex;align-items:center;gap:12px;font-family:"JetBrains Mono",monospace;font-size:.78rem';
    bar.innerHTML = `
      <span id="cp-user" style="color:var(--text2,#8892a8)">Не авторизован</span>
      <span id="cp-repo"></span>
      <div style="flex:1;background:var(--surface2,#242a38);height:8px;border-radius:4px;overflow:hidden">
        <div id="cp-fill" style="height:100%;background:var(--green,#22c55e);border-radius:4px;width:0%;transition:width .3s"></div>
      </div>
      <span id="cp-count" style="color:var(--text2,#8892a8)">0 / ${total}</span>
      <button id="cp-save-btn" style="font-family:inherit;font-size:.72rem;padding:3px 10px;border-radius:4px;border:1px solid var(--border,#2d3548);background:var(--accent,#3b82f6);color:#fff;cursor:pointer;display:none" onclick="CFDChecklist.saveAll()">Сохранить</button>
    `;

    // Insert at top of body or before first h1
    const h1 = document.querySelector('h1');
    if (h1) h1.parentNode.insertBefore(bar, h1);
    else document.body.prepend(bar);

    // Add messages container below progress bar
    const msgBox = document.createElement('div');
    msgBox.id = 'cp-messages';
    msgBox.style.cssText = 'display:none;padding:4px 16px 8px;background:var(--surface,#f5f0e8);border-bottom:1px solid var(--border,#d9cfc0)';
    bar.parentNode.insertBefore(msgBox, bar.nextSibling);
  }

  function updateProgressBar() {
    const checked = checkboxes.filter(cb => cb.el.checked).length;
    const total = checkboxes.length;
    const pct = total > 0 ? (checked / total * 100).toFixed(0) : 0;
    const fill = document.getElementById('cp-fill');
    const count = document.getElementById('cp-count');
    if (fill) fill.style.width = pct + '%';
    if (count) count.textContent = checked + ' / ' + total;
  }

  // ===== Save/Load from Firestore =====
  async function saveCheckboxState(itemId, checked) {
    if (!currentUser || !userGroup) return;
    try {
      await db.collection('groups').doc(userGroup).collection('checklist').doc(itemId).set({
        checked: checked,
        checkedBy: currentUser.email,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('Could not save checkbox state:', e);
    }
  }

  async function loadCheckboxStates() {
    if (!userGroup) return;
    try {
      const snap = await db.collection('groups').doc(userGroup).collection('checklist').get();
      const states = {};
      snap.forEach(doc => { states[doc.id] = doc.data(); });

      for (const cb of checkboxes) {
        if (states[cb.id]) {
          cb.el.checked = states[cb.id].checked;
          // Add tooltip with who checked it
          if (states[cb.id].checked && states[cb.id].checkedBy) {
            cb.el.title = 'Отметил(а): ' + states[cb.id].checkedBy;
          }
        }
      }
      updateProgressBar();
    } catch (e) {
      console.warn('Could not load checkbox states:', e);
    }
    // Also load admin approvals (show as green indicator)
    if (userGroup) {
      try {
        var adminSnap = await db.collection('groups').doc(userGroup).collection('admin_checklist').get();
        var adminKeys = {};
        adminSnap.forEach(function(doc) { if (doc.data().checked) adminKeys[doc.id] = true; });
        
        // Match admin keys to checkboxes using same logic as student keys
        checkboxes.forEach(function(cbObj) {
          if (adminKeys[cbObj.id]) {
            cbObj.el.parentElement.style.background = '#e8f4f0';
            cbObj.el.parentElement.title = 'Подтверждено преподавателем ✓';
          }
        });
      } catch(e) {}
    }
  }

  // ===== Show group repo URL =====
  function showRepoUrl(groupId) {
    if (!groupId) return;
    db.collection('groups').doc(groupId).get().then(function(doc) {
      if (!doc.exists || !doc.data().repoUrl) return;
      var url = doc.data().repoUrl;
      var container = document.getElementById('cp-repo');
      if (container) {
        container.innerHTML = '<a href="' + url + '" target="_blank" style="color:var(--cyan,#3a5ba0);font-family:JetBrains Mono,monospace;font-size:.72rem;text-decoration:none;border-bottom:1px dashed var(--cyan,#3a5ba0)">📁 ' + url.replace('https://github.com/','') + '</a>';
      }
    }).catch(function(){});
  }

  // ===== Show admin messages for group =====
  var _chatUnsub = null;
  var _unreadAdminMsgIds = []; // admin messages not yet read by this user

  function loadGroupMessages(groupId) {
    if (!groupId) return;
    if (_chatUnsub) { _chatUnsub(); _chatUnsub = null; }

    var container = document.getElementById('cp-messages');
    if (!container) return;
    container.style.display = '';

    container.innerHTML = '<div id="cp-chat-toggle" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 0" onclick="window._toggleStudentChat()">' +
      '<span style="font-family:JetBrains Mono,monospace;font-size:.72rem;color:var(--accent,#b44a2d);font-weight:700">💬 Чат с преподавателем</span>' +
      '<span id="cp-chat-badge" style="display:none;font-size:.62rem;background:#b44a2d;color:#fff;padding:1px 5px;border-radius:8px;font-family:JetBrains Mono,monospace"></span>' +
      '<span id="cp-chat-arrow" style="font-size:.68rem;color:var(--text2,#6b5d4f)">▼</span>' +
      '</div>' +
      '<div id="cp-chat-box" style="display:none;border:1px solid var(--border,#d9cfc0);border-radius:8px;overflow:hidden;background:#fff;margin-top:4px">' +
        '<div id="cp-chat-body" style="height:250px;overflow-y:auto;padding:8px;font-size:.85rem"></div>' +
        '<div id="cp-chat-input-wrap" style="display:none;border-top:1px solid var(--border,#d9cfc0);padding:6px;background:var(--surface,#f5f0e8);gap:4px">' +
          '<input type="text" id="cp-chat-input" placeholder="Написать..." style="flex:1;font-family:Source Serif 4,Georgia,serif;font-size:.85rem;padding:5px 8px;border:1px solid var(--border,#d9cfc0);border-radius:5px;background:#fff;color:var(--text,#2c2419)">' +
          '<button onclick="window._sendStudentChat()" style="font-family:JetBrains Mono,monospace;font-size:.75rem;padding:4px 12px;border-radius:5px;background:var(--accent,#b44a2d);color:#fff;border:none;cursor:pointer;font-weight:600">→</button>' +
        '</div>' +
      '</div>';

    setTimeout(function() {
      var inp = document.getElementById('cp-chat-input');
      if (inp) inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') window._sendStudentChat(); });
    }, 100);

    _chatUnsub = db.collection('groups').doc(groupId).collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot(function(snap) {
        renderStudentChat(snap);
      }, function(err) {
        console.warn('Chat error:', err);
        db.collection('groups').doc(groupId).collection('messages')
          .orderBy('createdAt', 'asc').get().then(renderStudentChat);
      });
  }

  // Toggle chat open/close — mark as read when opening
  window._toggleStudentChat = function() {
    var box = document.getElementById('cp-chat-box');
    var arrow = document.getElementById('cp-chat-arrow');
    if (!box) return;
    var opening = box.style.display === 'none';
    box.style.display = opening ? '' : 'none';
    if (arrow) arrow.textContent = opening ? '▲' : '▼';
    if (opening) {
      markAdminMessagesRead();
    }
  };

  // Mark unread admin messages as read by this user
  function markAdminMessagesRead() {
    if (!currentUser || !userGroup || _unreadAdminMsgIds.length === 0) return;
    var uid = currentUser.uid;
    var fio = currentUser.email;
    // Get FIO
    db.collection('users').doc(uid).get().then(function(ud) {
      if (ud.exists && ud.data().fio) fio = ud.data().fio;
      var readData = {};
      readData['readBy.' + uid] = { email: currentUser.email, fio: fio, at: Date.now() };
      var toMark = _unreadAdminMsgIds.slice();
      _unreadAdminMsgIds = [];
      toMark.forEach(function(msgId) {
        db.collection('groups').doc(userGroup).collection('messages').doc(msgId).update(readData).catch(function(){});
      });
      // Clear badge
      var badge = document.getElementById('cp-chat-badge');
      if (badge) badge.style.display = 'none';
    }).catch(function(){});
  }

  function renderStudentChat(snap) {
    var body = document.getElementById('cp-chat-body');
    if (!body) return;
    var html = '';
    var totalCount = 0;
    var unreadCount = 0;
    _unreadAdminMsgIds = [];

    snap.forEach(function(doc) {
      var m = doc.data();
      totalCount++;
      var date = m.createdAt ? new Date(m.createdAt.seconds * 1000).toLocaleString('ru', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      var isSelf = currentUser && m.authorUid === currentUser.uid;
      var isTeacher = m.role === 'admin';
      var align = isSelf ? 'flex-end' : 'flex-start';
      var bg = isTeacher ? '#e6f1fb' : (isSelf ? '#e8f4f0' : '#f5f0e8');
      var border = isTeacher ? '#3a5ba0' : (isSelf ? '#1a6b5a' : '#d9cfc0');
      var name = m.authorFio || m.authorEmail || '';
      var roleTag = isTeacher ? ' <span style="font-size:.58rem;background:#e6f1fb;color:#3a5ba0;padding:1px 3px;border-radius:3px;font-weight:700">преп.</span>' : '';

      // Track unread admin messages
      if (isTeacher && currentUser) {
        var readBy = m.readBy || {};
        if (!readBy[currentUser.uid]) {
          unreadCount++;
          _unreadAdminMsgIds.push(doc.id);
        }
      }

      html += '<div style="display:flex;justify-content:' + align + ';margin-bottom:5px">';
      html += '<div style="max-width:80%;background:' + bg + ';border:1px solid ' + border + ';border-radius:8px;padding:5px 8px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-bottom:1px">';
      html += '<strong style="font-size:.72rem">' + name + roleTag + '</strong>';
      html += '<span style="font-size:.6rem;color:#9a8d7e;white-space:nowrap">' + date + '</span></div>';
      html += '<div style="font-size:.84rem">' + (m.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>') + '</div>';
      html += '</div></div>';
    });
    if (!html) html = '<p style="text-align:center;color:#9a8d7e;padding:1.5rem;font-size:.82rem">Нет сообщений</p>';
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;

    // Update badge with unread count
    var badge = document.getElementById('cp-chat-badge');
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount + ' новых';
        badge.style.display = '';
      } else if (totalCount > 0) {
        badge.textContent = totalCount;
        badge.style.display = '';
        badge.style.background = '#9a8d7e';
      } else {
        badge.style.display = 'none';
      }
    }

    // If chat is already open, auto-mark as read
    var box = document.getElementById('cp-chat-box');
    if (box && box.style.display !== 'none') {
      markAdminMessagesRead();
    }
  }

  window._sendStudentChat = async function() {
    var input = document.getElementById('cp-chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text || !currentUser || !userGroup) return;

    var fio = currentUser.email;
    try {
      var ud = await db.collection('users').doc(currentUser.uid).get();
      if (ud.exists && ud.data().fio) fio = ud.data().fio;
    } catch(e) {}

    try {
      await db.collection('groups').doc(userGroup).collection('messages').add({
        text: text,
        role: 'student',
        authorEmail: currentUser.email,
        authorFio: fio,
        authorUid: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      input.value = '';
    } catch(e) { alert('Ошибка: ' + e.message); }
  };

  // ===== Auth listener =====
  auth.onAuthStateChanged(async user => {
    currentUser = user;
    const userEl = document.getElementById('cp-user');
    const saveBtn = document.getElementById('cp-save-btn');

    if (user) {
      // Check admin
      if (typeof ADMIN_EMAILS !== 'undefined') {
        isAdmin = Array.isArray(ADMIN_EMAILS) ? ADMIN_EMAILS.includes(user.email) : user.email === ADMIN_EMAILS;
      }

      // Load user group
      try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists && doc.data().group) {
          userGroup = doc.data().group;
        }
      } catch (e) {}

      // Show FIO and group members
      var fio = user.email;
      try {
        var userDoc2 = await db.collection('users').doc(user.uid).get();
        if (userDoc2.exists && userDoc2.data().fio) fio = userDoc2.data().fio;
      } catch(e2) {}
      
      var membersText = '';
      if (userGroup) {
        try {
          var membersSnap = await db.collection('users').where('group', '==', userGroup).get();
          var names = [];
          membersSnap.forEach(function(d) { names.push(d.data().fio || d.data().email); });
          membersText = ' · Участники: ' + names.join(', ');
        } catch(e3) {}
      }
      
      if (userEl) {
        userEl.textContent = fio + (userGroup ? ' · ' + userGroup.replace('group_', 'Группа ') : '') + membersText;
        userEl.style.color = 'var(--green,#22c55e)';
      }
      if (saveBtn) saveBtn.style.display = '';

      // Load repo URL and messages for the group
      if (userGroup) {
        showRepoUrl(userGroup);
        loadGroupMessages(userGroup);
        // Show chat input for logged-in users
        setTimeout(function() {
          var inputWrap = document.getElementById('cp-chat-input-wrap');
          if (inputWrap) inputWrap.style.display = 'flex';
        }, 200);
      }

      // Load saved states
      await loadCheckboxStates();
    } else {
      if (userEl) {
        userEl.textContent = 'Войдите для сохранения прогресса';
        userEl.style.color = '';
      }
      if (saveBtn) saveBtn.style.display = 'none';
    }
  });

  // ===== Unsaved changes warning =====
  window.addEventListener('beforeunload', function(e) {
    if (_isDirty) {
      e.preventDefault();
      e.returnValue = 'У вас есть несохранённые изменения в чек-листе. Покинуть страницу?';
      return e.returnValue;
    }
  });

  // ===== Public API =====
  window.CFDChecklist = {
    saveAll: async function() {
      if (!currentUser || !userGroup) {
        alert('Войдите и убедитесь что вы в группе');
        return;
      }
      var btn = document.getElementById('cp-save-btn');
      var oldText = btn ? btn.textContent : '';
      if (btn) { btn.textContent = 'Сохранение...'; btn.disabled = true; btn.style.opacity = '0.6'; }
      try {
        var saved = 0;
        for (var i = 0; i < checkboxes.length; i++) {
          await saveCheckboxState(checkboxes[i].id, checkboxes[i].el.checked);
          saved++;
          if (btn) btn.textContent = 'Сохранение... ' + saved + '/' + checkboxes.length;
        }
        if (btn) { btn.textContent = 'Сохранено ✓'; btn.style.background = '#22c55e'; }
        _isDirty = false;
        setTimeout(function() {
          if (btn) { btn.textContent = oldText; btn.style.background = ''; btn.disabled = false; btn.style.opacity = ''; }
        }, 2000);
      } catch(e) {
        if (btn) { btn.textContent = 'Ошибка!'; btn.style.background = '#ef4444'; btn.disabled = false; btn.style.opacity = ''; }
        alert('Ошибка сохранения: ' + e.message);
        setTimeout(function() { if (btn) { btn.textContent = oldText; btn.style.background = ''; } }, 3000);
      }
    },

    // For admin: get checklist progress for a group
    getGroupProgress: async function(groupId) {
      try {
        const snap = await db.collection('groups').doc(groupId).collection('checklist').get();
        const items = {};
        snap.forEach(doc => { items[doc.id] = doc.data(); });
        const checked = Object.values(items).filter(v => v.checked).length;
        return { total: checkboxes.length || 72, checked, items };
      } catch (e) {
        return { total: 72, checked: 0, items: {} };
      }
    }
  };

  // ===== Init on DOM ready =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCheckboxes);
  } else {
    initCheckboxes();
  }
})();
