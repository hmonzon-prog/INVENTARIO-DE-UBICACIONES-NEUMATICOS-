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
  localStorage.setItem('obInvData', JSON.stringify(invData));
  if (db) {
    db.collection('inventario').doc('ubicaciones').set({ data: invData }, { merge: true })
      .catch(err => console.error('Firestore write error:', err));
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
  });
}
async function initFromFirestore() {
  try {
    if (db) {
      const docRef = db.collection('inventario').doc('ubicaciones');
      const doc = await docRef.get();
      if (doc.exists) {
        const remoteData = doc.data().data;
        if (remoteData) {
          for (const k in remoteData) {
            if (k in invData) invData[k] = remoteData[k];
          }
        }
        await docRef.set({ data: invData }, { merge: true });
      } else {
        await docRef.set({ data: invData });
      }
    } else {
      const saved = localStorage.getItem('obInvData');
      if (saved) { const parsed = JSON.parse(saved); for (const k in parsed) if (k in invData) invData[k] = parsed[k]; }
    }
  } catch (err) {
    console.error('Firestore init error, using localStorage:', err);
    try {
      const saved = localStorage.getItem('obInvData');
      if (saved) { const parsed = JSON.parse(saved); for (const k in parsed) if (k in invData) invData[k] = parsed[k]; }
    } catch(e) {}
  }
  startFirestoreListener();
  refreshAll();
}
function toggleLoc(key) {
  try {
    if (!(key in invData)) return;
    invData[key] = invData[key] === 1 ? 0 : 1;
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
  document.getElementById('stockFile').value = '';
  document.getElementById('uploadStatus').textContent = 'Sin archivo cargado';
  document.getElementById('uploadStatus').className = 'status';
  document.getElementById('btnLimpiar').disabled = true;
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

function handleFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const st = document.getElementById('uploadStatus');
  st.textContent = 'Leyendo archivo...';
  st.className = 'status';
  document.getElementById('btnLimpiar').disabled = true;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, {type:'array'});

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

      stockData = stockMap;
      if (Object.keys(stockData).length > 0) {
        st.textContent = '✓ ' + Object.keys(stockData).length + ' ubicaciones ocupadas. ' + sheetsInfo.join(' | ');
        st.className = 'status ok';
      } else {
        st.textContent = totalRowCount > 0
          ? 'Se leyeron ' + totalRowCount + ' filas pero ninguna ubicación coincide con el layout. Revisá el formato (ej: N2-G14, N1-A02).'
          : 'No se encontraron datos de ubicaciones. Verificá que el Excel tenga una columna "Ubicación".';
        st.className = 'status err';
      }
      document.getElementById('btnLimpiar').disabled = false;
      refreshAll();

    } catch(err) {
      st.textContent = 'Error al leer: ' + err.message + ' (revisá la consola F12)';
      st.className = 'status err';
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

function cargarEjemplo() {
  const sampleLocs = ['N2-C11','N2-C13','N2-E09','N2-F02','N2-F14','N2-C05','N2-E01','N2-F04','N2-F12','N2-B12','N2-B14','N2-B16','N2-H01','N2-H03','N2-H05','N2-H07','N2-H09','N2-H11','N2-H13','N2-H15','N2-G01','N2-G02','N2-G03','N2-G04','N2-G05','N2-G06','N2-G07','N2-G08','N2-G09','N2-G10','N2-G11','N2-G12','N2-G13','N2-G14','N1-A10','N2-A09','N2-J05','N2-J07','N2-M01','N2-M02','N2-M03','N2-M04','N2-M05','N2-I02','N2-I06'];
  stockData = {};
  sampleLocs.forEach(l => { stockData[l] = true; });
  const st = document.getElementById('uploadStatus');
  st.textContent = '✓ Ejemplo cargado: ' + sampleLocs.length + ' ubicaciones ocupadas (simulado)';
  st.className = 'status ok';
  document.getElementById('btnLimpiar').disabled = false;
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
  const nav1 = ['A','B','C','D','E'];
  const nav2 = ['A','B','C','D','E','F','G','H','I','J','M'];

  function buildBlock(nave, letra) {
    const zona = zonas.find(z => z.name === 'N'+nave+'-'+letra);
    if (!zona) return '';
    const nums = getNums(nave, letra);
    const isMoto = letra === 'M' && nave === 2;
    const odds = nums.filter(n => n%2===1), evens = nums.filter(n => n%2===0);
    const pctInv = (zona.inv/zona.total*100).toFixed(0);
    const pctOcc = zona.total > 0 ? ((zona.occ||0)/zona.total*100).toFixed(0) : 0;

    if (isMoto) {
      let h = '<div class="pasillo-block" style="min-width:140px;"><div class="pb-header"><span>M</span><span style="font-size:9px;color:#9aa0a6;font-weight:400;">Motos</span>';
      h += '<span style="font-size:9px;color:#5f6368;font-weight:400;margin-left:auto;display:flex;gap:4px;"><span title="Inventario">✅'+pctInv+'%</span><span title="Ocupacion">📦'+pctOcc+'%</span></span></div><div style="display:flex;gap:2px;flex-wrap:wrap;">';
      nums.forEach(n => {
        const s = getStatus(nave, letra, n);
        const occ = hasStock(nave, letra, n);
        const colors = getDotColors(s, occ);
        h += '<div class="rack-dot" data-loc="N2-M'+('0'+n).slice(-2)+'" onclick="toggleLoc(this.dataset.loc)" style="background:'+colors.bg+';color:'+colors.fg+';border:2px solid '+colors.border+';">'+n+'</div>';
      });
      h += '</div></div>';
      return h;
    }

    const sideEven = evens.length > 0;
    const sideOdd = odds.length > 0;
    const correlative = nave === 1 && letra === 'E';

    let h = '<div class="pasillo-block"><div class="pb-header"><span>'+letra+'</span>';
    if (currentView === 'inv') {
      h += '<span style="font-size:9px;color:#5f6368;font-weight:400;">'+zona.inv+'/'+zona.total+' ('+pctInv+'%)</span>';
    } else {
      h += '<span style="font-size:9px;color:#5f6368;font-weight:400;">'+(zona.occ||0)+'/'+zona.total+' ocup ('+pctOcc+'%)</span>';
    }
    h += '<span style="font-size:9px;color:#9aa0a6;font-weight:400;margin-left:auto;display:flex;gap:4px;"><span title="Avance inv">✅'+pctInv+'%</span><span title="Ocupacion">📦'+pctOcc+'%</span></span></div>';

    function renderDots(arr) {
      let out = '';
      arr.forEach(n => {
        const s = getStatus(nave, letra, n);
        const occ = hasStock(nave, letra, n);
        const loc = 'N'+nave+'-'+letra+('0'+n).slice(-2);
        const colors = getDotColors(s, occ);
        out += '<div class="rack-dot" data-loc="'+loc+'" onclick="toggleLoc(this.dataset.loc)" style="background:'+colors.bg+';color:'+colors.fg+';border:2px solid '+colors.border+';">'+n+'</div>';
      });
      return out;
    }

    if (correlative) {
      h += '<div class="pb-side">' + renderDots(nums) + '</div>';
    } else {
      if (sideEven) h += '<div class="pb-side"><span class="pb-side-label">P</span>' + renderDots(evens) + '</div>';
      if (sideOdd) h += '<div class="pb-side"><span class="pb-side-label">I</span>' + renderDots(odds) + '</div>';
    }
    h += '</div>';
    return h;
  }

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

  const colorN1 = 'background:#e0f2f1;color:#00796b;', colorN2 = 'background:#f3e5f5;color:#7b1fa2;';
  let html = '<div class="nave-section"><div class="nave-section-title" style="'+colorN2+'">Nave 2</div>';
  html += '<div class="map-grid" style="margin-bottom:6px;">' + ['F','G','H','I','J'].map(l => buildBlock(2, l)).join('') + '</div>';
  html += '<div class="map-grid" style="margin-bottom:6px;">' + ['A','B','C','D','E'].map(l => buildBlock(2, l)).join('') + '</div>';
  html += '<div class="map-grid">' + buildBlock(2, 'M') + '</div></div>';
  html += '<div class="nave-section"><div class="nave-section-title" style="'+colorN1+'">Nave 1</div><div class="map-grid">';
  nav1.forEach(l => { html += buildBlock(1, l); });
  html += '</div></div>';

  document.getElementById('mapaDeposito').innerHTML = html;

  const legendHtml = currentView === 'inv'
    ? '<span class="legend-item"><span class="legend-dot" style="background:#0f9d58;"></span> Inventariado</span><span class="legend-item"><span class="legend-dot" style="background:#ea4335;"></span> Pendiente</span><span class="legend-item"><span class="legend-dot" style="background:#cfd8dc;"></span> Vacío</span>'
    : '<span class="legend-item"><span class="legend-dot" style="background:#1565c0;"></span> Con Stock</span><span class="legend-item"><span class="legend-dot" style="background:#eeeeee;border:1px solid #e0e0e0;"></span> Vacío</span>';
  document.getElementById('mapLegend').innerHTML = legendHtml;
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
  const pctInv = (inv/total*100).toFixed(1);
  const pctOcc = total > 0 ? (occTot/total*100).toFixed(1) : 0;

  document.getElementById('fecha').textContent = 'Actualizado: ' + new Date().toLocaleString('es-AR') + (Object.keys(stockData).length > 0 ? ' | Stock: ' + Object.keys(stockData).length + ' locs ocupadas' : '');

  if (currentView === 'inv') {
    document.getElementById('kpiRow').innerHTML = [
      {label:'Total Ubicaciones', v:total, c:'blue', s:'A inventariar'},
      {label:'Inventariadas', v:inv, c:'green', s:'Completadas'},
      {label:'Pendientes', v:pend, c:'orange', s:'Faltan '+pend},
      {label:'Avance', v:pctInv+'%', c:'purple', s:'Progreso general'}
    ].map(k => '<div class="kpi-card '+k.c+'"><div class="label">'+k.label+'</div><div class="value">'+k.v+'</div><div class="sub">'+k.s+'</div></div>').join('');
  } else {
    document.getElementById('kpiRow').innerHTML = [
      {label:'Total Ubicaciones', v:total, c:'blue', s:'En el depósito'},
      {label:'Con Stock (ocupadas)', v:occTot, c:'teal', s:'Ubicaciones con producto'},
      {label:'Vacías (disponibles)', v:emptyTot, c:'orange', s:'Ubicaciones libres'},
      {label:'Ocupación', v:pctOcc+'%', c:'cyan', s:'del espacio ocupado'}
    ].map(k => '<div class="kpi-card '+k.c+'"><div class="label">'+k.label+'</div><div class="value">'+k.v+'</div><div class="sub">'+k.s+'</div></div>').join('');
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

  document.getElementById('chartGenTitle').textContent = currentView === 'inv' ? 'Progreso General' : 'Ocupación General';
  document.getElementById('chartZonasTitle').textContent = currentView === 'inv' ? 'Avance por Zona' : 'Ocupación por Zona';
  document.getElementById('chartBarTitle').textContent = currentView === 'inv' ? 'Completado vs Restante' : 'Ocupado vs Vacío';
  document.getElementById('chartRankTitle').textContent = currentView === 'inv' ? 'Ranking de Avance por Zona' : 'Ranking de Ocupación por Zona';
  document.getElementById('resumenTitle').textContent = currentView === 'inv' ? 'Resumen General' : 'Resumen Ocupación';
  document.getElementById('detalleTitle').textContent = currentView === 'inv' ? 'Detalle por Zona' : 'Detalle Ocupación por Zona';

  const tHead = document.querySelector('#tablaZonas thead tr');
  if (currentView === 'inv') {
    tHead.innerHTML = '<th style="text-align:left;padding:8px;color:#00796b;">Zona</th><th style="text-align:center;padding:8px;color:#00796b;">Total</th><th style="text-align:center;padding:8px;color:#00796b;">Hecho</th><th style="text-align:center;padding:8px;color:#00796b;">Pend</th><th style="text-align:right;padding:8px;color:#00796b;">%</th>';
  } else {
    tHead.innerHTML = '<th style="text-align:left;padding:8px;color:#00796b;">Zona</th><th style="text-align:center;padding:8px;color:#00796b;">Total</th><th style="text-align:center;padding:8px;color:#00796b;">Ocupado</th><th style="text-align:center;padding:8px;color:#00796b;">Vacío</th><th style="text-align:right;padding:8px;color:#00796b;">% Ocup</th>';
  }

  const tbody = document.getElementById('tablaBody');
  tbody.innerHTML = '';
  [...zonas].sort((a,b) => a.name.localeCompare(b.name)).forEach(z => {
    const pctZ = currentView === 'inv'
      ? (z.total > 0 ? (z.inv/z.total*100).toFixed(0) : 0)
      : (z.total > 0 ? ((z.occ||0)/z.total*100).toFixed(0) : 0);
    const color = pctZ >= 100 ? '#0f9d58' : pctZ > 0 ? '#f9a825' : '#ea4335';
    if (currentView === 'inv') {
      tbody.innerHTML += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;font-weight:600;">'+z.name+'</td><td style="padding:6px 8px;text-align:center;">'+z.total+'</td><td style="padding:6px 8px;text-align:center;color:#0f9d58;font-weight:600;">'+z.inv+'</td><td style="padding:6px 8px;text-align:center;color:'+(z.total-z.inv > 0 ? '#ea4335' : '#0f9d58')+';">'+(z.total-z.inv)+'</td><td style="padding:6px 8px;text-align:right;font-weight:700;color:'+color+';">'+pctZ+'%</td></tr>';
    } else {
      tbody.innerHTML += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;font-weight:600;">'+z.name+'</td><td style="padding:6px 8px;text-align:center;">'+z.total+'</td><td style="padding:6px 8px;text-align:center;color:#00796b;font-weight:600;">'+(z.occ||0)+'</td><td style="padding:6px 8px;text-align:center;color:'+(z.total-(z.occ||0) > 0 ? '#78909c' : '#00796b')+';">'+(z.total-(z.occ||0))+'</td><td style="padding:6px 8px;text-align:right;font-weight:700;color:'+color+';">'+pctZ+'%</td></tr>';
    }
  });

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

  document.getElementById('resumenTable').innerHTML = `
<table style="width:100%;border-collapse:collapse;">
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">Total ubicaciones</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;">${total}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${labelHecho}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:${colorHecho};">${datoHecho}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${labelPend}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:${colorPend};">${datoPend}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Porcentaje avance' : 'Porcentaje ocupación'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#00796b;">${currentView === 'inv' ? pctInv : pctOcc}%</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Zonas completas (100%)' : 'Zonas 100% ocupadas'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#0f9d58;">${zonasCompletas}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Zonas sin empezar (0%)' : 'Zonas 0% ocupadas'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#ea4335;">${zonasCero}</td></tr>
<tr><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;color:#5f6368;">${currentView === 'inv' ? 'Zonas en progreso' : 'Zonas parcialmente ocupadas'}</td><td style="padding:6px 8px;border-bottom:1px solid #e8eaed;font-weight:700;text-align:right;color:#f9a825;">${zonasParcial}</td></tr>
<tr><td style="padding:6px 8px;color:#5f6368;">${currentView === 'inv' ? 'Mejor zona' : 'Zona más ocupada'}</td><td style="padding:6px 8px;font-weight:700;text-align:right;">${mejorZona ? mejorZona.name+' ('+(currentView === 'inv' ? (mejorZona.inv/mejorZona.total*100) : ((mejorZona.occ||0)/mejorZona.total*100)).toFixed(0)+'%)' : '-'}</td></tr>
<tr><td style="padding:6px 8px;color:#5f6368;">${currentView === 'inv' ? 'Zona con menor avance' : 'Zona menos ocupada'}</td><td style="padding:6px 8px;font-weight:700;text-align:right;">${peorZona ? peorZona.name+' ('+(currentView === 'inv' ? (peorZona.inv/peorZona.total*100) : ((peorZona.occ||0)/peorZona.total*100)).toFixed(0)+'%)' : '-'}</td></tr>
</table>`;

  document.getElementById('zoneGridTitle').textContent = currentView === 'inv' ? 'Detalle por Zona (Tarjetas)' : 'Ocupación por Zona (Tarjetas)';
  document.getElementById('zoneGrid').innerHTML = '';
  [...zonas].sort((a,b) => a.name.localeCompare(b.name)).forEach(z => {
    const p = currentView === 'inv' ? (z.total > 0 ? (z.inv/z.total*100).toFixed(0) : 0) : (z.total > 0 ? ((z.occ||0)/z.total*100).toFixed(0) : 0);
    const v = currentView === 'inv' ? z.inv : (z.occ||0);
    const fillClass = currentView === 'inv' ? '' : ' blue-grad';
    document.getElementById('zoneGrid').innerHTML += '<div class="zone-card"><div class="z-name">'+z.name+'</div><div class="z-bar"><div class="z-fill'+fillClass+'" style="width:'+p+'%"></div></div><div class="z-text">'+(currentView === 'inv' ? '✅ '+v+'/'+z.total+' inventariados' : '📦 '+v+'/'+z.total+' ocupados')+' ('+p+'%)</div></div>';
  });
}

if (typeof XLSX === 'undefined') {
  document.getElementById('uploadStatus').textContent = '✕ La librería XLSX no cargó. Probá recargar la página o usar otro navegador.';
  document.getElementById('uploadStatus').className = 'status err';
}
renderMapa();
initFromFirestore();
