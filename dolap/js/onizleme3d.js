// three.js ile dolap önizlemesi: her parça bir kutu, kapaklar menteşesinden
// döner, çekmeceler kayar. Bir modüle tıklayınca seçilir.

import { RENKLER } from './model.js';

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
  const kamera = new THREE.PerspectiveCamera(38, 16 / 9, 10, 40000);
  const kontrol = new OrbitControls(kamera, renderer.domElement);
  kontrol.enableDamping = true;
  kontrol.dampingFactor = 0.08;
  kontrol.maxPolarAngle = Math.PI * 0.52;

  sahne.add(new THREE.HemisphereLight(0xf6f8fb, 0x4a443c, 2.1));
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

  function malzemeler(proje) {
    const renk = (ad, yedek) => RENKLER[ad] ?? yedek;
    return {
      govde: new THREE.MeshStandardMaterial({ color: renk(proje.malzeme.govde.renk, 0xeeeeea), roughness: 0.7 }),
      kapak: new THREE.MeshStandardMaterial({ color: renk(proje.malzeme.kapak.renk, 0x3c4046), roughness: 0.45 }),
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
        const mesh = kutu(k.sx, k.sy, k.sz, mat[p.malzeme]);
        kayit.mesh.push(mesh);
        const h = p.hareket;
        if (h?.tip === 'kapak') {
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

      if (m.tip !== 'ust' && proje.ayakYukseklik > 0) {
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
    const vur = isin.intersectObjects(hepsi.map((x) => x.m), false)[0];
    if (vur && secince) secince(hepsi.find((x) => x.m === vur.object).id);
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
