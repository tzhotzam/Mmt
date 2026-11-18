// three.js ile dolap önizlemesi: her parça bir kutu, kapaklar menteşesinden
// döner, çekmeceler kayar. Bir modüle tıklayınca seçilir.

import { renkBul } from './renkler.js';
import { makineMi } from './model.js';

let THREE = null, OrbitControls = null;

async function yukle() {
  if (THREE) return true;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
    return true;
  } catch {
    return false;
  }
}

export async function olustur3d(kap, { secince } = {}) {
  if (!(await yukle())) {
    kap.innerHTML = '<p class="bos">3B önizleme açılamadı (WebGL ya da three.js yok). Kesim listesi ve DXF çalışır.</p>';
    return { guncelle() {}, ac() {}, ayar() {}, odakla() {} };
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  kap.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });

  const sahne = new THREE.Scene();
  sahne.background = new THREE.Color(0x0b0e12);
  sahne.environment = ortam();
  const kamera = new THREE.PerspectiveCamera(38, 16 / 9, 10, 40000);
  const kontrol = new OrbitControls(kamera, renderer.domElement);
  kontrol.enableDamping = true;
  kontrol.dampingFactor = 0.08;
  kontrol.maxPolarAngle = Math.PI * 0.52;

  sahne.add(new THREE.HemisphereLight(0xf6f8fb, 0x4a443c, 1.5));
  const gunes = new THREE.DirectionalLight(0xfff3e2, 2.4);
  gunes.castShadow = true;
  gunes.shadow.mapSize.set(2048, 2048);
  gunes.shadow.bias = -0.0005;
  sahne.add(gunes, gunes.target);
  const dolgu = new THREE.DirectionalLight(0xdfe9ff, 0.9);
  dolgu.position.set(-1, 0.4, 1);
  sahne.add(dolgu);

  const zemin = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x6b6259, roughness: 0.95 }));
  zemin.rotation.x = -Math.PI / 2;
  zemin.receiveShadow = true;
  const duvar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xb9b4ab, roughness: 1 }));
  duvar.receiveShadow = true;
  sahne.add(zemin, duvar);

  let grup = new THREE.Group();
  sahne.add(grup);
  let hareketliler = [];
  let modulKutulari = [];          // tıklama için: { id, mesh[] }
  let oran = 0;
  let kapaklarGorunur = true;
  let ilkOdak = true;
  let sonCozum = null, sonProje = null, sonSecili = null;

  const kenarMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });

  /**
   * Yansımalar için basit bir oda ortamı: parlak kapaklar ancak etraflarını
   * yansıtınca parlak görünür. Dışarıdan HDR dosyası yüklenmez (çevrimdışı).
   */
  function ortam() {
    const oda = new THREE.Scene();
    const duvarlar = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: 0x55585e, side: THREE.BackSide }));
    oda.add(duvarlar);
    const isik = (x, y, z, w, h, g) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(g, g, g), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      oda.add(m);
    };
    isik(0, 2.9, 0, 6, 2, 3.2);      // tavan lambası
    isik(4.9, 0.6, 0, 3, 2.2, 2.2);  // pencere
    isik(0, 0.8, 4.9, 4, 1.6, 1.6);  // karşı duvar
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(oda, 0.03).texture;
    pm.dispose();
    return tex;
  }

  const dokuOnbellek = new Map();
  /** Ahşap damarı ya da mermer damarı: tuvalde bir kez çizilir. */
  function doku(r) {
    const anahtar = `${r.doku}|${r.hex}`;
    if (dokuOnbellek.has(anahtar)) return dokuOnbellek.get(anahtar);
    const n = 512;
    const tv = document.createElement('canvas');
    tv.width = tv.height = n;
    const c = tv.getContext('2d');
    c.fillStyle = r.hex;
    c.fillRect(0, 0, n, n);
    let tohum = 11;
    const rnd = () => ((tohum = (tohum * 16807) % 2147483647) / 2147483647);
    if (r.doku === 'ahsap') {
      // Dikey damar: koyu ve açık ince çizgiler, hafif dalgalı.
      for (let i = 0; i < 140; i++) {
        const x0 = rnd() * n, gen = 0.6 + rnd() * 2.2, faz = rnd() * 6, gen2 = 3 + rnd() * 8;
        c.strokeStyle = rnd() < 0.7 ? `rgba(40,22,8,${0.05 + rnd() * 0.12})` : `rgba(255,240,220,${0.04 + rnd() * 0.08})`;
        c.lineWidth = gen;
        c.beginPath();
        for (let y = 0; y <= n; y += 8) {
          const x = x0 + Math.sin(y / (40 + gen2 * 10) + faz) * gen2;
          if (y === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.stroke();
      }
    } else if (r.doku === 'mermer') {
      // Rastgele yürüyen gri damarlar.
      c.filter = 'blur(1px)';
      for (let k = 0; k < 9; k++) {
        let x = rnd() * n, y = 0;
        const a0 = 0.6 + rnd() * 0.8;
        c.strokeStyle = `rgba(110,110,118,${0.15 + rnd() * 0.3})`;
        c.lineWidth = 0.6 + rnd() * 2;
        c.beginPath();
        c.moveTo(x, y);
        while (y < n) {
          x += Math.cos(a0 + (rnd() - 0.5) * 1.6) * 10;
          y += 6 + rnd() * 8;
          c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    const t = new THREE.CanvasTexture(tv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    dokuOnbellek.set(anahtar, t);
    return t;
  }

  const malzOnbellek = new Map();
  /** Katalogdaki renkten malzeme: parlak ise düşük pürüz ve güçlü yansıma. */
  function renkMalz(id) {
    if (malzOnbellek.has(id)) return malzOnbellek.get(id);
    const r = renkBul(id);
    const parlak = r.yuzey === 'parlak';
    const m = new THREE.MeshStandardMaterial({
      color: r.doku ? 0xffffff : new THREE.Color(r.hex),
      map: r.doku ? doku(r) : null,
      roughness: parlak ? 0.08 : r.doku === 'mermer' ? 0.35 : 0.62,
      metalness: 0,
      envMapIntensity: parlak ? 1.6 : 0.35,
    });
    malzOnbellek.set(id, m);
    return m;
  }

  function malzemeler(proje) {
    return {
      govde: renkMalz(proje.malzeme.govde.renk),
      kapak: renkMalz(proje.malzeme.kapak.renk),
      arkalik: new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9 }),
      tezgah: new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.35 }),
      ayak: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }),
    };
  }

  function kutu(w, h, d, mat) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), kenarMat));
    return m;
  }

  const camMalz = {
    seffaf: new THREE.MeshStandardMaterial({ color: 0xd8eef0, transparent: true, opacity: 0.22, roughness: 0.03, envMapIntensity: 1.8, depthWrite: false }),
    fume: new THREE.MeshStandardMaterial({ color: 0x2e3236, transparent: true, opacity: 0.6, roughness: 0.03, envMapIntensity: 1.8, depthWrite: false }),
    buzlu: new THREE.MeshStandardMaterial({ color: 0xe9eff1, transparent: true, opacity: 0.72, roughness: 0.85, envMapIntensity: 0.6, depthWrite: false }),
  };
  const aluMalz = new THREE.MeshStandardMaterial({ color: 0xb9bdc3, metalness: 0.85, roughness: 0.3 });

  /**
   * Camlı kapak: çerçeve dört çıta + ortada cam. Merkezi kutunun merkezinde
   * olan bir grup döner; düz kapakla aynı yere oturur.
   */
  function camliKapak(p, k, malz, proje) {
    const g = new THREE.Group();
    const alu = p.cam.tur === 'aluminyum';
    const c = alu ? 22 : proje.cam.cerceve;
    const w = k.sx, h = k.sy, d = k.sz;
    const cm = alu ? aluMalz : malz;
    const cita = (sx, sy, x, y) => {
      const m = kutu(sx, sy, d, cm);
      m.position.set(x, y, 0);
      g.add(m);
    };
    cita(w, c, 0, h / 2 - c / 2);                 // üst
    cita(w, c, 0, -h / 2 + c / 2);                // alt
    cita(c, h - 2 * c, -w / 2 + c / 2, 0);        // sol
    cita(c, h - 2 * c, w / 2 - c / 2, 0);         // sağ
    const camK = Math.max(3, proje.cam.kalinlik);
    const cam = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * c + 8, h - 2 * c + 8, camK), camMalz[proje.cam.tur] || camMalz.seffaf);
    cam.position.set(0, 0, alu ? 0 : -d / 2 + proje.cam.lambaDerinlik - camK / 2);
    cam.renderOrder = 2;
    g.add(cam);
    return g;
  }

  const beyazEsya = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.35 });
  const inox = new THREE.MeshStandardMaterial({ color: 0xbfc3c8, metalness: 0.75, roughness: 0.32 });
  const koyuCam = new THREE.MeshStandardMaterial({ color: 0x1d2329, roughness: 0.05, envMapIntensity: 1.6 });

  /** Makine yerine temsili beyaz eşya (kesime girmez). */
  function makine(m, proje) {
    const g = new THREE.Group();
    const a = proje.ayakYukseklik;
    const w = m.w - 8, h = m.h + a - 8, d = Math.min(m.d, 580) - 10;
    const camasir = m.altTur === 'camasir';
    const govde = kutu(w, h, d, camasir ? beyazEsya : inox);
    govde.position.set(m.w / 2, -a + h / 2, 10 + d / 2);
    g.add(govde);
    if (camasir) {
      const r = w * 0.3;
      const kapi = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 14, 48), inox);
      kapi.rotation.x = Math.PI / 2;
      kapi.position.set(m.w / 2, -a + h * 0.45, 10 + d + 7);
      const cam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.72, 16, 48), koyuCam);
      cam.rotation.x = Math.PI / 2;
      cam.position.copy(kapi.position);
      cam.position.z += 2;
      const panel = kutu(w, 90, 6, beyazEsya);
      panel.position.set(m.w / 2, -a + h - 55, 10 + d + 3);
      g.add(kapi, cam, panel);
    } else if (m.altTur === 'bulasikSolo') {
      const serit = kutu(w, 70, 6, koyuCam);
      serit.position.set(m.w / 2, -a + h - 45, 10 + d + 3);
      g.add(serit);
    }
    return g;
  }

  function temizle() {
    grup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    sahne.remove(grup);
    grup = new THREE.Group();
    sahne.add(grup);
    hareketliler = [];
    modulKutulari = [];
  }

  function guncelle(cozum, proje, seciliId) {
    sonCozum = cozum; sonProje = proje; sonSecili = seciliId;
    temizle();
    const mat = malzemeler(proje);
    let minX = Infinity, maxX = -Infinity, maxY = 0, maxZ = 0;

    for (const { m, konum, parcalar } of cozum.moduller) {
      const mg = new THREE.Group();
      mg.position.set(konum.x, konum.y, konum.z);
      grup.add(mg);
      const kayit = { id: m.id, mesh: [] };
      modulKutulari.push(kayit);
      const secili = m.id === seciliId;

      for (const p of parcalar) {
        const k = p.kutu;
        const kapakMi = p.grup === 'kapak' || p.grup === 'cekmeceOn';
        if (kapakMi && !kapaklarGorunur) continue;
        if (p.malzeme === 'cam') continue;          // camı kapak kendisi çizer
        const malz = p.renk ? renkMalz(p.renk) : mat[p.malzeme];
        const mesh = p.cam ? camliKapak(p, k, malz, proje) : kutu(k.sx, k.sy, k.sz, malz);
        kayit.mesh.push(mesh);
        const h = p.hareket;
        if (h?.tip === 'devril') {
          // Bulaşık makinesi paneli alttan öne devrilir.
          const pivot = new THREE.Object3D();
          pivot.position.set(k.x + k.sx / 2, k.y, k.z);
          mesh.position.set(0, k.sy / 2, k.sz / 2);
          pivot.add(mesh);
          mg.add(pivot);
          hareketliler.push({ tip: 'devril', obj: pivot });
        } else if (h?.tip === 'kapak') {
          // Menteşe ekseni: kapağın menteşe kenarı, arka yüzü.
          const pivot = new THREE.Object3D();
          const solMu = h.mentese === 'sol';
          pivot.position.set(solMu ? k.x : k.x + k.sx, k.y + k.sy / 2, k.z);
          mesh.position.set(solMu ? k.sx / 2 : -k.sx / 2, 0, k.sz / 2);
          pivot.add(mesh);
          mg.add(pivot);
          hareketliler.push({ tip: 'kapak', obj: pivot, yon: solMu ? -1 : 1 });
        } else if (h?.tip === 'cekmece') {
          mesh.position.set(k.x + k.sx / 2, k.y + k.sy / 2, k.z + k.sz / 2);
          mg.add(mesh);
          hareketliler.push({ tip: 'cekmece', obj: mesh, z0: mesh.position.z, mesafe: h.mesafe });
        } else {
          mesh.position.set(k.x + k.sx / 2, k.y + k.sy / 2, k.z + k.sz / 2);
          mg.add(mesh);
        }
      }

      if (secili) {
        // Seçili modülün çevresinde turuncu çerçeve (kapaklar dâhil).
        const pay = 6;
        const geo = new THREE.BoxGeometry(m.w + 2 * pay, m.h + 2 * pay, m.d + 30 + 2 * pay);
        const cer = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xf59e0b }));
        geo.dispose();
        cer.position.set(m.w / 2, m.h / 2, (m.d + 30) / 2);
        mg.add(cer);
      }

      if (makineMi(m)) mg.add(makine(m, proje));

      if (m.tip !== 'ust' && !makineMi(m) && proje.ayakYukseklik > 0) {
        const a = proje.ayakYukseklik;
        const xs = m.w > 600 ? [60, m.w / 2, m.w - 60] : [60, m.w - 60];
        for (const x of xs) {
          for (const z of [80, m.d - 90]) {
            const ayak = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, a, 12), mat.ayak);
            ayak.position.set(x, -a / 2, z);
            mg.add(ayak);
          }
        }
      }
      if (m.tip === 'alt' && proje.tezgah) {
        const tz = kutu(m.w, 38, m.d + 20, mat.tezgah);
        tz.position.set(m.w / 2, m.h + 19, (m.d + 20) / 2);
        mg.add(tz);
      }
      minX = Math.min(minX, konum.x);
      maxX = Math.max(maxX, konum.x + m.w);
      maxY = Math.max(maxY, konum.y + m.h);
      maxZ = Math.max(maxZ, m.d);
    }
    if (!cozum.moduller.length) { minX = 0; maxX = 1000; maxY = 1000; maxZ = 600; }

    const genis = maxX - minX;
    const cx = (minX + maxX) / 2;
    zemin.scale.set(genis + 3000, maxZ + 3000, 1);
    zemin.position.set(cx, 0, (maxZ + 3000) / 2 - 300);
    duvar.scale.set(genis + 3000, maxY + 800, 1);
    duvar.position.set(cx, (maxY + 800) / 2, 0);

    const r = Math.max(genis, maxY) * 1.2;
    gunes.position.set(cx - r * 0.4, maxY + r * 0.8, r);
    gunes.target.position.set(cx, maxY / 2, 0);
    const sc = gunes.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = r * 4;
    sc.updateProjectionMatrix();

    if (ilkOdak) { odakla(); ilkOdak = false; }
    uygula();
    function odakla() {
      kontrol.target.set(cx, maxY * 0.48, maxZ * 0.5);
      // Her şey kadraja girsin: dikey ve yatay görüş açısından uzaklık.
      const tan = Math.tan((kamera.fov * Math.PI) / 360);
      const uzak = Math.max((maxY * 0.62) / tan, (genis * 0.62) / (tan * kamera.aspect), 1500);
      kamera.position.set(cx + uzak * 0.28, maxY * 0.62, maxZ * 0.5 + uzak);
      kontrol.update();
    }
    sonOdak = odakla;
  }
  let sonOdak = () => {};

  function uygula() {
    for (const h of hareketliler) {
      if (h.tip === 'kapak') h.obj.rotation.y = h.yon * oran * (Math.PI * 0.55);
      else if (h.tip === 'devril') h.obj.rotation.x = oran * (Math.PI * 0.47);
      else h.obj.position.z = h.z0 + h.mesafe * oran;
    }
  }

  // Tıklama ile modül seçimi (sürüklemeyi tıklama sayma).
  const isin = new THREE.Raycaster();
  let basla = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { basla = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!basla || Math.hypot(e.clientX - basla[0], e.clientY - basla[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    isin.setFromCamera(v, kamera);
    const hepsi = modulKutulari.flatMap((k) => k.mesh.map((m) => ({ m, id: k.id })));
    const vur = isin.intersectObjects(hepsi.map((x) => x.m), true)[0];
    if (!vur || !secince) return;
    // Camlı kapak bir grup: vurulan çocuktan kayıtlı nesneye çık.
    for (let o = vur.object; o; o = o.parent) {
      const h = hepsi.find((x) => x.m === o);
      if (h) { secince(h.id); return; }
    }
  });

  function boyut() {
    const w = kap.clientWidth || 640, h = kap.clientHeight || 360;
    renderer.setSize(w, h, false);
    kamera.aspect = w / h;
    kamera.updateProjectionMatrix();
  }
  new ResizeObserver(boyut).observe(kap);
  boyut();

  (function dongu() {
    requestAnimationFrame(dongu);
    if (!kap.offsetParent) return;      // görünmüyorsa çizme
    kontrol.update();
    renderer.render(sahne, kamera);
  })();

  return {
    guncelle,
    ac(o) { oran = o; uygula(); },
    ayar({ kapaklar }) {
      if (kapaklar !== undefined && kapaklar !== kapaklarGorunur) {
        kapaklarGorunur = kapaklar;
        if (sonCozum) guncelle(sonCozum, sonProje, sonSecili);
      }
    },
    odakla() { sonOdak(); },
  };
}
