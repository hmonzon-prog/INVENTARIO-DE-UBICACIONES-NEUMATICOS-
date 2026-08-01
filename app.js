let currentUser = null;

function handleLogin(e) {
  if (e) e.preventDefault();
  const userEl = safeGetEl('loginUser');
  const passEl = safeGetEl('loginPass');
  const errorEl = safeGetEl('loginError');
  if (!userEl || !passEl || !errorEl) return false;
  const user = userEl.value.trim().toLowerCase();
  const pass = passEl.value;
  if (!user || !pass) {
    errorEl.textContent = 'Completá usuario y clave';
    return false;
  }
  const found = USUARIOS_CONFIG.find(u => u.user === user && u.pass === pass);
  if (found) {
    currentUser = found;
    localStorage.setItem('obInvUser', JSON.stringify(found));
    showApp();
  } else {
    errorEl.textContent = 'Usuario o clave incorrectos';
    passEl.value = '';
    passEl.focus();
  }
  return false;
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem('obInvUser');
  safeGetEl('loginScreen').style.display = 'flex';
  safeGetEl('appMain').style.display = 'none';
  safeGetEl('loginUser').value = '';
  safeGetEl('loginPass').value = '';
  safeGetEl('loginError').textContent = '';
}

function showApp() {
  safeGetEl('loginScreen').style.display = 'none';
  safeGetEl('appMain').style.display = 'block';
  safeText(safeGetEl('currentUser'), '👤 ' + currentUser.nombre);
  renderMapa();
  initFromFirestore();
}

function checkSession() {
  try {
    const saved = localStorage.getItem('obInvUser');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.user && parsed.nombre) {
        currentUser = parsed;
        showApp();
        return;
      }
    }
  } catch(e) {}
  safeGetEl('loginScreen').style.display = 'flex';
  safeGetEl('appMain').style.display = 'none';
}

const zonas = ZONAS_CONFIG.map(z => ({...z, inv: 0, occ: 0}));
const invData = {...LOCACIONES_CONFIG};

let stockData = {};
let currentView = 'inv';
let chartGeneral, chartZonas, chartBar, chartRanking;

let db = null;
try {
  const firebaseConfig = {
    apiKey: "AIzaSyC8fogrQeHgkC-7k_h0NHE6Lj5-qYRsO64",
    authDomain: "prode-mundial-2026-8ae43.firebaseapp.com",
    projectId: "prode-mundial-2026-8ae43",
    storageBucket: "prode-mundial-2026-8ae43.firebasestorage.app",
    messagingSenderId: "1058801947988",
    appId: "1:1058801947988:web:4a826fd7f412f05ec274d5"
  };
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }
} catch(e) { console.error('Firebase init error:', e); }

function saveData() {
  try {
    localStorage.setItem('obInvData', JSON.stringify(invData));
    localStorage.setItem('obInvLog', JSON.stringify(changeLog));
  } catch(e) {
    console.error('localStorage write error:', e);
    showToast('No se pudieron guardar los datos localmente. El almacenamiento está lleno.', 'error');
  }
  if (db) {
    db.collection('inventario').doc('ubicaciones').set({ data: invData }, { merge: true })
      .catch(err => {
        console.error('Firestore write error:', err);
        showToast('Error al sincronizar con el servidor. Los datos se guardan localmente.', 'warning', 4000);
      });
    db.collection('inventario').doc('log').set({ data: changeLog.slice(-200) }, { merge: true })
      .catch(err => console.error('Log write error:', err));
  }
}
let unsubscribe = null;
function startFirestoreListener() {
  if (!db) return;
  unsubscribe = db.collection('inventario').doc('ubicaciones').onSnapshot((doc) => {
    if (doc.exists) {
      const remoteData = doc.data().data;
      if (remoteData) {
        let changed = false;
        for (const k in remoteData) {
          if (k in invData && invData[k] !== remoteData[k]) {
            invData[k] = remoteData[k];
            changed = true;
          }
        }
        if (changed) refreshAll();
      }
    }
  }, (error) => {
    console.error('Firestore listener error:', error);
    if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
      showToast('Conexión lenta con el servidor. Los cambios se guardan localmente.', 'warning', 5000);
    }
  });
}
function safeLoadFromStorage(saved) {
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const valid = {};
    for (const k in parsed) {
      if (k in invData && (parsed[k] === 0 || parsed[k] === 1)) {
        valid[k] = parsed[k];
      }
    }
    return Object.keys(valid).length > 0 ? valid : null;
  } catch(e) {
    console.error('Error parseando datos guardados:', e);
    return null;
  }
}

async function initFromFirestore() {
  try {
    if (db) {
      const docRef = db.collection('inventario').doc('ubicaciones');
      const doc = await docRef.get();
      if (doc.exists) {
        const remoteData = doc.data().data;
        if (remoteData && typeof remoteData === 'object' && !Array.isArray(remoteData)) {
          for (const k in remoteData) {
            if (k in invData && (remoteData[k] === 0 || remoteData[k] === 1)) {
              invData[k] = remoteData[k];
            }
          }
        }
        await docRef.set({ data: invData }, { merge: true });
      } else {
        await docRef.set({ data: invData });
      }
      const logDoc = await db.collection('inventario').doc('log').get();
      if (logDoc.exists && logDoc.data().data) {
        changeLog = logDoc.data().data;
      }
    } else {
      const loaded = safeLoadFromStorage(localStorage.getItem('obInvData'));
      if (loaded) {
        for (const k in loaded) invData[k] = loaded[k];
      }
      try {
        const savedLog = localStorage.getItem('obInvLog');
        if (savedLog) changeLog = JSON.parse(savedLog);
      } catch(e) {}
    }
  } catch (err) {
    console.error('Firestore init error:', err);
    showToast('No se pudo conectar al servidor. Trabajando sin conexión.', 'warning');
    try {
      const loaded = safeLoadFromStorage(localStorage.getItem('obInvData'));
      if (loaded) {
        for (const k in loaded) invData[k] = loaded[k];
        showToast('Datos cargados desde almacenamiento local.', 'info', 3000);
      }
      const savedLog = localStorage.getItem('obInvLog');
      if (savedLog) changeLog = JSON.parse(savedLog);
    } catch(e) {
      console.error('localStorage fallback error:', e);
    }
  }
  startFirestoreListener();
  refreshAll();
}
let changeLog = [];

