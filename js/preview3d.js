// three.js ile 3B önizleme. three depodan (vendor/three) yüklenir, böylece
// kurulu uygulamada internetsiz de çalışır. Yine de yüklenemezse (eski
// tarayıcı, WebGL yok) önizleme sessizce devre dışı kalır, uygulamanın geri
// kalanı çalışmaya devam eder.

let THREE = null;
let OrbitControls = null;

async function loadThree() {
  if (THREE) return true;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
    return true;
  } catch {
    return false;
  }
}

export async function createPreview3d(container) {
  const ok = await loadThree();
  if (!ok) {
    container.innerHTML =
      '<p style="padding:20px;color:#9aa5b1;font-size:13px;text-align:center">' +
      '3B önizleme bu tarayıcıda açılamadı (three.js yüklenemedi). ' +
      'Sayfayı yenileyin; olmazsa Chrome ya da Edge deneyin. Diğer sekmeler ' +
      've dışa aktarma çalışır.</p>';
    return { update() {}, resize() {}, dispose() {} };
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth || 640, container.clientHeight || 480, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e12);

  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 1, 20000);
  camera.position.set(700, 500, 1400);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xdfe7f2, 0x20242b, 1.5));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.1);
  key.position.set(-0.6, 0.9, 1);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc5ff, 0.7);
  fill.position.set(1, 0.2, 0.6);
  scene.add(fill);

  // Duvar düzlemi — panelin arkasında referans yüzey.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 1, metalness: 0 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMat);
  scene.add(wall);

  const material = new THREE.MeshStandardMaterial({
    color: 0xc79a5f, roughness: 0.72, metalness: 0.02, flatShading: false,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a6b45, roughness: 0.85, metalness: 0,
  });

  let group = new THREE.Group();
  scene.add(group);
  let running = true;

  function clearGroup() {
    group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    scene.remove(group);
    group = new THREE.Group();
    scene.add(group);
  }

  function shapeOf(part) {
    const shape = new THREE.Shape(part.outline.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const hole of part.holes) {
      shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    }
    return shape;
  }

  function extrude(part, depth) {
    return new THREE.ExtrudeGeometry(shapeOf(part), {
      depth, bevelEnabled: false, curveSegments: 1, steps: 1,
    });
  }

  function basis(ax, ay, az, t) {
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...ax), new THREE.Vector3(...ay), new THREE.Vector3(...az)
    );
    m.setPosition(new THREE.Vector3(...t));
    return m;
  }

  function update(state) {
    clearGroup();
    if (!state || !state.parts?.length) {
      renderer.render(scene, camera);
      return;
    }
    const { parts, info } = state;

    if (info.mode === 'facets') {
      // Modeli olduğu gibi, düz gölgelemeyle göster — fasetler net görünsün.
      const positions = new Float32Array(info.triangles.length * 9);
      info.triangles.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
          positions[i * 9 + k * 3] = t[k][0];
          positions[i * 9 + k * 3 + 1] = t[k][2];
          positions[i * 9 + k * 3 + 2] = -t[k][1];
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8f9499, roughness: 0.45, metalness: 0.55,
        flatShading: true, side: THREE.DoubleSide,
      });
      group.add(new THREE.Mesh(geo, mat));
      // Serbest duran heykel — arkasına duvar koyma.
      wall.visible = false;
    } else if (info.mode === 'ribs') {
      wall.visible = true;
      const horizontal = info.params.orientation === 'horizontal';
      const t = info.params.thickness;
      for (const part of parts) {
        const geo = extrude(part, t);
        let m;
        if (part.kind === 'lamel') {
          m = horizontal
            // yerel x (boy) → X, yerel y (derinlik) → Z, kalınlık → Y
            ? basis([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, part.meta.across + t, 0])
            // yerel x (boy) → Y, yerel y (derinlik) → Z, kalınlık → X
            : basis([0, 1, 0], [0, 0, 1], [1, 0, 0], [part.meta.across, 0, 0]);
        } else {
          const pos = part.meta.position;
          m = horizontal
            ? basis([0, 1, 0], [0, 0, 1], [1, 0, 0], [pos - t / 2, 0, 0])
            : basis([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, pos + t / 2, 0]);
        }
        geo.applyMatrix4(m);
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, part.kind === 'lamel' ? material : railMaterial));
      }
    } else if (info.mode === 'slices') {
      // Dilimler kendi eksenleri boyunca DİZİLİR. Bu dal olmadığında dilim
      // modu aşağıdaki katman dalına düşüyor, orada `meta.z` aranıyor ve
      // dilimde öyle bir alan olmadığı için hepsi z=0'a yığılıyordu: 48
      // dilim tek düzlemde üst üste biniyor, heykel katmanlanmış görünmüyordu.
      //
      // Sahne ekseni eşlemesi model (x,y,z) → sahne (x, z, -y). Her dilim
      // ekseni için yerel (u, v, kalınlık) üçlüsü buna göre kurulur; üçü de
      // sağ ellidir, aksi hâlde heykel aynalanırdı.
      wall.visible = false;
      const t = info.params.thickness;
      for (const part of parts) {
        const geo = extrude(part, t);
        if (part.meta.rail) {
          // Kızak: yerel (s = dilim ekseni, z = dikey), kalınlık yatay eksende,
          // kanatlara DİK. X diliminde kalınlık model y'de, Y diliminde model x'te.
          const h = part.meta.h;
          const m2 = info.axis === 'x'
            ? basis([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -(h + t / 2)])
            : basis([0, 0, -1], [0, 1, 0], [1, 0, 0], [h - t / 2, 0, 0]);
          geo.applyMatrix4(m2);
          geo.computeVertexNormals();
          group.add(new THREE.Mesh(geo, railMaterial));
          continue;
        }
        const c = (part.meta.coord ?? 0) - t / 2;   // levha, kesit düzlemine ortalanır
        let m;
        if (info.axis === 'x') {
          // yerel u = model y, v = model z, kalınlık = model x
          m = basis([0, 0, -1], [0, 1, 0], [1, 0, 0], [c, 0, 0]);
        } else if (info.axis === 'y') {
          // yerel u = model z, v = model x, kalınlık = model y
          m = basis([0, 1, 0], [1, 0, 0], [0, 0, -1], [0, 0, -c]);
        } else {
          // yerel u = model x, v = model y, kalınlık = model z
          m = basis([1, 0, 0], [0, 0, -1], [0, 1, 0], [0, c, 0]);
        }
        geo.applyMatrix4(m);
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, material));
      }
    } else {
      wall.visible = true;
      const t = info.params.thickness;
      for (const part of parts) {
        const geo = extrude(part, t);
        geo.translate(0, 0, part.meta.z || 0);
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, material));
      }
    }

    // Modeli merkeze al ve kamerayı sığdır.
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);

    if (wall.visible) {
      wall.scale.set(Math.max(size.x, 1) * 2.2, Math.max(size.y, 1) * 2.2, 1);
      wall.position.set(0, 0, -size.z / 2 - 2);
    }

    const radius = Math.max(size.x, size.y, size.z) || 500;
    const dist = radius * 1.7;
    camera.near = Math.max(1, radius / 200);
    camera.far = dist * 12;
    camera.position.set(dist * 0.45, dist * 0.35, dist);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function resize() {
    const w = container.clientWidth || 640;
    const h = container.clientHeight || 480;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  (function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    update,
    resize,
    dispose() {
      running = false;
      ro.disconnect();
      clearGroup();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
