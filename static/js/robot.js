/* =========================================================
   OMINI — robot controller
   Loads the custom GLB model (static/models/omini_bot.glb).
   Falls back to a simple procedural robot if the model or
   GLTFLoader fails to load, so the page never breaks.

   Each call to OminiRobot.build(containerId) creates its own
   independent Three.js scene/camera/renderer/animation loop.
   This matters because some pages (e.g. the dashboard) mount
   more than one robot at once — sharing state between them
   would make every instance but the last one render blank.
   ========================================================= */

window.OminiRobot = (function () {
  const MODEL_URL = "/static/models/omini_bot.glb";

  const STATE_LIGHT_COLOR = {
    idle: 0x2fd8ff,
    listening: 0x33e29a,
    thinking: 0x9b5cff,
    talking: 0x2fd8ff,
    happy: 0xffd166,
    sad: 0xff5470,
  };
  const STATE_SPEED = { idle: 1, listening: 1.2, thinking: 0.6, talking: 1.8, happy: 1.4, sad: 0.5 };

  function build(containerId) {
    try {
      return buildInstance(containerId);
    } catch (err) {
      console.warn("OminiRobot failed to build 3D scene, continuing without it:", err);
      return { setState: () => {}, speak: () => {}, isUsingModel: () => false };
    }
  }

  function buildInstance(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !window.THREE) {
      return { setState: () => {}, speak: () => {}, isUsingModel: () => false };
    }

    // All state below is local to THIS instance only — no module-level
    // sharing, so multiple robots on one page run independently.
    const inst = {
      scene: null, camera: null, renderer: null, root: null, clock: null,
      mixer: null, modelGroup: null,
      mouse: { x: 0, y: 0 },
      state: "idle",
      usingModel: false,
      lights: {},
      alive: true,
    };

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 400;

    inst.scene = new THREE.Scene();
    inst.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    inst.camera.position.set(0, 0.4, 6.2);

    inst.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    inst.renderer.setSize(width, height);
    inst.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (inst.renderer.outputEncoding !== undefined && THREE.sRGBEncoding) {
      inst.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    container.appendChild(inst.renderer.domElement);

    inst.scene.add(new THREE.AmbientLight(0x8899ff, 0.6));
    inst.lights.key = new THREE.PointLight(0x2fd8ff, 3.2, 20);
    inst.lights.key.position.set(2.5, 2.5, 3);
    inst.scene.add(inst.lights.key);
    inst.lights.rim = new THREE.PointLight(0x9b5cff, 2.6, 20);
    inst.lights.rim.position.set(-2.5, -1.5, 2);
    inst.scene.add(inst.lights.rim);
    inst.lights.fill = new THREE.PointLight(0xffffff, 0.7, 20);
    inst.lights.fill.position.set(0, 1, 4);
    inst.scene.add(inst.lights.fill);

    inst.root = new THREE.Group();
    inst.scene.add(inst.root);

    // Floating holographic platform rings under the robot either way
    const ringGeo = new THREE.TorusGeometry(1.15, 0.012, 8, 100);
    const ring1 = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x2fd8ff, transparent: true, opacity: 0.55 }));
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = -1.25;
    inst.root.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.008, 8, 100), new THREE.MeshBasicMaterial({ color: 0x9b5cff, transparent: true, opacity: 0.35 }));
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = -1.26;
    inst.root.add(ring2);

    inst.clock = new THREE.Clock();

    const onResize = () => {
      if (!inst.alive || !container || !inst.renderer || !inst.camera) return;
      const w = container.clientWidth || 400;
      const h = container.clientHeight || 400;
      inst.camera.aspect = w / h;
      inst.camera.updateProjectionMatrix();
      inst.renderer.setSize(w, h);
    };
    const onMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      inst.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      inst.mouse.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    };
    window.addEventListener("resize", onResize);
    container.addEventListener("mousemove", onMouseMove);

    tryLoadModel(inst);
    animate(inst, ring1, ring2);

    return {
      setState: (newState) => { inst.state = newState; },
      speak: (durationMs) => {
        inst.state = "talking";
        setTimeout(() => { inst.state = "idle"; }, durationMs || 2200);
      },
      isUsingModel: () => inst.usingModel,
    };
  }

  function tryLoadModel(inst) {
    if (!window.THREE || !THREE.GLTFLoader) {
      buildProceduralFallback(inst);
      return;
    }
    const loader = new THREE.GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (!inst.alive) return;
        try {
          inst.modelGroup = gltf.scene;
          normalizeAndCenter(inst.modelGroup, 2.1);
          inst.root.add(inst.modelGroup);
          inst.usingModel = true;

          if (gltf.animations && gltf.animations.length) {
            inst.mixer = new THREE.AnimationMixer(inst.modelGroup);
            const idleClip = gltf.animations.find(c => /idle/i.test(c.name)) || gltf.animations[0];
            const action = inst.mixer.clipAction(idleClip);
            action.play();
          }
        } catch (e) {
          console.warn("OMINI model post-processing failed, falling back:", e);
          buildProceduralFallback(inst);
        }
      },
      undefined,
      (err) => {
        console.warn("OMINI could not load the custom model, using procedural fallback:", err);
        buildProceduralFallback(inst);
      }
    );
  }

  function normalizeAndCenter(object, targetHeight) {
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);

    const scale = targetHeight / (size.y || 1);
    object.scale.setScalar(scale);

    const box2 = new THREE.Box3().setFromObject(object);
    const center2 = new THREE.Vector3();
    box2.getCenter(center2);
    object.position.x -= center2.x;
    object.position.z -= center2.z;
    object.position.y -= box2.min.y; // sit on the "floor"
    object.position.y -= 1.0; // align with ring height
  }

  // ---- Procedural fallback (used only if the GLB model can't load) ----
  function buildProceduralFallback(inst) {
    inst.usingModel = false;
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe7edff, metalness: 0.85, roughness: 0.22 });
    const darkPanel = new THREE.MeshStandardMaterial({ color: 0x11162a, metalness: 0.6, roughness: 0.4 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x2fd8ff });

    inst.modelGroup = new THREE.Group();

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 32), chrome);
    head.scale.set(1, 1.08, 0.94);
    head.position.y = 1.05;
    inst.modelGroup.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.075, 16, 16);
    const eyeL = new THREE.Mesh(eyeGeo, glow.clone());
    eyeL.position.set(-0.18, 1.06, 0.52);
    const eyeR = new THREE.Mesh(eyeGeo, glow.clone());
    eyeR.position.set(0.18, 1.06, 0.52);
    inst.modelGroup.add(eyeL, eyeR);
    inst.modelGroup.userData.eyes = [eyeL, eyeR];

    const torsoBody = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.48, 0.9, 24), chrome);
    torsoBody.position.y = -0.05;
    torsoBody.scale.set(1, 1, 0.75);
    inst.modelGroup.add(torsoBody);

    [-1, 1].forEach((side) => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 12), darkPanel);
      arm.position.set(0.66 * side, -0.28, 0);
      inst.modelGroup.add(arm);
    });

    inst.root.add(inst.modelGroup);
  }

  function animate(inst, ring1, ring2) {
    requestAnimationFrame(() => animate(inst, ring1, ring2));
    if (!inst.alive || !inst.clock || !inst.root) return;
    const t = inst.clock.getElapsedTime();
    const delta = inst.clock.getDelta();

    inst.root.position.y = Math.sin(t * 1.1) * 0.05;
    inst.root.rotation.y = inst.mouse.x * 0.25;
    if (inst.modelGroup) {
      inst.modelGroup.rotation.y = Math.sin(t * 0.4) * 0.05;
    }

    if (ring1) ring1.rotation.z = t * 0.3;
    if (ring2) ring2.rotation.z = -t * 0.22;

    const color = STATE_LIGHT_COLOR[inst.state] ?? 0x2fd8ff;
    if (inst.lights.key) inst.lights.key.color.set(color);
    if (inst.modelGroup && inst.modelGroup.userData.eyes) {
      inst.modelGroup.userData.eyes.forEach(e => e.material.color.set(color));
    }

    if (inst.mixer) inst.mixer.update(delta * (STATE_SPEED[inst.state] ?? 1));

    inst.renderer.render(inst.scene, inst.camera);
  }

  return { build };
})();