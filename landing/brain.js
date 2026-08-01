import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('brainStage');
if (container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 100);
  camera.position.set(0, 0.06, 0.28);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.06, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = -0.9;
  controls.update();

  let resumeTimer = null;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    clearTimeout(resumeTimer);
  });
  controls.addEventListener('end', () => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 2200);
  });

  /* ---------- seeded simplex noise ---------- */
  const noise3 = (() => {
    const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
    let seed = 20260731;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
    const F3 = 1 / 3, G3 = 1 / 6;
    return function (xin, yin, zin) {
      let n0, n1, n2, n3;
      const s = (xin + yin + zin) * F3;
      const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
      const t = (i + j + k) * G3;
      const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 < 0) n0 = 0; else { const g = grad3[pm12[ii + perm[jj + perm[kk]]]]; t0 *= t0; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0); }
      let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 < 0) n1 = 0; else { const g = grad3[pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]]; t1 *= t1; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1); }
      let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 < 0) n2 = 0; else { const g = grad3[pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]]; t2 *= t2; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2); }
      let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 < 0) n3 = 0; else { const g = grad3[pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]]; t3 *= t3; n3 = t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3); }
      return 32 * (n0 + n1 + n2 + n3);
    };
  })();
  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  /* ---------- X-ray fresnel material ---------- */
  const animMats = [];
  function xrayMaterial(name, colorHex, base, gain, pw) {
    const m = new THREE.ShaderMaterial({
      name,
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uBase: { value: base }, uGain: { value: gain }, uPow: { value: pw }, uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uBase, uGain, uPow, uTime;
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
          float i = uBase + uGain * fr;
          i *= 0.92 + 0.08 * sin(uTime * 1.7 + vW.y * 30.0 + vW.z * 14.0);
          gl_FragColor = vec4(uColor * i, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    animMats.push(m);
    return m;
  }

  /* ---------- cortex shape (shared by mesh + fiber endpoints) ---------- */
  function cortexPoint(dx, dy, dz, out) {
    const ax = Math.abs(dx);
    const n1 = noise3(ax * 1.15 + 11.3, dy * 1.15 + 5.1, dz * 1.15 + 7.7);
    const n1b = noise3(ax * 1.6 + 31.2, dy * 1.6 + 17.9, dz * 1.6 + 3.4);
    const wob = noise3(ax * 2.9, dy * 2.9, dz * 2.9);
    const bandA = Math.sin(n1 * 11.0 + wob * 2.2);
    const bandB = Math.sin(n1b * 9.0 - wob * 1.8 + 2.0);
    const gyri = Math.max(Math.pow(0.5 + 0.5 * bandA, 1.15), 0.85 * Math.pow(0.5 + 0.5 * bandB, 1.15));
    const detail = 0.5 + 0.5 * noise3(dx * 4.6 + 3.1, dy * 4.6, dz * 4.6);
    let r = 0.905 + gyri * 0.155 + detail * 0.04;
    const fis = Math.exp(-(dx * dx) / 0.014) * (0.25 + 0.75 * clamp01((dy + 0.15) / 0.6));
    r -= 0.14 * fis;
    let x = dx * r * 0.76, y = dy * r * 0.72, z = dz * r * 1.0;
    x *= 1 + 0.15 * Math.exp(-Math.pow((y + 0.18) / 0.22, 2)) * Math.exp(-Math.pow((z - 0.15) / 0.55, 2));
    if (y < 0) y *= 0.78;
    x *= 1 - 0.10 * Math.max(0, z - 0.45);
    out.set(x, y + 0.18, z);
    return out;
  }

  const brain = new THREE.Group();
  brain.name = 'holographic-brain';

  /* ---------- cerebral cortex ---------- */
  {
    const g = new THREE.SphereGeometry(1, 200, 148);
    const pos = g.attributes.position;
    const v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      cortexPoint(v.x, v.y, v.z, o);
      pos.setXYZ(i, o.x, o.y, o.z);
    }
    g.computeVertexNormals();
    const cortex = new THREE.Mesh(g, xrayMaterial('cortex-hologram', 0x2066e0, 0.035, 1.35, 2.6));
    cortex.name = 'cerebral-cortex';
    brain.add(cortex);
  }

  /* ---------- cerebellum ---------- */
  {
    const g = new THREE.SphereGeometry(1, 100, 76);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const stri = Math.pow(0.5 + 0.5 * Math.sin(v.y * 30 + noise3(v.x * 3.2, v.y * 3.2, v.z * 3.2) * 1.6), 1.1);
      const r = 0.92 + stri * 0.09 + 0.025 * noise3(v.x * 5 + 9, v.y * 5, v.z * 5);
      const bulge = 1 + 0.12 * Math.abs(v.x);
      pos.setXYZ(i, v.x * r * 0.46 * bulge, v.y * r * 0.27, v.z * r * 0.36);
    }
    g.computeVertexNormals();
    g.translate(0, -0.36, -0.56);
    const cb = new THREE.Mesh(g, xrayMaterial('cerebellum-hologram', 0x3d88f0, 0.08, 1.5, 2.0));
    cb.name = 'cerebellum';
    brain.add(cb);
  }

  /* ---------- brainstem + pons ---------- */
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.10, -0.14),
    new THREE.Vector3(0, -0.30, -0.22),
    new THREE.Vector3(0, -0.50, -0.32),
    new THREE.Vector3(0, -0.70, -0.36),
  ]);
  {
    const g = new THREE.TubeGeometry(stemCurve, 40, 0.08, 20);
    const stem = new THREE.Mesh(g, xrayMaterial('brainstem-hologram', 0x8fc2ff, 0.04, 0.9, 2.0));
    stem.name = 'brainstem';
    brain.add(stem);
    const pg = new THREE.SphereGeometry(1, 40, 30);
    pg.scale(0.14, 0.11, 0.12);
    pg.translate(0, -0.33, -0.15);
    const pons = new THREE.Mesh(pg, xrayMaterial('pons-hologram', 0x7ab2f5, 0.035, 1.1, 2.0));
    pons.name = 'pons';
    brain.add(pons);
  }

  /* ---------- corpus callosum + thalamus ---------- */
  {
    const g = new THREE.TorusGeometry(0.26, 0.042, 14, 64, Math.PI * 1.3);
    g.rotateY(Math.PI / 2);
    g.scale(0.6, 0.85, 1.18);
    g.translate(0, 0.10, 0.02);
    const cc = new THREE.Mesh(g, xrayMaterial('callosum-glow', 0xd8ecff, 0.10, 0.85, 1.7));
    cc.name = 'corpus-callosum';
    brain.add(cc);
    const tg = new THREE.SphereGeometry(0.13, 40, 30);
    tg.scale(1.2, 0.7, 1.15);
    tg.translate(0, -0.03, -0.05);
    const th = new THREE.Mesh(tg, xrayMaterial('thalamus-glow', 0xa8d4ff, 0.045, 0.9, 2.0));
    th.name = 'thalamus';
    brain.add(th);
  }

  /* ---------- neural pathways (glowing fiber curves) ---------- */
  const curves = [];
  let particles, particleData = [], P = 0;
  {
    let s = 424242;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const dirTmp = new THREE.Vector3(), pTmp = new THREE.Vector3();
    const center = new THREE.Vector3(0, 0.15, 0);
    function cortexAnchor(sideSign) {
      do {
        dirTmp.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      } while (dirTmp.lengthSq() > 1 || dirTmp.lengthSq() < 0.05 || dirTmp.y < -0.45 || (sideSign !== 0 && Math.sign(dirTmp.x || 1) !== sideSign) || Math.abs(dirTmp.x) < 0.12);
      dirTmp.normalize();
      cortexPoint(dirTmp.x, dirTmp.y, dirTmp.z, pTmp);
      return pTmp.clone().sub(center).multiplyScalar(0.90).add(center);
    }
    const jit = (a) => new THREE.Vector3((rnd() * 2 - 1) * a, (rnd() * 2 - 1) * a, (rnd() * 2 - 1) * a);
    const N = 70;
    for (let i = 0; i < N; i++) {
      const kind = i % 3;
      let pts;
      if (kind === 0) {
        const a = cortexAnchor(0);
        pts = [a,
          a.clone().lerp(center, 0.5).add(jit(0.08)),
          new THREE.Vector3(0, -0.10, -0.14).add(jit(0.05)),
          new THREE.Vector3(0, -0.42, -0.28).add(jit(0.035)),
          new THREE.Vector3(0, -0.62, -0.40).add(jit(0.03))];
      } else if (kind === 1) {
        const a = cortexAnchor(-1), b = cortexAnchor(1);
        pts = [a,
          a.clone().lerp(center, 0.45).add(jit(0.06)),
          new THREE.Vector3(0, 0.26 + rnd() * 0.1, -0.05 + rnd() * 0.25),
          b.clone().lerp(center, 0.45).add(jit(0.06)),
          b];
      } else {
        const side = rnd() > 0.5 ? 1 : -1;
        const a = cortexAnchor(side), b = cortexAnchor(side);
        pts = [a, a.clone().lerp(center, 0.5).add(jit(0.07)), b.clone().lerp(center, 0.5).add(jit(0.07)), b];
      }
      curves.push(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.6));
    }
    const SEG = 48;
    const positions = new Float32Array(N * SEG * 2 * 3);
    const along = new Float32Array(N * SEG * 2);
    const seeds = new Float32Array(N * SEG * 2);
    let w = 0;
    curves.forEach((c) => {
      const pts = c.getPoints(SEG);
      const sd = rnd();
      for (let j = 0; j < SEG; j++) {
        for (const [pt, tt] of [[pts[j], j / SEG], [pts[j + 1], (j + 1) / SEG]]) {
          positions[w * 3] = pt.x; positions[w * 3 + 1] = pt.y; positions[w * 3 + 2] = pt.z;
          along[w] = tt; seeds[w] = sd; w++;
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const m = new THREE.ShaderMaterial({
      name: 'neural-glow',
      uniforms: { uTime: { value: 0 }, uColA: { value: new THREE.Color(0x2f7dff) }, uColB: { value: new THREE.Color(0xffffff) } },
      vertexShader: `
        attribute float aAlong; attribute float aSeed;
        varying float vA; varying float vS;
        void main() { vA = aAlong; vS = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColA, uColB;
        varying float vA; varying float vS;
        void main() {
          float sp = 0.06 + 0.10 * fract(vS * 7.31);
          float t1 = fract(vA - uTime * sp - vS);
          float t2 = fract(vA - uTime * sp - vS + 0.5);
          float head = exp(-t1 * 16.0) + 0.6 * exp(-t2 * 20.0);
          float i = 0.17 + head * 2.0;
          vec3 col = mix(uColA, uColB, clamp(head * 1.1, 0.0, 1.0));
          gl_FragColor = vec4(col * i, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    animMats.push(m);
    const lines = new THREE.LineSegments(g, m);
    lines.name = 'neural-pathways';
    brain.add(lines);

    /* ---------- particles riding the fibers ---------- */
    function glowTexture() {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.35, 'rgba(210,235,255,0.55)');
      gr.addColorStop(1, 'rgba(160,210,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }
    const spriteTex = glowTexture();
    P = 170;
    let s2 = 777; const rnd2 = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
    const positions2 = new Float32Array(P * 3);
    for (let i = 0; i < P; i++) particleData.push({ ci: Math.floor(rnd2() * curves.length), ph: rnd2(), sp: 0.05 + rnd2() * 0.10 });
    const pg2 = new THREE.BufferGeometry();
    pg2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
    const pm = new THREE.PointsMaterial({
      name: 'signal-sparks', map: spriteTex, color: 0xcfe8ff, size: 0.0056,
      sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    particles = new THREE.Points(pg2, pm);
    particles.name = 'signal-particles';
    particles.frustumCulled = false;
    brain.add(particles);
  }

  brain.scale.setScalar(0.105);
  brain.position.y = 0.035;
  scene.add(brain);

  /* ---------- ambience: dust (halo olib tashlandi) ---------- */
  const fx = new THREE.Group();
  fx.scale.setScalar(0.105);
  let dust;
  {
    let s = 31337; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const D = 220;
    const positions = new Float32Array(D * 3);
    for (let i = 0; i < D; i++) {
      const r = 1.35 + rnd() * 0.75, th = rnd() * Math.PI * 2, ph = Math.acos(rnd() * 2 - 1);
      positions[i * 3] = r * Math.sin(ph) * Math.cos(th);
      positions[i * 3 + 1] = r * Math.cos(ph) * 0.85 + 0.1;
      positions[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) * 1.15;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(210,235,255,0.55)'); gr.addColorStop(1, 'rgba(160,210,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    dust = new THREE.Points(g, new THREE.PointsMaterial({
      map: glowTex, color: 0x5f9fdf, size: 0.006, sizeAttenuation: true,
      transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    dust.frustumCulled = false;
    fx.add(dust);
  }
  fx.position.y = 0.035;
  scene.add(fx);

  /* ---------- render loop ---------- */
  const pv = new THREE.Vector3();
  function animate(now) {
    requestAnimationFrame(animate);
    const t = now / 1000;
    for (const m of animMats) if (m.uniforms.uTime) m.uniforms.uTime.value = t;
    const pp = particles.geometry.attributes.position;
    for (let i = 0; i < P; i++) {
      const d = particleData[i];
      curves[d.ci].getPointAt((d.ph + t * d.sp) % 1, pv);
      pp.setXYZ(i, pv.x, pv.y, pv.z);
    }
    pp.needsUpdate = true;
    dust.rotation.y = t * 0.02;
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}
