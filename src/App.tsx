import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import './App.css';

type CrateConfig = {
  width: number;
  height: number;
  depth: number;
  slats: number;
  thickness: number;
  woodColor: string;
  metalColor: string;
  frame: boolean;
  industrial: boolean;
};

type ModelStats = { parts: number; vertices: number };
type ViewportHandle = { exportGlb: () => Promise<void>; resetView: () => void };

const INITIAL_CONFIG: CrateConfig = {
  width: 2.4,
  height: 2.2,
  depth: 1.6,
  slats: 5,
  thickness: 0.12,
  woodColor: '#b87945',
  metalColor: '#303f4c',
  frame: true,
  industrial: false,
};

const PRESETS: Record<string, Partial<CrateConfig>> = {
  crate: { woodColor: '#b87945', metalColor: '#303f4c', frame: true, industrial: false, slats: 5 },
  dark: { woodColor: '#654734', metalColor: '#202b35', frame: true, industrial: false, slats: 4 },
  industrial: { woodColor: '#6e777c', metalColor: '#d08b42', frame: true, industrial: true, slats: 4 },
};

function addBox(
  parent: THREE.Group,
  name: string,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createCrate(config: CrateConfig): THREE.Group {
  const width = Math.max(0.5, config.width);
  const height = Math.max(0.5, config.height);
  const depth = Math.max(0.5, config.depth);
  const t = Math.min(config.thickness, width * 0.14, depth * 0.14, height * 0.14);
  const slats = Math.max(2, Math.min(8, Math.round(config.slats)));
  const gap = Math.min(0.035, t * 0.28);
  const root = new THREE.Group();
  root.name = 'Object Forge — Procedural Crate';

  const wood = new THREE.MeshStandardMaterial({ color: config.woodColor, roughness: 0.82, metalness: config.industrial ? 0.12 : 0.02 });
  const woodLight = new THREE.MeshStandardMaterial({ color: new THREE.Color(config.woodColor).multiplyScalar(1.12), roughness: 0.8, metalness: 0.02 });
  const metal = new THREE.MeshStandardMaterial({ color: config.metalColor, roughness: 0.42, metalness: 0.72 });

  // The base sits on y=0; all dimensions use simple scene units.
  addBox(root, 'Base panel', width, t, depth, 0, t / 2, 0, wood);

  if (config.frame) {
    const xPost = width / 2 - t / 2;
    const zPost = depth / 2 - t / 2;
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        addBox(root, `Corner post ${xSign}_${zSign}`, t, height, t, xSign * xPost, height / 2, zSign * zPost, woodLight);
      }
    }
    // Top rails reinforce the open crate without closing its opening.
    addBox(root, 'Front top rail', width, t * 0.82, t * 0.82, 0, height - t * 0.48, depth / 2 - t * 0.42, woodLight);
    addBox(root, 'Back top rail', width, t * 0.82, t * 0.82, 0, height - t * 0.48, -depth / 2 + t * 0.42, woodLight);
    addBox(root, 'Left top rail', t * 0.82, t * 0.82, depth, -width / 2 + t * 0.42, height - t * 0.48, 0, woodLight);
    addBox(root, 'Right top rail', t * 0.82, t * 0.82, depth, width / 2 - t * 0.42, height - t * 0.48, 0, woodLight);
  }

  const usableHeight = Math.max(t * 1.5, height - t * 2.2);
  const boardHeight = Math.max(t * 0.45, (usableHeight - gap * (slats - 1)) / slats);
  const frontBoardDepth = t * 0.72;
  const sideBoardWidth = t * 0.72;
  const boardWidth = Math.max(t, width - (config.frame ? 2 * t : t * 0.5));
  const boardDepth = Math.max(t, depth - (config.frame ? 2 * t : t * 0.5));
  const zFront = depth / 2 - frontBoardDepth / 2;
  const xSide = width / 2 - sideBoardWidth / 2;

  for (let i = 0; i < slats; i += 1) {
    const y = t + boardHeight / 2 + i * (boardHeight + gap);
    addBox(root, `Front slat ${i + 1}`, boardWidth, boardHeight, frontBoardDepth, 0, y, zFront, i % 2 === 0 ? wood : woodLight);
    addBox(root, `Back slat ${i + 1}`, boardWidth, boardHeight, frontBoardDepth, 0, y, -zFront, i % 2 === 0 ? wood : woodLight);
    addBox(root, `Left slat ${i + 1}`, sideBoardWidth, boardHeight, boardDepth, -xSide, y, 0, i % 2 === 0 ? wood : woodLight);
    addBox(root, `Right slat ${i + 1}`, sideBoardWidth, boardHeight, boardDepth, xSide, y, 0, i % 2 === 0 ? wood : woodLight);
  }

  if (config.industrial) {
    const plateW = Math.min(0.2, width * 0.09);
    const plateH = Math.min(0.28, height * 0.13);
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        addBox(
          root,
          `Metal corner plate ${xSign}_${zSign}`,
          plateW,
          plateH,
          t * 0.18,
          xSign * (width / 2 - plateW / 2),
          Math.min(height - plateH / 2, height * 0.76),
          zSign * (depth / 2 + 0.006),
          metal,
        );
      }
    }
  }

  root.userData.generator = { type: 'crate', version: 1, ...config };
  root.updateMatrixWorld(true);
  return root;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function formatNumber(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

const Viewport = forwardRef<ViewportHandle, {
  config: CrateConfig;
  onStats: (stats: ModelStats) => void;
  onExportState: (busy: boolean) => void;
}>(({ config, onStats, onExportState }, ref) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      host.innerHTML = '<div class="viewport-error"><strong>WebGL indisponível</strong><span>Verifique a aceleração gráfica do navegador e recarregue a página.</span></div>';
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'forge-canvas';
    renderer.domElement.setAttribute('aria-label', 'Viewport 3D do objeto');
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#101820');
    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(1, host.clientHeight), 0.05, 100);
    camera.position.set(4.8, 3.7, 5.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 2.2;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, configRef.current.height * 0.48, 0);
    controls.update();
    controls.saveState();

    scene.add(new THREE.HemisphereLight(0xdce9f4, 0x27303a, 2.0));
    const key = new THREE.DirectionalLight(0xffe0b5, 3.1);
    key.position.set(4.5, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -2;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x83b9d9, 1.1);
    fill.position.set(-5, 3, -4);
    scene.add(fill);

    const grid = new THREE.GridHelper(20, 40, 0x506273, 0x263642);
    grid.position.y = -0.006;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.56;
    });
    scene.add(grid);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;

    const resizeObserver = new ResizeObserver(() => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resizeObserver.observe(host);

    let frameId = 0;
    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      const model = modelRef.current;
      if (model) disposeGroup(model);
      modelRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
    };
    // Mount the WebGL scene exactly once. Model changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const previous = modelRef.current;
    if (previous) {
      scene.remove(previous);
      disposeGroup(previous);
    }
    const model = createCrate(config);
    scene.add(model);
    modelRef.current = model;
    controlsRef.current?.target.set(0, config.height * 0.48, 0);
    controlsRef.current?.update();

    let parts = 0;
    let vertices = 0;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        parts += 1;
        vertices += object.geometry.getAttribute('position')?.count ?? 0;
      }
    });
    onStats({ parts, vertices });
  }, [config, onStats]);

  useImperativeHandle(ref, () => ({
    resetView() {
      controlsRef.current?.reset();
      controlsRef.current?.target.set(0, configRef.current.height * 0.48, 0);
      controlsRef.current?.update();
    },
    async exportGlb() {
      const model = modelRef.current;
      if (!model) throw new Error('Nenhum modelo está pronto para exportação.');
      onExportState(true);
      try {
        model.updateMatrixWorld(true);
        const exporter = new GLTFExporter();
        const result = await new Promise<ArrayBuffer>((resolve, reject) => {
          exporter.parse(
            model,
            (output) => {
              if (output instanceof ArrayBuffer) resolve(output);
              else reject(new Error('O exportador retornou glTF JSON em vez de GLB binário.'));
            },
            (error) => reject(error),
            { binary: true, onlyVisible: true },
          );
        });
        downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), 'object-forge-crate.glb');
      } finally {
        onExportState(false);
      }
    },
  }), [onExportState]);

  return <div className="viewport-mount" ref={mountRef} />;
});
Viewport.displayName = 'Viewport';