function getLastMark(key) {
  for (let i = changeLog.length - 1; i >= 0; i--) {
    if (changeLog[i].ubicacion === key && changeLog[i].accion === 'marcada') {
      return changeLog[i];
    }
  }
  return null;
}

function toggleLoc(key) {
  try {
    if (!(key in invData)) return;
    if (!currentUser) {
      showToast('Tenés que estar logueado para hacer cambios.', 'error');
      return;
    }
    const oldVal = invData[key];
    invData[key] = oldVal === 1 ? 0 : 1;
    changeLog.push({
      ubicacion: key,
      accion: invData[key] === 1 ? 'marcada' : 'desmarcada',
      usuario: currentUser.nombre,
      fecha: new Date().toISOString()
    });
    saveData();
    refreshAll();
  } catch(e) { console.error('toggleLoc error:', e); }
}

function getStatus(nave, letra, num) {
  if (letra === 'M') { const n = ('0'+num).slice(-2); return invData['N2-M'+n] === 1 ? 1 : invData['N2-M'+n] === 0 ? 0 : -1; }
  const key = 'N'+nave+'-'+letra+('0'+num).slice(-2);
  return invData[key] === 1 ? 1 : invData[key] === 0 ? 0 : -1;
}
function getNums(nave, letra) {
  const nums = [], prefix = 'N'+nave+'-'+letra;
  for (const key in invData) if (key.startsWith(prefix)) nums.push(parseInt(key.replace(prefix,'')));
  return nums.sort((a,b)=>a-b);
}
function hasStock(nave, letra, num) {
  const key = 'N'+nave+'-'+letra+('0'+num).slice(-2);
  return stockData[key] === true;
}

