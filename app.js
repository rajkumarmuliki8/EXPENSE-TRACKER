(function(){
"use strict";

  const EXPENSE_CATEGORIES = [
    {id:'food', name:'Food & Dining', color:'#A63D33'},
    {id:'transport', name:'Transport', color:'#3A5A78'},
    {id:'housing', name:'Housing & Rent', color:'#6B4C7A'},
    {id:'utilities', name:'Utilities', color:'#AD8636'},
    {id:'entertainment', name:'Entertainment', color:'#3F7A78'},
    {id:'health', name:'Health', color:'#3F6B4C'},
    {id:'shopping', name:'Shopping', color:'#7A5C3F'},
    {id:'education', name:'Education', color:'#4A4A8A'},
    {id:'other_exp', name:'Other', color:'#5A5A5A'}
  ];
  const INCOME_CATEGORIES = [
    {id:'salary', name:'Salary / Stipend', color:'#3F6B4C'},
    {id:'allowance', name:'Allowance', color:'#3A5A78'},
    {id:'freelance', name:'Freelance', color:'#AD8636'},
    {id:'other_inc', name:'Other Income', color:'#5A5A5A'}
  ];
  const ALL_CATEGORIES = EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES);
  function catById(id){ return ALL_CATEGORIES.find(c=>c.id===id) || {id:id,name:id,color:'#5A5A5A'}; }

  const ACCOUNT_PALETTE = ['#3A5A78','#AD8636','#3F6B4C','#6B4C7A','#A63D33','#3F7A78','#7A5C3F'];
  const DEFAULT_ACCOUNTS = [
    {id:'cash', name:'Cash', color:'#AD8636'},
    {id:'bank', name:'Bank Account', color:'#3A5A78'}
  ];
  function acctById(id){ return state.accounts.find(a=>a.id===id) || {id:id, name:id, color:'#5A5A5A'}; }
  function nextAccountColor(){
    return ACCOUNT_PALETTE[state.accounts.length % ACCOUNT_PALETTE.length];
  }

  const STORAGE_KEY = 'ledger-state-v1';
  let state = { transactions: [], budgets: {}, accounts: DEFAULT_ACCOUNTS.slice() };
  let currentType = 'expense';
  let editingId = null;
  let charts = {};

  const $ = sel => document.querySelector(sel);
  const $all = sel => Array.from(document.querySelectorAll(sel));
  const fmt = n => '₹' + Number(n).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
  const todayStr = () => new Date().toISOString().slice(0,10);

  function toast(msg){
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(()=>t.classList.remove('show'), 1800);
  }

  // Storage adapter: uses the Claude artifact storage API when running inside
  // Claude.ai, and falls back to the browser's own localStorage when this file
  // is opened directly (double-clicked, or served from disk/your own server).
  const hasClaudeStorage = (typeof window.storage !== 'undefined' && window.storage && typeof window.storage.get === 'function');

  async function loadState(){
    try{
      if(hasClaudeStorage){
        const res = await window.storage.get(STORAGE_KEY, false);
        if(res && res.value){
          const parsed = JSON.parse(res.value);
          state.transactions = parsed.transactions || [];
          state.budgets = parsed.budgets || {};
          state.accounts = (parsed.accounts && parsed.accounts.length) ? parsed.accounts : DEFAULT_ACCOUNTS.slice();
        }
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        if(raw){
          const parsed = JSON.parse(raw);
          state.transactions = parsed.transactions || [];
          state.budgets = parsed.budgets || {};
          state.accounts = (parsed.accounts && parsed.accounts.length) ? parsed.accounts : DEFAULT_ACCOUNTS.slice();
        }
      }
    }catch(e){
      // no existing data yet — start fresh
      state = { transactions: [], budgets: {}, accounts: DEFAULT_ACCOUNTS.slice() };
    }
  }

  let saveTimer = null;
  function saveState(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async ()=>{
      try{
        if(hasClaudeStorage){
          await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }
      }catch(e){
        console.error('Save failed', e);
        toast('Could not save — check connection');
      }
    }, 150);
  }

  // ---------- Nav ----------
  $all('nav.tabs button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $all('nav.tabs button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      $all('.view').forEach(v=>v.classList.remove('active'));
      $('#view-'+btn.dataset.view).classList.add('active');
      if(btn.dataset.view === 'reports') renderReports();
    });
  });

  // ---------- Form setup ----------
  function populateCategorySelect(sel, type){
    sel.innerHTML = '';
    const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    cats.forEach(c=>{
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
  }
  function populateAccountSelect(sel){
    const current = sel.value;
    sel.innerHTML = '';
    state.accounts.forEach(a=>{
      const o = document.createElement('option');
      o.value = a.id; o.textContent = a.name;
      sel.appendChild(o);
    });
    if(current && state.accounts.some(a=>a.id===current)) sel.value = current;
  }
  function refreshAllAccountSelects(){
    populateAccountSelect($('#fAccount'));
    populateAccountSelect($('#fFromAccount'));
    populateAccountSelect($('#fToAccount'));
    if(state.accounts.length > 1) $('#fToAccount').value = state.accounts[1].id;
    populateFilterAccounts();
  }

  populateCategorySelect($('#fCategory'), 'expense');
  populateCategorySelect($('#bCategory'), 'expense');
  $('#fDate').value = todayStr();

  $('#typeExpBtn').addEventListener('click', ()=>setType('expense'));
  $('#typeIncBtn').addEventListener('click', ()=>setType('income'));
  $('#typeXferBtn').addEventListener('click', ()=>setType('transfer'));
  function setType(t){
    currentType = t;
    $('#typeExpBtn').classList.toggle('active', t==='expense');
    $('#typeIncBtn').classList.toggle('active', t==='income');
    $('#typeXferBtn').classList.toggle('active', t==='transfer');
    const isXfer = t==='transfer';
    $('#categoryField').style.display = isXfer ? 'none' : '';
    $('#accountField').style.display = isXfer ? 'none' : '';
    $('#fromAccountField').style.display = isXfer ? '' : 'none';
    $('#toAccountField').style.display = isXfer ? '' : 'none';
    $('#fCategory').required = !isXfer;
    $('#fAccount').required = !isXfer;
    if(!isXfer) populateCategorySelect($('#fCategory'), t);
  }

  $('#entryForm').addEventListener('submit', e=>{
    e.preventDefault();
    const amount = parseFloat($('#fAmount').value);
    if(!amount || amount <= 0){ toast('Enter a valid amount'); return; }
    let entry = {
      id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
      type: currentType,
      date: $('#fDate').value || todayStr(),
      amount: amount,
      note: $('#fNote').value.trim()
    };
    if(currentType === 'transfer'){
      const from = $('#fFromAccount').value, to = $('#fToAccount').value;
      if(from === to){ toast('Pick two different accounts'); return; }
      entry.fromAccount = from;
      entry.toAccount = to;
    } else {
      entry.category = $('#fCategory').value;
      entry.account = $('#fAccount').value;
    }
    if(editingId){
      const idx = state.transactions.findIndex(t=>t.id===editingId);
      if(idx>-1) state.transactions[idx] = entry;
      toast('Entry updated');
      editingId = null;
      $('#submitBtn').textContent = 'Add Entry';
      $('#formTitle').textContent = 'Add Entry';
    } else {
      state.transactions.push(entry);
      toast('Entry added');
    }
    saveState();
    $('#entryForm').reset();
    $('#fDate').value = todayStr();
    setType('expense');
    refreshAllAccountSelects();
    renderAll();
  });

  function startEdit(id){
    const t = state.transactions.find(x=>x.id===id);
    if(!t) return;
    editingId = id;
    setType(t.type);
    $('#fDate').value = t.date;
    $('#fAmount').value = t.amount;
    $('#fNote').value = t.note || '';
    if(t.type === 'transfer'){
      $('#fFromAccount').value = t.fromAccount;
      $('#fToAccount').value = t.toAccount;
    } else {
      $('#fCategory').value = t.category;
      $('#fAccount').value = t.account;
    }
    $('#submitBtn').textContent = 'Update Entry';
    $('#formTitle').textContent = 'Edit Entry';
    $('[data-view="transactions"]').click();
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function deleteEntry(id){
    state.transactions = state.transactions.filter(t=>t.id!==id);
    saveState();
    toast('Entry deleted');
    renderAll();
  }

  // ---------- Filters ----------
  function populateFilterCategories(){
    const sel = $('#fltCategory');
    sel.innerHTML = '<option value="all">All</option>';
    ALL_CATEGORIES.forEach(c=>{
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    });
  }
  function populateFilterAccounts(){
    const sel = $('#fltAccount');
    const current = sel.value;
    sel.innerHTML = '<option value="all">All</option>';
    state.accounts.forEach(a=>{
      const o = document.createElement('option');
      o.value = a.id; o.textContent = a.name;
      sel.appendChild(o);
    });
    if(current && (current==='all' || state.accounts.some(a=>a.id===current))) sel.value = current;
  }

  populateFilterCategories();
  ['fltSearch','fltType','fltCategory','fltAccount','fltFrom','fltTo','fltSort'].forEach(id=>{
    $('#'+id).addEventListener('input', renderTransactionsTable);
    $('#'+id).addEventListener('change', renderTransactionsTable);
  });
  $('#clearFilters').addEventListener('click', ()=>{
    $('#fltSearch').value=''; $('#fltType').value='all'; $('#fltCategory').value='all';
    $('#fltAccount').value='all'; $('#fltFrom').value=''; $('#fltTo').value=''; $('#fltSort').value='date-desc';
    renderTransactionsTable();
  });

  function txAccountsText(t){
    if(t.type==='transfer') return acctById(t.fromAccount).name + ' → ' + acctById(t.toAccount).name;
    return acctById(t.account).name;
  }

  function getFilteredTransactions(){
    let list = state.transactions.slice();
    const q = $('#fltSearch').value.trim().toLowerCase();
    const type = $('#fltType').value;
    const cat = $('#fltCategory').value;
    const acct = $('#fltAccount').value;
    const from = $('#fltFrom').value;
    const to = $('#fltTo').value;
    const sort = $('#fltSort').value;
    if(q) list = list.filter(t => (t.note||'').toLowerCase().includes(q)
      || (t.category ? catById(t.category).name.toLowerCase().includes(q) : false)
      || txAccountsText(t).toLowerCase().includes(q));
    if(type !== 'all') list = list.filter(t=>t.type===type);
    if(cat !== 'all') list = list.filter(t=>t.category===cat);
    if(acct !== 'all') list = list.filter(t=> t.type==='transfer' ? (t.fromAccount===acct || t.toAccount===acct) : t.account===acct);
    if(from) list = list.filter(t=>t.date >= from);
    if(to) list = list.filter(t=>t.date <= to);
    list.sort((a,b)=>{
      if(sort==='date-desc') return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
      if(sort==='date-asc') return a.date.localeCompare(b.date);
      if(sort==='amt-desc') return b.amount - a.amount;
      if(sort==='amt-asc') return a.amount - b.amount;
      return 0;
    });
    return list;
  }

  function txRowHtml(t, withActions){
    const isXfer = t.type === 'transfer';
    const catCell = isXfer
      ? `<span class="cat-chip"><span class="dot" style="background:var(--purple)"></span>Transfer</span>`
      : (()=>{ const c = catById(t.category); return `<span class="cat-chip"><span class="dot" style="background:${c.color}"></span>${c.name}</span>`; })();
    const amtClass = isXfer ? '' : (t.type==='income'?'in':'out');
    const amtSign = isXfer ? '' : (t.type==='income'?'+':'−');
    return `<tr>
      <td>${t.date}</td>
      <td>${catCell}</td>
      <td>${txAccountsText(t)}</td>
      <td>${t.note ? escapeHtml(t.note) : '<span class="hint">—</span>'}</td>
      <td class="amt ${amtClass}">${amtSign}${fmt(t.amount)}</td>
      ${withActions ? `<td class="row-actions">
        <button data-edit="${t.id}" title="Edit">✎</button>
        <button data-del="${t.id}" title="Delete">✕</button>
      </td>` : ''}
    </tr>`;
  }
  function escapeHtml(s){
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function renderTransactionsTable(){
    const list = getFilteredTransactions();
    const tbody = $('#txTable tbody');
    tbody.innerHTML = list.map(t=>txRowHtml(t, true)).join('');
    $('#txEmpty').style.display = list.length ? 'none' : 'block';
    tbody.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>startEdit(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>deleteEntry(b.dataset.del)));
  }

  // ---------- Overview ----------
  function monthKey(d){ return d.slice(0,7); }
  function thisMonthKey(){ return todayStr().slice(0,7); }

  function computeStats(){
    const mk = thisMonthKey();
    let allIn=0, allOut=0, mIn=0, mOut=0;
    state.transactions.forEach(t=>{
      if(t.type==='income'){ allIn += t.amount; if(monthKey(t.date)===mk) mIn += t.amount; }
      else if(t.type==='expense'){ allOut += t.amount; if(monthKey(t.date)===mk) mOut += t.amount; }
    });
    return {allIn, allOut, mIn, mOut, balance: allIn-allOut, count: state.transactions.length};
  }

  function accountBalance(acctId){
    let bal = 0;
    state.transactions.forEach(t=>{
      if(t.type==='income' && t.account===acctId) bal += t.amount;
      else if(t.type==='expense' && t.account===acctId) bal -= t.amount;
      else if(t.type==='transfer'){
        if(t.fromAccount===acctId) bal -= t.amount;
        if(t.toAccount===acctId) bal += t.amount;
      }
    });
    return bal;
  }

  function renderAccountBalances(){
    const row = $('#acctBalanceRow');
    row.innerHTML = state.accounts.map(a=>{
      const bal = accountBalance(a.id);
      return `<div class="acct-card" style="border-left-color:${a.color}">
        <div class="k"><span class="dot" style="background:${a.color}"></span>${a.name}</div>
        <div class="v ${bal<0?'negative':''}">${fmt(bal)}</div>
      </div>`;
    }).join('');
  }

  function renderOverview(){
    const s = computeStats();
    $('#stampAmt').textContent = fmt(Math.abs(s.balance));
    const stampEl = $('#stamp');
    stampEl.classList.toggle('negative', s.balance < 0);
    $('#mIncome').textContent = fmt(s.mIn);
    $('#mExpense').textContent = fmt(s.mOut);
    const rate = s.mIn > 0 ? Math.round(((s.mIn - s.mOut)/s.mIn)*100) : 0;
    $('#mSaveRate').textContent = rate + '%';
    $('#aIncome').textContent = fmt(s.allIn);
    $('#aExpense').textContent = fmt(s.allOut);
    $('#aCount').textContent = s.count;
    $('#monthLabel').textContent = '(' + new Date().toLocaleString('en-IN',{month:'long', year:'numeric'}) + ')';

    const recent = state.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,6);
    $('#recentTable tbody').innerHTML = recent.map(t=>txRowHtml(t,false)).join('');
    $('#recentEmpty').style.display = recent.length ? 'none' : 'block';

    renderAccountBalances();
    try{ renderCatChart(); }catch(e){ console.error('Category chart failed', e); }
    try{ renderTrendChart(); }catch(e){ console.error('Trend chart failed', e); }
  }

  function renderCatChart(){
    if(typeof Chart === 'undefined') return;
    const mk = thisMonthKey();
    const totals = {};
    state.transactions.filter(t=>t.type==='expense' && monthKey(t.date)===mk).forEach(t=>{
      totals[t.category] = (totals[t.category]||0) + t.amount;
    });
    const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
    const ctx = $('#catChart').getContext('2d');
    if(charts.cat) charts.cat.destroy();
    if(!entries.length){
      charts.cat = null;
      ctx.clearRect(0,0,9999,9999);
      return;
    }
    charts.cat = new Chart(ctx, {
      type:'doughnut',
      data:{
        labels: entries.map(e=>catById(e[0]).name),
        datasets:[{ data: entries.map(e=>e[1]), backgroundColor: entries.map(e=>catById(e[0]).color), borderColor:'#F3EDDC', borderWidth:2 }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'right', labels:{ font:{family:"'IBM Plex Mono'", size:10}, boxWidth:10, color:'#212E3D' } } }
      }
    });
  }

  function lastNMonths(n){
    const arr = [];
    const d = new Date();
    d.setDate(1);
    for(let i=n-1;i>=0;i--){
      const dd = new Date(d.getFullYear(), d.getMonth()-i, 1);
      arr.push(dd.toISOString().slice(0,7));
    }
    return arr;
  }

  function renderTrendChart(){
    if(typeof Chart === 'undefined') return;
    const months = lastNMonths(6);
    const inc = months.map(m => state.transactions.filter(t=>t.type==='income'&&monthKey(t.date)===m).reduce((a,t)=>a+t.amount,0));
    const exp = months.map(m => state.transactions.filter(t=>t.type==='expense'&&monthKey(t.date)===m).reduce((a,t)=>a+t.amount,0));
    const labels = months.map(m=>{ const [y,mo]=m.split('-'); return new Date(y,mo-1,1).toLocaleString('en-IN',{month:'short'}); });
    const ctx = $('#trendChart').getContext('2d');
    if(charts.trend) charts.trend.destroy();
    charts.trend = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[
        {label:'Income', data:inc, borderColor:'#3F6B4C', backgroundColor:'rgba(63,107,76,0.12)', tension:0.3, fill:true},
        {label:'Expense', data:exp, borderColor:'#A63D33', backgroundColor:'rgba(166,61,51,0.12)', tension:0.3, fill:true}
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ font:{family:"'IBM Plex Mono'", size:10}, color:'#212E3D' } } },
        scales:{ x:{ ticks:{font:{family:"'IBM Plex Mono'", size:10}} }, y:{ ticks:{font:{family:"'IBM Plex Mono'", size:10}} } }
      }
    });
  }

  // ---------- Accounts ----------
  $('#addAccountBtn').addEventListener('click', ()=>{
    const name = $('#acctName').value.trim();
    if(!name){ toast('Enter an account name'); return; }
    const id = 'acct_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    state.accounts.push({id, name, color: nextAccountColor()});
    saveState();
    $('#acctName').value = '';
    refreshAllAccountSelects();
    renderAccounts();
    renderAccountBalances();
    toast('Account added');
  });

  function renameAccount(id){
    const a = state.accounts.find(x=>x.id===id);
    if(!a) return;
    const name = prompt('Rename account', a.name);
    if(!name || !name.trim()) return;
    a.name = name.trim();
    saveState();
    refreshAllAccountSelects();
    renderAccounts();
    renderAll();
  }

  function deleteAccount(id){
    if(state.accounts.length <= 1){ toast('You need at least one account'); return; }
    const inUse = state.transactions.some(t => t.account===id || t.fromAccount===id || t.toAccount===id);
    if(inUse){ toast('Move or delete its entries first'); return; }
    state.accounts = state.accounts.filter(a=>a.id!==id);
    saveState();
    refreshAllAccountSelects();
    renderAccounts();
    renderAccountBalances();
    toast('Account removed');
  }

  function renderAccounts(){
    const list = $('#accountList');
    list.innerHTML = state.accounts.map(a=>{
      const bal = accountBalance(a.id);
      return `<div class="account-item">
        <span class="cat-chip"><span class="dot" style="background:${a.color}"></span>${escapeHtml(a.name)}</span>
        <span class="budget-amt">${fmt(bal)}</span>
        <button class="btn ghost small" data-rename="${a.id}">Rename</button>
        <button class="btn ghost small" data-rmacct="${a.id}">Delete</button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-rename]').forEach(b=>b.addEventListener('click', ()=>renameAccount(b.dataset.rename)));
    list.querySelectorAll('[data-rmacct]').forEach(b=>b.addEventListener('click', ()=>deleteAccount(b.dataset.rmacct)));
  }

  // ---------- Budgets ----------
  $('#addBudgetBtn').addEventListener('click', ()=>{
    const cat = $('#bCategory').value;
    const limit = parseFloat($('#bLimit').value);
    if(!limit || limit <= 0){ toast('Enter a valid limit'); return; }
    state.budgets[cat] = limit;
    saveState();
    $('#bLimit').value = '';
    toast('Budget set');
    renderBudgets();
  });

  function renderBudgets(){
    const mk = thisMonthKey();
    const list = $('#budgetList');
    const entries = Object.entries(state.budgets);
    $('#budgetEmpty').style.display = entries.length ? 'none' : 'block';
    list.innerHTML = entries.map(([catId, limit])=>{
      const c = catById(catId);
      const spent = state.transactions.filter(t=>t.type==='expense'&&t.category===catId&&monthKey(t.date)===mk).reduce((a,t)=>a+t.amount,0);
      const pct = Math.min(100, Math.round((spent/limit)*100));
      let color = 'var(--green)';
      if(pct >= 100) color = 'var(--red)';
      else if(pct >= 70) color = 'var(--gold)';
      return `<div class="budget-item">
        <span class="cat-chip"><span class="dot" style="background:${c.color}"></span>${c.name}</span>
        <div class="gauge"><div style="width:${pct}%; background:${color};"></div></div>
        <span class="budget-amt">${fmt(spent)} / ${fmt(limit)}</span>
        <button class="btn ghost small" data-rm="${catId}">Remove</button>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click', ()=>{
      delete state.budgets[b.dataset.rm];
      saveState(); renderBudgets(); toast('Budget removed');
    }));
  }

  // ---------- Reports ----------
  function renderReports(){
    if(typeof Chart === 'undefined') return;
    const months = lastNMonths(6);
    const inc = months.map(m => state.transactions.filter(t=>t.type==='income'&&monthKey(t.date)===m).reduce((a,t)=>a+t.amount,0));
    const exp = months.map(m => state.transactions.filter(t=>t.type==='expense'&&monthKey(t.date)===m).reduce((a,t)=>a+t.amount,0));
    const labels = months.map(m=>{ const [y,mo]=m.split('-'); return new Date(y,mo-1,1).toLocaleString('en-IN',{month:'short', year:'2-digit'}); });
    const ctx1 = $('#reportBarChart').getContext('2d');
    if(charts.reportBar) charts.reportBar.destroy();
    charts.reportBar = new Chart(ctx1, {
      type:'bar',
      data:{ labels, datasets:[
        {label:'Income', data:inc, backgroundColor:'#3F6B4C'},
        {label:'Expense', data:exp, backgroundColor:'#A63D33'}
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ labels:{font:{family:"'IBM Plex Mono'", size:10}} } },
        scales:{ x:{ ticks:{font:{family:"'IBM Plex Mono'", size:10}} }, y:{ ticks:{font:{family:"'IBM Plex Mono'", size:10}} } }
      }
    });

    const mk = thisMonthKey();
    const totals = {};
    state.transactions.filter(t=>t.type==='expense'&&monthKey(t.date)===mk).forEach(t=>{ totals[t.category]=(totals[t.category]||0)+t.amount; });
    const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
    $('#reportScopeLabel').textContent = '(' + new Date().toLocaleString('en-IN',{month:'long', year:'numeric'}) + ')';
    const ctx2 = $('#reportCatChart').getContext('2d');
    if(charts.reportCat) charts.reportCat.destroy();
    if(entries.length){
      charts.reportCat = new Chart(ctx2, {
        type:'bar',
        data:{ labels: entries.map(e=>catById(e[0]).name), datasets:[{ data: entries.map(e=>e[1]), backgroundColor: entries.map(e=>catById(e[0]).color) }] },
        options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{display:false} },
          scales:{ x:{ ticks:{font:{family:"'IBM Plex Mono'", size:10}} }, y:{ ticks:{font:{family:"'IBM Plex Mono'", size:10}} } }
        }
      });
    } else {
      ctx2.clearRect(0,0,9999,9999);
    }
  }

  $('#exportCsvBtn').addEventListener('click', ()=>{
    if(!state.transactions.length){ toast('No entries to export'); return; }
    const rows = [['Date','Type','Category','Account','Amount','Note']];
    state.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>{
      const cat = t.type==='transfer' ? 'Transfer' : catById(t.category).name;
      rows.push([t.date, t.type, cat, txAccountsText(t), t.amount, (t.note||'').replace(/"/g,'""')]);
    });
    const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ledger-export.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('CSV exported');
  });

  $('#exportJsonBtn').addEventListener('click', ()=>{
    const payload = { transactions: state.transactions, budgets: state.budgets, accounts: state.accounts, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ledger-backup-' + todayStr() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  });

  $('#restoreBtnTrigger').addEventListener('click', ()=> $('#restoreInput').click());
  $('#restoreInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const parsed = JSON.parse(reader.result);
        if(!Array.isArray(parsed.transactions)) throw new Error('Not a valid backup file');
        if(!confirm('Replace all current data with this backup?')) { e.target.value=''; return; }
        state.transactions = parsed.transactions || [];
        state.budgets = parsed.budgets || {};
        state.accounts = (parsed.accounts && parsed.accounts.length) ? parsed.accounts : DEFAULT_ACCOUNTS.slice();
        saveState();
        refreshAllAccountSelects();
        renderAll();
        toast('Backup restored');
      }catch(err){
        toast('Could not read that file');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  $('#resetBtn').addEventListener('click', async ()=>{
    if(!confirm('Clear all transactions, budgets, and accounts? This cannot be undone.')) return;
    state = { transactions: [], budgets: {}, accounts: DEFAULT_ACCOUNTS.slice() };
    saveState();
    refreshAllAccountSelects();
    renderAccounts();
    renderAll();
    toast('All data cleared');
  });

  function renderAll(){
    renderOverview();
    renderTransactionsTable();
    renderBudgets();
    renderAccounts();
    if($('#view-reports').classList.contains('active')) renderReports();
  }

  // ---------- Init ----------
  (async function init(){
    await loadState();
    refreshAllAccountSelects();
    renderAll();
  })();
})();
