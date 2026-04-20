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
        adminSnap.forEach(function(doc) {
          var num = doc.id.replace('item_','');
          var cb = document.getElementById('chk_' + num);
          if (cb && doc.data().checked) {
            cb.parentElement.style.background = '#e8f4f0';
            cb.parentElement.title = 'Подтверждено преподавателем ✓';
          }
        });
      } catch(e) {}
    }
  }

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