function setView(v) {
  currentView = v;
  document.querySelectorAll('.view-toggle button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  refreshAll();
}

function limpiarStock() {
  stockData = {};
  const fileInput = safeGetEl('stockFile');
  if (fileInput) fileInput.value = '';
  const st = safeGetEl('uploadStatus');
  if (st) {
    st.textContent = 'Sin archivo cargado';
    st.className = 'status';
  }
  const btn = safeGetEl('btnLimpiar');
  if (btn) btn.disabled = true;
  refreshAll();
}

function normalizarLoc(loc) {
  if (!loc || typeof loc !== 'string') return null;
  let s = loc.toUpperCase().trim().replace(/\s+/g, '');
  s = s.replace(/NAVE/g, 'N').replace(/-/g, '');
  let m = s.match(/N(\d+)([A-Z])(\d+)/);
  if (!m) m = s.match(/(\d+)([A-Z])(\d+)/);
  if (m) {
    const nave = parseInt(m[1]), letra = m[2], num = parseInt(m[3]);
    if (nave >= 1 && nave <= 2 && letra.length === 1 && num >= 1 && num <= 99) {
      const key = 'N'+nave+'-'+letra+('0'+num).slice(-2);
      if (key in invData) return key;
    }
  }
  return null;
}

function safeGetEl(id) {
  return document.getElementById(id);
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function safePct(val, total) {
  if (!total || total === 0) return 0;
  return (val / total * 100);
}

function safeText(el, text) {
  if (el) el.textContent = text;
}

function safeHtml(el, html) {
  if (el) el.innerHTML = html;
}

function showToast(msg, type = 'info', duration = 4000) {
  const container = safeGetEl('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fadeOut');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const st = safeGetEl('uploadStatus');
  if (!st) return;

  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'xlsx' && ext !== 'xls') {
    st.textContent = '✕ Formato no válido. Seleccioná un archivo .xlsx o .xls';
    st.className = 'status err';
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    st.textContent = '✕ El archivo es muy grande (máx 10MB).';
    st.className = 'status err';
    return;
  }

  st.textContent = 'Leyendo archivo...';
  st.className = 'status';
  safeGetEl('btnLimpiar').disabled = true;

  const reader = new FileReader();
  reader.onerror = function() {
    st.textContent = '✕ Error al leer el archivo. Probá con otro.';
    st.className = 'status err';
  };
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      if (data.length === 0) {
        st.textContent = '✕ El archivo está vacío.';
        st.className = 'status err';
        return;
      }
      const workbook = XLSX.read(data, {type:'array'});
      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        st.textContent = '✕ No se encontraron hojas en el archivo.';
        st.className = 'status err';
        return;
      }

      const stockMap = {};
      let totalRowCount = 0, matchedCount = 0;
      const sheetsInfo = [];

      workbook.SheetNames.forEach(sname => {
        const ws = workbook.Sheets[sname];
        const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        if (aoa.length < 2) return;

        let headerRowIdx = -1, colLoc = -1, colQty = -1;

        for (let i = 0; i < Math.min(aoa.length, 30); i++) {
          const row = aoa[i];
          const rowStr = row.map(String);
          let foundLoc = false, foundQty = false;
          let locIdx = -1, qtyIdx = -1;

          rowStr.forEach((cell, ci) => {
            const cl = cell.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            if (!foundLoc && (cl.includes('ubicacion') || (cl.includes('ubic') && !cl.includes('fecha')))) { locIdx = ci; foundLoc = true; }
            if (!foundQty && (cl.includes('cantidad') || cl.includes('qty') || (cl.includes('stock') && !cl.includes('sku')) || cl.includes('existencia'))) { qtyIdx = ci; foundQty = true; }
          });

          if (foundLoc) { headerRowIdx = i; colLoc = locIdx; colQty = qtyIdx; break; }
        }

        if (headerRowIdx < 0) {
          for (let i = 0; i < Math.min(aoa.length, 50); i++) {
            const row = aoa[i];
            for (let j = 0; j < row.length; j++) {
              const val = String(row[j]).toUpperCase().trim().replace(/[\s-]/g, '');
              if (/^N?[12][A-Z]\d{2,3}$/.test(val)) { headerRowIdx = Math.max(0, i - 1); colLoc = j; break; }
            }
            if (headerRowIdx >= 0 && colLoc >= 0) break;
          }
          if (headerRowIdx < 0) { headerRowIdx = 0; colLoc = 0; }
        }

        let sheetMatched = 0;
        for (let i = headerRowIdx + 1; i < aoa.length; i++) {
          const row = aoa[i];
          const rawLoc = String(row[colLoc] || '').trim();
          if (!rawLoc) continue;

          const norm = normalizarLoc(rawLoc);
          if (!norm) continue;

          totalRowCount++;
          let qty = 0;
          if (colQty >= 0 && colQty < row.length) qty = parseFloat(String(row[colQty]).replace(',', '.')) || 0;
          else qty = 1;

          if (qty > 0) { stockMap[norm] = true; matchedCount++; sheetMatched++; }
        }

        if (sheetMatched > 0) sheetsInfo.push(sname + ': ' + sheetMatched + ' locs');
      });

      stockData = Object.keys(stockMap).length > 0 ? stockMap : {};
      if (Object.keys(stockData).length > 0) {
        st.textContent = '✓ ' + Object.keys(stockData).length + ' ubicaciones ocupadas. ' + sheetsInfo.join(' | ');
        st.className = 'status ok';
        showToast(Object.keys(stockData).length + ' ubicaciones cargadas correctamente.', 'success', 3000);
      } else {
        st.textContent = totalRowCount > 0
          ? 'Se leyeron ' + totalRowCount + ' filas pero ninguna ubicación coincide con el layout. Revisá el formato (ej: N2-G14, N1-A02).'
          : 'No se encontraron datos de ubicaciones. Verificá que el Excel tenga una columna "Ubicación".';
        st.className = 'status err';
        showToast('No se encontraron ubicaciones válidas en el archivo.', 'error');
      }
      safeGetEl('btnLimpiar').disabled = false;
      refreshAll();

    } catch(err) {
      console.error('Excel parse error:', err);
      let errorMsg = 'Error al leer el archivo.';
      if (err.message && err.message.includes('Cannot read')) {
        errorMsg += ' El archivo parece estar dañado. Exportalo de nuevo.';
      } else if (err.message && err.message.includes('Unsupported')) {
        errorMsg += ' Formato no soportado. Usá .xlsx o .xls.';
      } else {
        errorMsg += ' Verificá que sea un archivo de Excel válido.';
      }
      st.textContent = errorMsg;
      st.className = 'status err';
      showToast(errorMsg, 'error', 5000);
    }
  };
  reader.readAsArrayBuffer(file);
}

function cargarEjemplo() {
  const sampleLocs = ['N2-C11','N2-C13','N2-E09','N2-F02','N2-F14','N2-C05','N2-E01','N2-F04','N2-F12','N2-B12','N2-B14','N2-B16','N2-H01','N2-H03','N2-H05','N2-H07','N2-H09','N2-H11','N2-H13','N2-H15','N2-G01','N2-G02','N2-G03','N2-G04','N2-G05','N2-G06','N2-G07','N2-G08','N2-G09','N2-G10','N2-G11','N2-G12','N2-G13','N2-G14','N1-A10','N2-A09','N2-J05','N2-J07','N2-M01','N2-M02','N2-M03','N2-M04','N2-M05','N2-I02','N2-I06'];
  stockData = {};
  sampleLocs.forEach(l => { stockData[l] = true; });
  const st = safeGetEl('uploadStatus');
  if (st) {
    st.textContent = '✓ Ejemplo cargado: ' + sampleLocs.length + ' ubicaciones ocupadas (simulado)';
    st.className = 'status ok';
  }
  const btn = safeGetEl('btnLimpiar');
  if (btn) btn.disabled = false;
  refreshAll();
}

function descargarInventariadas() {
  const inv = Object.keys(invData).filter(k => invData[k] === 1).sort();
  if (inv.length === 0) { alert('No hay ubicaciones inventariadas.'); return; }
  const data = [['Ubicación', 'Estado']];
  inv.forEach(k => data.push([k, 'Inventariado']));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventariadas');
  XLSX.writeFile(wb, 'ubicaciones_inventariadas.xlsx');
}

function recalcZonas() {
  for (const z of zonas) {
    z.inv = 0;
    for (const k in invData) if (k.startsWith(z.name) && invData[k] === 1) z.inv++;
  }
}
function calcOcupacion() {
  for (const z of zonas) {
    z.occ = 0;
    for (const k in invData) if (k.startsWith(z.name) && stockData[k] === true) z.occ++;
  }
}