function RangeControl({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void;
}) {
  return (
    <label className="control-group">
      <span className="control-label"><span>{label}</span><strong>{formatNumber(value)}{unit ? ` ${unit}` : ''}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="range-limits"><span>{min}{unit ? ` ${unit}` : ''}</span><span>{max}{unit ? ` ${unit}` : ''}</span></span>
    </label>
  );
}

export default function App() {
  const [config, setConfig] = useState<CrateConfig>(INITIAL_CONFIG);
  const [stats, setStats] = useState<ModelStats>({ parts: 0, vertices: 0 });
  const [status, setStatus] = useState('Modelo procedural pronto');
  const [exporting, setExporting] = useState(false);
  const viewportRef = useRef<ViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateConfig = useCallback(<K extends keyof CrateConfig,>(key: K, value: CrateConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setStatus('Geometria atualizada');
  }, []);

  const onStats = useCallback((nextStats: ModelStats) => setStats(nextStats), []);
  const onExportState = useCallback((busy: boolean) => setExporting(busy), []);

  const exportGlb = async () => {
    try {
      await viewportRef.current?.exportGlb();
      setStatus('Modelo GLB exportado');
    } catch (error) {
      setStatus(`Falha ao exportar: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    }
  };

  const savePreset = () => {
    const project = {
      format: 'object-forge-project',
      version: 1,
      objectType: 'crate',
      name: 'Caixa procedural',
      config,
      savedAt: new Date().toISOString(),
    };
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'object-forge-project.json');
    setStatus('Configuração do objeto salva');
  };

  const loadPreset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('Estrutura JSON inválida.');
      const record = parsed as { format?: unknown; version?: unknown; objectType?: unknown; config?: Partial<CrateConfig> };
      if (record.format !== 'object-forge-project' || record.version !== 1 || record.objectType !== 'crate' || !record.config) {
        throw new Error('Este arquivo não é um projeto Object Forge compatível.');
      }
      const next = { ...INITIAL_CONFIG, ...record.config };
      if (![next.width, next.height, next.depth, next.slats, next.thickness].every((v) => typeof v === 'number' && Number.isFinite(v)) ||
          typeof next.woodColor !== 'string' || typeof next.metalColor !== 'string' || typeof next.frame !== 'boolean' || typeof next.industrial !== 'boolean') {
        throw new Error('O projeto contém parâmetros inválidos.');
      }
      setConfig({
        ...next,
        width: THREE.MathUtils.clamp(next.width, 0.5, 4),
        height: THREE.MathUtils.clamp(next.height, 0.5, 4),
        depth: THREE.MathUtils.clamp(next.depth, 0.5, 4),
        slats: THREE.MathUtils.clamp(Math.round(next.slats), 2, 8),
        thickness: THREE.MathUtils.clamp(next.thickness, 0.04, 0.3),
      });
      setStatus('Projeto carregado');
    } catch (error) {
      setStatus(`Não foi possível abrir o projeto: ${error instanceof Error ? error.message : 'JSON inválido'}`);
    }
  };

  const setPreset = (name: keyof typeof PRESETS) => {
    setConfig((current) => ({ ...current, ...PRESETS[name] }));
    setStatus(name === 'industrial' ? 'Estilo industrial aplicado' : 'Estilo aplicado');
  };

  return (
    <main className="forge-app">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><div className="brand-name">OBJECT <b>FORGE</b></div><div className="brand-caption">PROCEDURAL STUDIO <span>•</span> LOCAL</div></div>
        </div>
        <div className="topbar-center"><span className="live-dot" /> GERADOR PROCEDURAL <span className="topbar-divider">/</span> CAIXA 3D</div>
        <div className="topbar-actions">
          <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={loadPreset} />
          <button className="button button-quiet" onClick={() => fileInputRef.current?.click()}><Icon name="folder" /> Abrir projeto</button>
          <button className="button button-quiet" onClick={savePreset}><Icon name="save" /> Salvar preset</button>
          <button className="button button-primary" onClick={exportGlb} disabled={exporting}>{exporting ? <span className="spinner" /> : <Icon name="download" />} {exporting ? 'Exportando…' : 'Exportar GLB'}</button>
        </div>
      </header>

      <div className="app-body">
        <aside className="inspector-panel">
          <div className="panel-heading"><div><div className="eyebrow">WORKSPACE / 01</div><h1>Gerador de objetos</h1></div><span className="panel-number">01</span></div>
          <div className="object-card">
            <div className="object-card-icon"><Icon name="box" /></div>
            <div className="object-card-copy"><strong>Caixa de armazenamento</strong><span>Malha procedural • editável</span></div>
            <span className="object-status">ATIVO</span>
          </div>

          <section className="inspector-section">
            <div className="section-title"><span>01</span><h2>Dimensões</h2><span className="section-line" /></div>
            <RangeControl label="Largura" value={config.width} min={0.5} max={4} step={0.1} unit="m" onChange={(v) => updateConfig('width', v)} />
            <RangeControl label="Altura" value={config.height} min={0.5} max={4} step={0.1} unit="m" onChange={(v) => updateConfig('height', v)} />
            <RangeControl label="Profundidade" value={config.depth} min={0.5} max={4} step={0.1} unit="m" onChange={(v) => updateConfig('depth', v)} />
          </section>

          <section className="inspector-section">
            <div className="section-title"><span>02</span><h2>Construção</h2><span className="section-line" /></div>
            <RangeControl label="Tábuas por lado" value={config.slats} min={2} max={8} step={1} onChange={(v) => updateConfig('slats', v)} />
            <RangeControl label="Espessura das peças" value={config.thickness} min={0.04} max={0.3} step={0.01} unit="m" onChange={(v) => updateConfig('thickness', v)} />
            <label className="switch-row"><span><strong>Estrutura reforçada</strong><small>Postes e travessas superiores</small></span><input type="checkbox" checked={config.frame} onChange={(e) => updateConfig('frame', e.target.checked)} /><span className="switch-ui" /></label>
            <label className="switch-row"><span><strong>Detalhes industriais</strong><small>Placas metálicas nos cantos</small></span><input type="checkbox" checked={config.industrial} onChange={(e) => updateConfig('industrial', e.target.checked)} /><span className="switch-ui" /></label>
          </section>

          <section className="inspector-section material-section">
            <div className="section-title"><span>03</span><h2>Materiais</h2><span className="section-line" /></div>
            <label className="color-row"><span><strong>Material principal</strong><small>Madeira / corpo</small></span><input aria-label="Cor da madeira" type="color" value={config.woodColor} onChange={(e) => updateConfig('woodColor', e.target.value)} /></label>
            <label className="color-row"><span><strong>Material de detalhe</strong><small>Metal / reforços</small></span><input aria-label="Cor do metal" type="color" value={config.metalColor} onChange={(e) => updateConfig('metalColor', e.target.value)} /></label>
            <div className="preset-label">PRESETS RÁPIDOS</div>
            <div className="preset-grid">
              <button className={`preset-button ${!config.industrial && config.woodColor === PRESETS.crate.woodColor ? 'selected' : ''}`} onClick={() => setPreset('crate')}><span className="preset-swatch wood" /><span>Madeira clara</span></button>
              <button className={`preset-button ${!config.industrial && config.woodColor === PRESETS.dark.woodColor ? 'selected' : ''}`} onClick={() => setPreset('dark')}><span className="preset-swatch dark-wood" /><span>Madeira escura</span></button>
              <button className={`preset-button ${config.industrial ? 'selected' : ''}`} onClick={() => setPreset('industrial')}><span className="preset-swatch metal" /><span>Industrial</span></button>
            </div>
          </section>

          <div className="inspector-footer"><span className="footer-indicator" /> Parâmetros atualizados em tempo real <span className="shortcut">v0.1</span></div>
        </aside>

        <section className="viewport-panel">
          <div className="viewport-toolbar"><div className="viewport-breadcrumb"><span>OBJETO</span><span className="crumb-separator">/</span><strong>Caixa procedural</strong></div><div className="viewport-actions"><span className="viewport-mode"><Icon name="box" /> PERSPECTIVA 3D</span><button className="icon-button" onClick={() => viewportRef.current?.resetView()} title="Redefinir câmera" aria-label="Redefinir câmera"><Icon name="refresh" /></button></div></div>
          <div className="viewport-wrap"><Viewport ref={viewportRef} config={config} onStats={onStats} onExportState={onExportState} /><div className="viewport-top-badge"><span className="live-dot" /> LIVE PREVIEW</div><div className="viewport-axis"><span>X</span><span>Y</span><span>Z</span></div><div className="viewport-hint"><span className="hint-mouse"><Icon name="mouse" /></span><span>Arraste para orbitar <i /> Scroll para zoom <i /> Botão direito para mover</span></div><div className="viewport-dimensions"><span>W {formatNumber(config.width)} m</span><span>H {formatNumber(config.height)} m</span><span>D {formatNumber(config.depth)} m</span></div></div>
          <div className="viewport-statusbar"><div className="status-left"><span className="status-check"><Icon name="check" /></span><span>{status}</span></div><div className="status-right"><span>{stats.parts} peças</span><span className="status-separator">/</span><span>{stats.vertices.toLocaleString('pt-BR')} vértices</span><span className="status-separator">/</span><span>GLB READY</span></div></div>
        </section>
      </div>

      <footer className="app-footer"><span>OBJECT FORGE 3D <b>•</b> V0.1.0</span><span>LOCAL WORKSPACE <b>•</b> SEM SERVIÇOS EXTERNOS</span><span>THREE.JS ENGINE <b>•</b> PROCEDURAL MESH</span></footer>
    </main>
  );
}

function Icon({ name }: { name: 'folder' | 'save' | 'download' | 'box' | 'refresh' | 'mouse' | 'check' }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  switch (name) {
    case 'folder': return <svg {...common}><path d="M3 6.5h6l2 2h10v9.8A1.7 1.7 0 0 1 19.3 20H4.7A1.7 1.7 0 0 1 3 18.3z"/><path d="M3 9h18"/></svg>;
    case 'save': return <svg {...common}><path d="M5 3h12l4 4v14H3V3z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg>;
    case 'download': return <svg {...common}><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v4h16v-4"/></svg>;
    case 'box': return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></svg>;
    case 'refresh': return <svg {...common}><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.7-2L20 12M4 12l2.8 5a7 7 0 0 0 11.7-2"/></svg>;
    case 'mouse': return <svg {...common}><rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v5"/></svg>;
    case 'check': return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  }
}