function renderMapa() {
  function getDotColors(invStatus, hasStockFlag) {
    if (currentView === 'inv') {
      if (invStatus === 1) return {bg:'#0f9d58', fg:'#fff', border:'#0f9d58'};
      if (invStatus === 0) return {bg:'#ea4335', fg:'#fff', border:'#ea4335'};
      return {bg:'#cfd8dc', fg:'#78909c', border:'#cfd8dc'};
    } else {
      if (hasStockFlag) return {bg:'#1565c0', fg:'#fff', border:'#0d47a1'};
      return {bg:'#eeeeee', fg:'#9e9e9e', border:'#e0e0e0'};
    }
  }

  function buildBloqueF(nave) {
    const nums = getNums(nave, 'F');
    const evens = nums.filter(n => n%2===0).sort((a,b)=>b-a);
    const odds = nums.filter(n => n%2===1).sort((a,b)=>b-a);
    let h = '<div class="pasillo-block-vertical">';
    h += '<div class="pb-header"><strong>F</strong></div>';
    h += '<div class="pb-with-calle">';
    h += '<div class="pb-col">';
    odds.forEach(n => { h += renderDot(nave, 'F', n, 'right'); });
    h += '</div>';
    h += '<div class="pasillo-line"></div>';
    h += '<div class="pb-col">';
    evens.forEach(n => { h += renderDot(nave, 'F', n, 'left'); });
    h += '</div>';
    h += '</div></div>';
    return h;
  }

  function buildBloqueParImpar(letra, nave) {
    const nums = getNums(nave, letra);
    const evens = nums.filter(n => n%2===0).sort((a,b)=>b-a);
    const odds = nums.filter(n => n%2===1).sort((a,b)=>b-a);
    let h = '<div class="pasillo-block-vertical">';
    h += '<div class="pb-header"><strong>'+sanitize(letra)+'</strong></div>';
    h += '<div class="pb-with-calle">';
    h += '<div class="pb-col">';
    odds.forEach(n => { h += renderDot(nave, letra, n, 'right'); });
    h += '</div>';
    h += '<div class="pasillo-line"></div>';
    h += '<div class="pb-col">';
    evens.forEach(n => { h += renderDot(nave, letra, n, 'left'); });
    h += '</div>';
    h += '</div></div>';
    return h;
  }

  function buildBlock(nave, letra) {
    const zona = zonas.find(z => z.name === 'N'+nave+'-'+letra);
    if (!zona) return '';
    const nums = getNums(nave, letra);
    const odds = nums.filter(n => n%2===1).sort((a,b)=>b-a);
    const evens = nums.filter(n => n%2===0).sort((a,b)=>b-a);
    const pctInv = zona.total > 0 ? safePct(zona.inv, zona.total).toFixed(0) : 0;
    const pctOcc = zona.total > 0 ? safePct(zona.occ||0, zona.total).toFixed(0) : 0;
    const correlative = nave === 1 && letra === 'E';
    const onlyEvens = nave === 2 && letra === 'F';

    let h = '<div class="pasillo-block-vertical">';
    h += '<div class="pb-header">';
    h += '<strong>'+sanitize(letra)+'</strong>';
    h += '<span style="font-size:8px;display:block;">✅'+pctInv+'% 📦'+pctOcc+'%</span>';
    h += '</div>';
    h += '<div class="pb-with-calle">';

    if (correlative) {
      h += '<div class="pb-col">';
      [...nums].sort((a,b)=>b-a).forEach(n => {
        h += renderDot(nave, letra, n, 'left');
      });
      h += '</div>';
    } else if (onlyEvens) {
      h += '<div class="pb-col">';
      evens.forEach(n => { h += renderDot(nave, letra, n, 'left'); });
      h += '</div>';
    } else {
      if (nave === 2 && letra === 'A') {
        h += '<div class="pb-col">';
        odds.forEach(n => { h += renderDot(nave, letra, n, 'right'); });
        h += '</div>';
        h += '<div class="pb-col">';
        evens.forEach(n => { h += renderDot(nave, letra, n, 'left'); });
        h += '</div>';
      } else {
        h += '<div class="pb-col">';
        odds.forEach(n => { h += renderDot(nave, letra, n, 'right'); });
        h += '</div>';
        h += '<div class="calle-line"></div>';
        h += '<div class="pb-col">';
        evens.forEach(n => { h += renderDot(nave, letra, n, 'left'); });
        h += '</div>';
      }
    }
    h += '</div></div>';
    return h;
  }

  function buildPairFG() {
    const numsF = getNums(2, 'F');
    const numsG = getNums(2, 'G');
    const evensF = numsF.filter(n => n%2===0).sort((a,b)=>b-a);
    const oddsG = numsG.filter(n => n%2===1).sort((a,b)=>b-a);
    const zonaF = zonas.find(z => z.name === 'N2-F');
    const zonaG = zonas.find(z => z.name === 'N2-G');
    const pctInvF = zonaF && zonaF.total > 0 ? safePct(zonaF.inv, zonaF.total).toFixed(0) : 0;
    const pctOccF = zonaF && zonaF.total > 0 ? safePct(zonaF.occ||0, zonaF.total).toFixed(0) : 0;
    const pctInvG = zonaG && zonaG.total > 0 ? safePct(zonaG.inv, zonaG.total).toFixed(0) : 0;
    const pctOccG = zonaG && zonaG.total > 0 ? safePct(zonaG.occ||0, zonaG.total).toFixed(0) : 0;

    let h = '<div class="pasillo-block-vertical">';
    h += '<div class="pb-header">';
    h += '<strong>F</strong>';
    h += '<span style="font-size:7px;">✅'+pctInvF+'% 📦'+pctOccF+'%</span>';
    h += ' — ';
    h += '<strong>G</strong>';
    h += '<span style="font-size:7px;">✅'+pctInvG+'% 📦'+pctOccG+'%</span>';
    h += '</div>';
    h += '<div class="pb-with-calle">';
    h += '<div class="pb-col">';
    evensF.forEach(n => { h += renderDot(2, 'F', n, 'left'); });
    h += '</div>';
    h += '<div class="calle-line"></div>';
    h += '<div class="pb-col">';
    oddsG.forEach(n => { h += renderDot(2, 'G', n, 'right'); });
    h += '</div>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  function renderDot(nave, letra, n, labelSide) {
    const s = getStatus(nave, letra, n);
    const occ = hasStock(nave, letra, n);
    const loc = 'N'+nave+'-'+letra+('0'+n).slice(-2);
    const colors = getDotColors(s, occ);
    const pies = (typeof PIES_RACKS_CONFIG !== 'undefined' && PIES_RACKS_CONFIG[loc]) || 1;
    const lastMark = getLastMark(loc);
    const tooltip = lastMark
      ? 'Inventariado por: ' + lastMark.usuario + ' | Fecha: ' + new Date(lastMark.fecha).toLocaleString('es-AR')
      : 'Sin inventariar';
    let html = '<div class="rack-cell" data-loc="'+loc+'" onclick="toggleLoc(this.dataset.loc)" title="'+tooltip+'">';
    if (labelSide === 'left') {
      html += '<div class="rack-label">'+n+'</div>';
    }
    html += '<div class="rack-pies">';
    for (let i = 0; i < pies; i++) {
      html += '<div class="rack-dot-small" style="background:'+colors.bg+';border:1px solid '+colors.border+';"></div>';
    }
    html += '</div>';
    if (labelSide === 'right') {
      html += '<div class="rack-label">'+n+'</div>';
    }
    html += '</div>';
    return html;
  }

  function buildMotos() {
    const zona = zonas.find(z => z.name === 'N2-M');
    if (!zona) return '';
    const nums = getNums(2, 'M');
    const pctInv = zona.total > 0 ? safePct(zona.inv, zona.total).toFixed(0) : 0;
    const pctOcc = zona.total > 0 ? safePct(zona.occ||0, zona.total).toFixed(0) : 0;

    let h = '<div class="motos-row"><span class="motos-label">🏍️ Motos</span>';
    nums.forEach(n => {
      const s = getStatus(2, 'M', n);
      const occ = hasStock(2, 'M', n);
      const loc = 'N2-M'+('0'+n).slice(-2);
      const colors = getDotColors(s, occ);
      h += '<div class="rack-dot" data-loc="'+loc+'" onclick="toggleLoc(this.dataset.loc)" style="background:'+colors.bg+';color:'+colors.fg+';border:2px solid '+colors.border+';">'+n+'</div>';
    });
    h += '<span style="font-size:9px;color:#9aa0a6;margin-left:6px;">✅'+pctInv+'% 📦'+pctOcc+'%</span></div>';
    return h;
  }

  let html = '';

  html += '<div class="nave-section">';
  html += '<div class="nave-section-title" style="background:#f3e5f5;color:#7b1fa2;">Nave 2</div>';
  html += '<div class="nave-row" id="nave2Top"></div>';
  html += buildMotos();
  html += '<div class="nave-row" id="nave2Bottom"></div>';
  html += '</div>';

  html += '<div class="nave-section">';
  html += '<div class="nave-section-title" style="background:#e0f2f1;color:#00796b;">Nave 1</div>';
  html += '<div class="nave-row" id="nave1Top"></div>';
  html += '<div class="nave-row" id="nave1Bottom" style="justify-content:center;"></div>';
  html += '</div>';

  safeHtml(safeGetEl('mapaDeposito'), html);

  // Agregar calles una por una
  const nave2Top = safeGetEl('nave2Top');
  const nave2Bottom = safeGetEl('nave2Bottom');
  const nave1Top = safeGetEl('nave1Top');
  const nave1Bottom = safeGetEl('nave1Bottom');

  if (nave2Top) nave2Top.innerHTML = buildBloqueF(2) + ['G','H','I','J'].map(l => buildBloqueParImpar(l, 2)).join('');
  if (nave2Bottom) nave2Bottom.innerHTML = buildBlock(2, 'A') + buildBlock(2, 'B') + buildBlock(2, 'C') + buildBlock(2, 'D') + buildBlock(2, 'E');
  if (nave1Top) nave1Top.innerHTML = '';
  if (nave1Bottom) nave1Bottom.innerHTML = buildBlock(1, 'A') + buildBlock(1, 'B') + buildBlock(1, 'C') + buildBlock(1, 'D') + buildBlock(1, 'E');

  const legendHtml = currentView === 'inv'
    ? '<span class="legend-item"><span class="legend-dot" style="background:#0f9d58;"></span> Inventariado</span><span class="legend-item"><span class="legend-dot" style="background:#ea4335;"></span> Pendiente</span><span class="legend-item"><span class="legend-dot" style="background:#cfd8dc;"></span> Vacío</span>'
    : '<span class="legend-item"><span class="legend-dot" style="background:#1565c0;"></span> Con Stock</span><span class="legend-item"><span class="legend-dot" style="background:#eeeeee;border:1px solid #e0e0e0;"></span> Vacío</span>';
  safeHtml(safeGetEl('mapLegend'), legendHtml);
}

function refreshAll() {
  recalcZonas();
  calcOcupacion();
  renderMapa();

  const total = zonas.reduce((s,z) => s + z.total, 0);
  const inv = zonas.reduce((s,z) => s + z.inv, 0);
  const pend = total - inv;
  const occTot = zonas.reduce((s,z) => s + (z.occ||0), 0);
  const emptyTot = total - occTot;
  const pctInv = safePct(inv, total).toFixed(1);
  const pctOcc = total > 0 ? safePct(occTot, total).toFixed(1) : 0;

  safeText(safeGetEl('fecha'), 'Actualizado: ' + new Date().toLocaleString('es-AR') + (Object.keys(stockData).length > 0 ? ' | Stock: ' + Object.keys(stockData).length + ' locs ocupadas' : ''));

  const kpiEl = safeGetEl('kpiRow');
  if (kpiEl) {
    if (currentView === 'inv') {
      kpiEl.innerHTML = [
        {label:'Total Ubicaciones', v:total, c:'blue', s:'A inventariar'},
        {label:'Inventariadas', v:inv, c:'green', s:'Completadas'},
        {label:'Pendientes', v:pend, c:'orange', s:'Faltan '+pend},
        {label:'Avance', v:pctInv+'%', c:'purple', s:'Progreso general'}
      ].map(k => '<div class="kpi-card '+k.c+'"><div class="label">'+k.label+'</div><div class="value">'+k.v+'</div><div class="sub">'+k.s+'</div></div>').join('');
    } else {
      kpiEl.innerHTML = [
        {label:'Total Ubicaciones', v:total, c:'blue', s:'En el depósito'},
        {label:'Con Stock (ocupadas)', v:occTot, c:'teal', s:'Ubicaciones con producto'},
        {label:'Vacías (disponibles)', v:emptyTot, c:'orange', s:'Ubicaciones libres'},
        {label:'Ocupación', v:pctOcc+'%', c:'cyan', s:'del espacio ocupado'}
      ].map(k => '<div class="kpi-card '+k.c+'"><div class="label">'+k.label+'</div><div class="value">'+k.v+'</div><div class="sub">'+k.s+'</div></div>').join('');
    }
  }

  const sorted = [...zonas].sort((a,b) => a.name.localeCompare(b.name));

  const genLbl = currentView === 'inv' ? ['Inventariadas','Pendientes'] : ['Con Stock','Vacías'];
  const genData = currentView === 'inv' ? [inv, pend] : [occTot, emptyTot];
  const genColors = currentView === 'inv' ? ['#0f9d58','#ea4335'] : ['#00796b','#cfd8dc'];

  try {
  if (!chartGeneral) {
    chartGeneral = new Chart(document.getElementById('chartGeneral'), {
      type:'doughnut', data:{
        labels:genLbl,
        datasets:[{data:genData, backgroundColor:genColors, borderWidth:0}]
      }, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{color:'#5f6368'}}}}
    });
    chartZonas = new Chart(document.getElementById('chartZonas'), {
      type:'bar', data:{
        labels: sorted.map(z => z.name),
        datasets: currentView === 'inv'
          ? [{label:'Inventariado', data:sorted.map(z => z.inv), backgroundColor:'#0f9d58', borderRadius:3},
             {label:'Pendiente', data:sorted.map(z => z.total - z.inv), backgroundColor:'#ea4335', borderRadius:3}]
          : [{label:'Con Stock', data:sorted.map(z => z.occ||0), backgroundColor:'#00796b', borderRadius:3},
             {label:'Vacío', data:sorted.map(z => z.total - (z.occ||0)), backgroundColor:'#cfd8dc', borderRadius:3}]
      }, options:{responsive:true, maintainAspectRatio:false, scales:{x:{stacked:true, ticks:{color:'#5f6368'}}, y:{stacked:true, ticks:{color:'#5f6368'}}}, plugins:{legend:{position:'bottom', labels:{color:'#5f6368'}}}}
    });
    chartBar = new Chart(document.getElementById('chartBar'), {
      type:'bar', data:{
        labels:['Ubicaciones'],
        datasets: currentView === 'inv'
          ? [{label:'Completadas', data:[inv], backgroundColor:'#0f9d58', borderRadius:4},
             {label:'Restantes', data:[pend], backgroundColor:'#ea4335', borderRadius:4}]
          : [{label:'Ocupadas', data:[occTot], backgroundColor:'#00796b', borderRadius:4},
             {label:'Vacías', data:[emptyTot], backgroundColor:'#cfd8dc', borderRadius:4}]
      }, options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{stacked:true, ticks:{color:'#5f6368'}}, y:{stacked:true, ticks:{color:'#5f6368'}}}, plugins:{legend:{position:'bottom', labels:{color:'#5f6368'}}}}
    });
    chartRanking = new Chart(document.getElementById('chartRanking'), {
      type:'bar', data:{
        labels: sorted.map(z => z.name),
        datasets:[{label:'% Avance', data:sorted.map(z => currentView === 'inv' ? (z.inv/z.total*100).toFixed(1) : ((z.occ||0)/z.total*100).toFixed(1)), backgroundColor:sorted.map(z => {
          const p = currentView === 'inv' ? (z.inv/z.total*100) : ((z.occ||0)/z.total*100);
          return p >= 75 ? '#0f9d58' : p >= 40 ? '#f9a825' : p > 0 ? '#f9a825' : '#ea4335';
        }), borderRadius:3}]
      }, options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, scales:{x:{max:100, ticks:{color:'#5f6368', callback:v=>v+'%'}}, y:{ticks:{color:'#5f6368'}}}, plugins:{legend:{display:false}}}
    });
  } else {
    chartGeneral.data.labels = genLbl;
    chartGeneral.data.datasets[0].data = genData;
    chartGeneral.data.datasets[0].backgroundColor = genColors;
    chartGeneral.update();

    chartZonas.data.labels = sorted.map(z => z.name);
    if (currentView === 'inv') {
      chartZonas.data.datasets[0].label = 'Inventariado';
      chartZonas.data.datasets[0].data = sorted.map(z => z.inv);
      chartZonas.data.datasets[0].backgroundColor = '#0f9d58';
      chartZonas.data.datasets[1].label = 'Pendiente';
      chartZonas.data.datasets[1].data = sorted.map(z => z.total - z.inv);
      chartZonas.data.datasets[1].backgroundColor = '#ea4335';
    } else {
      chartZonas.data.datasets[0].label = 'Con Stock';
      chartZonas.data.datasets[0].data = sorted.map(z => z.occ||0);
      chartZonas.data.datasets[0].backgroundColor = '#00796b';
      chartZonas.data.datasets[1].label = 'Vacío';
      chartZonas.data.datasets[1].data = sorted.map(z => z.total - (z.occ||0));
      chartZonas.data.datasets[1].backgroundColor = '#cfd8dc';
    }
    chartZonas.update();

    chartBar.data.datasets[0].data = currentView === 'inv' ? [inv] : [occTot];
    chartBar.data.datasets[0].label = currentView === 'inv' ? 'Completadas' : 'Ocupadas';
    chartBar.data.datasets[0].backgroundColor = currentView === 'inv' ? '#0f9d58' : '#00796b';
    chartBar.data.datasets[1].data = currentView === 'inv' ? [pend] : [emptyTot];
    chartBar.data.datasets[1].label = currentView === 'inv' ? 'Restantes' : 'Vacías';
    chartBar.data.datasets[1].backgroundColor = currentView === 'inv' ? '#ea4335' : '#cfd8dc';
    chartBar.update();

    const r2 = [...zonas].sort((a,b) => (currentView === 'inv' ? (b.inv/b.total*100) : ((b.occ||0)/b.total*100)) - (currentView === 'inv' ? (a.inv/a.total*100) : ((a.occ||0)/a.total*100)));
    chartRanking.data.labels = r2.map(z => z.name);
    chartRanking.data.datasets[0].data = r2.map(z => currentView === 'inv' ? (z.inv/z.total*100).toFixed(1) : ((z.occ||0)/z.total*100).toFixed(1));
    chartRanking.data.datasets[0].backgroundColor = r2.map(z => {
      const p = currentView === 'inv' ? (z.inv/z.total*100) : ((z.occ||0)/z.total*100);
      return p >= 75 ? '#0f9d58' : p >= 40 ? '#f9a825' : p > 0 ? '#f9a825' : '#ea4335';
    });
    chartRanking.update();
  }
  } catch(e) { console.error('Chart error:', e); }

  safeText(safeGetEl('chartGenTitle'), currentView === 'inv' ? 'Progreso General' : 'Ocupación General');
  safeText(safeGetEl('chartZonasTitle'), currentView === 'inv' ? 'Avance por Zona' : 'Ocupación por Zona');
  safeText(safeGetEl('chartBarTitle'), currentView === 'inv' ? 'Completado vs Restante' : 'Ocupado vs Vacío');
  safeText(safeGetEl('chartRankTitle'), currentView === 'inv' ? 'Ranking de Avance por Zona' : 'Ranking de Ocupación por Zona');
  safeText(safeGetEl('resumenTitle'), currentView === 'inv' ? 'Resumen General' : 'Resumen Ocupación');
  safeText(safeGetEl('detalleTitle'), currentView === 'inv' ? 'Detalle por Zona' : 'Detalle Ocupación por Zona');

  const tHead = document.querySelector('#tablaZonas thead tr');
  if (tHead) {
    if (currentView === 'inv') {
      tHead.innerHTML = '<th style="text-align:left;padding:8px;color:#00796b;">Zona</th><th style="text-align:center;padding:8px;color:#00796b;">Total</th><th style="text-align:center;padding:8px;color:#00796b;">Hecho</th><th style="text-align:center;padding:8px;color:#00796b;">Pend</th><th style="text-align:right;padding:8px;color:#00796b;">%</th>';
    } else {
      tHead.innerHTML = '<th style="text-align:left;padding:8px;color:#00796b;">Zona</th><th style="text-align:center;padding:8px;color:#00796b;">Total</th><th style="text-align:center;padding:8px;color:#00796b;">Ocupado</th><th style="text-align:center;padding:8px;color:#00796b;">Vacío</th><th style="text-align:right;padding:8px;color:#00796b;">% Ocup</th>';
    }
  }

  const tbody = safeGetEl('tablaBody');
  if (tbody) {
    tbody.innerHTML = '';
    [...zonas].sort((a,b) => a.name.localeCompare(b.name)).forEach(z => {
      const pctZ = currentView === 'inv'
        ? (z.total > 0 ? safePct(z.inv, z.total).toFixed(0) : 0)
        : (z.total > 0 ? safePct(z.occ||0, z.total).toFixed(0) : 0);
      const color = pctZ >= 100 ? '#0f9d58' : pctZ > 0 ? '#f9a825' : '#ea4335';
      if (currentView === 'inv') {
        tbody.innerHTML += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;font-weight:600;">'+sanitize(z.name)+'</td><td style="padding:6px 8px;text-align:center;">'+z.total+'</td><td style="padding:6px 8px;text-align:center;color:#0f9d58;font-weight:600;">'+z.inv+'</td><td style="padding:6px 8px;text-align:center;color:'+(z.total-z.inv > 0 ? '#ea4335' : '#0f9d58')+';">'+(z.total-z.inv)+'</td><td style="padding:6px 8px;text-align:right;font-weight:700;color:'+color+';">'+pctZ+'%</td></tr>';
      } else {
        tbody.innerHTML += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;font-weight:600;">'+sanitize(z.name)+'</td><td style="padding:6px 8px;text-align:center;">'+z.total+'</td><td style="padding:6px 8px;text-align:center;color:#00796b;font-weight:600;">'+(z.occ||0)+'</td><td style="padding:6px 8px;text-align:center;color:'+(z.total-(z.occ||0) > 0 ? '#78909c' : '#00796b')+';">'+(z.total-(z.occ||0))+'</td><td style="padding:6px 8px;text-align:right;font-weight:700;color:'+color+';">'+pctZ+'%</td></tr>';
      }
    });
  }

  const zonasCompletas = zonas.filter(z => {
    if (currentView === 'inv') return z.total === z.inv;
    return (z.occ||0) === z.total;
  }).length;
  const zonasCero = zonas.filter(z => {
    if (currentView === 'inv') return z.inv === 0;
    return (z.occ||0) === 0;
  }).length;
  const zonasParcial = zonas.length - zonasCompletas - zonasCero;
  const mejorZona = [...zonas].sort((a,b) => {
    const pa = currentView === 'inv' ? (a.inv/a.total*100) : ((a.occ||0)/a.total*100);
    const pb = currentView === 'inv' ? (b.inv/b.total*100) : ((b.occ||0)/b.total*100);
    return pb - pa;
  })[0];
  const peorZona = [...zonas].sort((a,b) => {
    const pa = currentView === 'inv' ? (a.inv/a.total*100) : ((a.occ||0)/a.total*100);
    const pb = currentView === 'inv' ? (b.inv/b.total*100) : ((b.occ||0)/b.total*100);
    return pa - pb;
  })[0];

  const labelHecho = currentView === 'inv' ? 'Inventariadas' : 'Ocupadas';
  const labelPend = currentView === 'inv' ? 'Pendientes' : 'Vacías';
  const colorHecho = currentView === 'inv' ? '#0f9d58' : '#00796b';
  const colorPend = currentView === 'inv' ? '#ea4335' : '#78909c';

  const datoHecho = currentView === 'inv' ? inv : occTot;
  const datoPend = currentView === 'inv' ? pend : emptyTot;

  safeHtml(safeGetEl('resumenTable'), `
<table style="width:100%;border-collapse:collapse;">
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">Total ubicaciones</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;">${total}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${labelHecho}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:${colorHecho};">${datoHecho}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${labelPend}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:${colorPend};">${datoPend}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Porcentaje avance' : 'Porcentaje ocupación'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#00796b;">${currentView === 'inv' ? pctInv : pctOcc}%</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Zonas completas (100%)' : 'Zonas 100% ocupadas'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#0f9d58;">${zonasCompletas}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Zonas sin empezar (0%)' : 'Zonas 0% ocupadas'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#ea4335;">${zonasCero}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Zonas en progreso' : 'Zonas parcialmente ocupadas'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#f9a825;">${zonasParcial}</td></tr>
<tr><td style="padding:6px 8px;color:#5f6368;">${currentView === 'inv' ? 'Mejor zona' : 'Zona más ocupada'}</td><td style="padding:6px 8px;font-weight:700;text-align:right;">${mejorZona ? sanitize(mejorZona.name)+' ('+safePct(currentView === 'inv' ? mejorZona.inv : (mejorZona.occ||0), mejorZona.total).toFixed(0)+'%)' : '-'}</td></tr>
<tr><td style="padding:6px 8px;color:#5f6368;">${currentView === 'inv' ? 'Zona con menor avance' : 'Zona menos ocupada'}</td><td style="padding:6px 8px;font-weight:700;text-align:right;">${peorZona ? sanitize(peorZona.name)+' ('+safePct(currentView === 'inv' ? peorZona.inv : (peorZona.occ||0), peorZona.total).toFixed(0)+'%)' : '-'}</td></tr>
</table>`);

  safeText(safeGetEl('zoneGridTitle'), currentView === 'inv' ? 'Detalle por Zona (Tarjetas)' : 'Ocupación por Zona (Tarjetas)');
  const zoneGridEl = safeGetEl('zoneGrid');
  if (zoneGridEl) {
    zoneGridEl.innerHTML = '';
    [...zonas].sort((a,b) => a.name.localeCompare(b.name)).forEach(z => {
      const p = z.total > 0 ? safePct(currentView === 'inv' ? z.inv : (z.occ||0), z.total).toFixed(0) : 0;
      const v = currentView === 'inv' ? z.inv : (z.occ||0);
      const fillClass = currentView === 'inv' ? '' : ' blue-grad';
      zoneGridEl.innerHTML += '<div class="zone-card"><div class="z-name">'+sanitize(z.name)+'</div><div class="z-bar"><div class="z-fill'+fillClass+'" style="width:'+p+'%"></div></div><div class="z-text">'+(currentView === 'inv' ? '✅ '+v+'/'+z.total+' inventariados' : '📦 '+v+'/'+z.total+' ocupados')+' ('+p+'%)</div></div>';
    });
  }
}

if (typeof XLSX === 'undefined') {
  const st = safeGetEl('uploadStatus');
  if (st) {
    st.textContent = '✕ La librería XLSX no cargó. Probá recargar la página o usar otro navegador.';
    st.className = 'status err';
  }
}

window.addEventListener('online', () => {
  showToast('Conexión restablecida. Sincronizando datos...', 'success', 3000);
});
window.addEventListener('offline', () => {
  showToast('Sin conexión a internet. Los cambios se guardan localmente.', 'warning', 5000);
});

checkSession();
