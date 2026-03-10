import React, { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import ForceGraph3D, { ForceGraphMethods } from 'react-force-graph-3d';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GraphData, GraphNode } from '../types';

interface Graph3DProps {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  onClearSelection: () => void;
  selectedNode?: GraphNode | null;
  keepOrphans?: boolean;
}

const Graph3D: React.FC<Graph3DProps> = ({ data, onNodeClick, onClearSelection, selectedNode, keepOrphans = false }) => {
  const graphRef = useRef<ForceGraphMethods>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Map<string, { element: HTMLDivElement; object: THREE.Object3D }>>(new Map());
  const materialsRef = useRef<Map<string, Array<(THREE.Material & { color?: THREE.Color })>>>(new Map());
  const galaxyRef = useRef<THREE.Group | null>(null);

  // Track container dimensions for responsive sizing
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  const hashToUnit = useCallback((str: string) => {
    // Deterministic 0..1 hash for stable link rotations/curvature
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // >>> 0 ensures unsigned
    return ((h >>> 0) % 10000) / 10000;
  }, []);

  const getFollowerT = useCallback((followers: unknown) => {
    if (typeof followers !== 'number' || followers <= 0) return 0;
    const minF = 1_000;
    const maxF = 20_000_000;
    const minLg = Math.log10(minF + 1);
    const maxLg = Math.log10(maxF + 1);
    const lg = Math.log10(followers + 1);
    let t = (lg - minLg) / (maxLg - minLg);
    t = Math.max(0, Math.min(1, t));
    // Expand low/mid differences
    return Math.pow(t, 0.78);
  }, []);

  // Renderer perf tuning (lower DPR = big GPU savings)
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      const fg = graphRef.current;
      const renderer: any = fg ? (fg as any).renderer?.() : null;
      if (renderer) {
        const dpr = window.devicePixelRatio || 1;
        // Keep conservative — galaxy uses lots of transparent particles
        renderer.setPixelRatio(Math.min(dpr, 1.1));
        return;
      }
      if (!cancelled) requestAnimationFrame(apply);
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      } else {
        setDimensions({
          width: window.innerWidth,
          height: window.innerHeight
        });
      }
    };

    // Initial size
    handleResize();

    // Listen for resize
    window.addEventListener('resize', handleResize);

    // Also use ResizeObserver for more accurate container tracking
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  const createRadialGradientTexture = useCallback((stops: Array<{ at: number; color: string }>) => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(s => g.addColorStop(s.at, s.color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);

  const createStarburstTexture = useCallback(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = size / 2;
    const cy = size / 2;

    // Radial glow
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
    g.addColorStop(1.0, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    // Soft spikes (4 main + 4 minor)
    ctx.save();
    ctx.translate(cx, cy);
    const spikes = [
      { w: 10, h: 110, a: 0.22 },
      { w: 10, h: 110, a: 0.22, rot: Math.PI / 2 },
      { w: 7, h: 85, a: 0.18, rot: Math.PI / 4 },
      { w: 7, h: 85, a: 0.18, rot: (3 * Math.PI) / 4 },
    ];

    spikes.forEach(s => {
      ctx.save();
      ctx.rotate(s.rot || 0);
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createLinearGradient(0, 0, 0, -s.h);
      lg.addColorStop(0.0, `rgba(255,255,255,${s.a})`);
      lg.addColorStop(0.6, `rgba(255,255,255,${s.a * 0.5})`);
      lg.addColorStop(1.0, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(-s.w, 0);
      ctx.lineTo(0, -s.h);
      ctx.lineTo(s.w, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);

  const nodeGlowTexture = useMemo(() => {
    return createRadialGradientTexture([
      { at: 0.0, color: 'rgba(255,255,255,1.0)' },
      { at: 0.12, color: 'rgba(255,255,255,0.85)' },
      { at: 0.35, color: 'rgba(255,255,255,0.35)' },
      { at: 0.7, color: 'rgba(255,255,255,0.08)' },
      { at: 1.0, color: 'rgba(0,0,0,0.0)' },
    ]);
  }, [createRadialGradientTexture]);

  const nodeStarburstTexture = useMemo(() => createStarburstTexture(), [createStarburstTexture]);

  const createGalaxyBackdrop = useCallback(() => {
    const group = new THREE.Group();
    group.name = 'galaxy-backdrop';

    // 1) Background stars (spherical distribution)
    const isMobile = window.innerWidth < 768;
    const dpr = window.devicePixelRatio || 1;
    const quality = Math.max(0.45, Math.min(1, (isMobile ? 0.7 : 1) * (1.1 / Math.min(dpr, 2))));

    const starCount = Math.round(2600 * quality);
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    const c1 = new THREE.Color('#FFFFFF');
    const c2 = new THREE.Color('#A3D4FF');
    const c3 = new THREE.Color('#E0B3FF');

    for (let i = 0; i < starCount; i++) {
      // random point in a shell
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 1400 + Math.random() * 1400;
      const sinPhi = Math.sin(phi);

      const x = r * sinPhi * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * sinPhi * Math.sin(theta);

      const idx = i * 3;
      starPositions[idx] = x;
      starPositions[idx + 1] = y;
      starPositions[idx + 2] = z;

      const pick = Math.random();
      const col = pick < 0.7 ? c1 : pick < 0.85 ? c2 : c3;
      // subtle variance
      const variance = 0.85 + Math.random() * 0.3;
      starColors[idx] = col.r * variance;
      starColors[idx + 1] = col.g * variance;
      starColors[idx + 2] = col.b * variance;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.35,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.name = 'galaxy-stars';
    group.add(stars);

    // 2) Spiral disk (galaxy arms)
    const armCount = 2;
    const diskCount = Math.round(2600 * quality);
    const diskPositions = new Float32Array(diskCount * 3);
    const diskColors = new Float32Array(diskCount * 3);

    const innerR = 40;
    const outerR = 750;

    const armA = new THREE.Color('#7C3AED'); // violet
    const armB = new THREE.Color('#06B6D4'); // cyan
    const coreC = new THREE.Color('#FFFFFF');

    for (let i = 0; i < diskCount; i++) {
      const t = Math.random(); // 0..1 radial progression
      // bias points toward center slightly
      const r = innerR + (outerR - innerR) * Math.pow(t, 0.55);
      const arm = Math.floor(Math.random() * armCount);
      const armOffset = (arm / armCount) * Math.PI * 2;

      // logarithmic spiral angle with jitter
      const spiralTightness = 1.9; // larger => tighter arms
      const angle = armOffset + (r / outerR) * Math.PI * 2 * spiralTightness + (Math.random() - 0.5) * 0.55;

      // disk thickness + slight vertical warp
      const thickness = (1 - r / outerR) * 28 + 6;
      const y = (Math.random() - 0.5) * thickness;

      const x = Math.cos(angle) * r + (Math.random() - 0.5) * 10;
      const z = Math.sin(angle) * r + (Math.random() - 0.5) * 10;

      const idx = i * 3;
      diskPositions[idx] = x;
      diskPositions[idx + 1] = y;
      diskPositions[idx + 2] = z;

      // color gradient: core -> arms
      const mix = Math.min(1, r / outerR);
      const armColor = arm === 0 ? armA : armB;
      const col = coreC.clone().lerp(armColor, mix);
      const a = 0.7 + Math.random() * 0.3;
      diskColors[idx] = col.r * a;
      diskColors[idx + 1] = col.g * a;
      diskColors[idx + 2] = col.b * a;
    }

    const diskGeo = new THREE.BufferGeometry();
    diskGeo.setAttribute('position', new THREE.BufferAttribute(diskPositions, 3));
    diskGeo.setAttribute('color', new THREE.BufferAttribute(diskColors, 3));
    const diskMat = new THREE.PointsMaterial({
      size: 1.9,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const disk = new THREE.Points(diskGeo, diskMat);
    disk.name = 'galaxy-disk';
    group.add(disk);

    // 3) Core glow sprite
    const tex = createRadialGradientTexture([
      { at: 0.0, color: 'rgba(255,255,255,0.95)' },
      { at: 0.15, color: 'rgba(180,220,255,0.55)' },
      { at: 0.35, color: 'rgba(124,58,237,0.25)' },
      { at: 0.65, color: 'rgba(6,182,212,0.10)' },
      { at: 1.0, color: 'rgba(0,0,0,0.0)' },
    ]);
    if (tex) {
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.name = 'galaxy-core';
      sprite.scale.set(900, 900, 1);
      sprite.position.set(0, 0, 0);
      group.add(sprite);
    }

    // 4) Large faint nebula layer (makes the galaxy more obvious)
    const nebulaTex = createRadialGradientTexture([
      { at: 0.0, color: 'rgba(124,58,237,0.22)' },
      { at: 0.25, color: 'rgba(6,182,212,0.12)' },
      { at: 0.55, color: 'rgba(255,255,255,0.04)' },
      { at: 1.0, color: 'rgba(0,0,0,0.0)' },
    ]);
    if (nebulaTex) {
      const nebulaMat = new THREE.SpriteMaterial({
        map: nebulaTex,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const nebula = new THREE.Sprite(nebulaMat);
      nebula.name = 'galaxy-nebula';
      nebula.scale.set(2000, 2000, 1);
      nebula.position.set(0, 0, 0);
      group.add(nebula);
    }

    // Tilt the galaxy a bit for depth
    group.rotation.x = -0.35;
    group.rotation.z = 0.08;

    return group;
  }, [createRadialGradientTexture]);

  // Add galaxy backdrop objects into the ForceGraph scene
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const scene = fg.scene();
    if (!scene) return;

    // Avoid duplicates
    if (galaxyRef.current) {
      scene.remove(galaxyRef.current);
      galaxyRef.current = null;
    }

    const galaxy = createGalaxyBackdrop();
    galaxy.renderOrder = -1;
    galaxyRef.current = galaxy;
    scene.add(galaxy);

    // Fog is pretty but costs fragment work with heavy blending
    scene.fog = null;

    return () => {
      // Clean up objects/materials/geometries
      if (galaxyRef.current) {
        scene.remove(galaxyRef.current);
        galaxyRef.current.traverse((obj: any) => {
          if (obj?.geometry?.dispose) obj.geometry.dispose();
          if (obj?.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m?.dispose?.());
            else obj.material?.dispose?.();
          }
          if (obj?.material?.map?.dispose) obj.material.map.dispose();
        });
        galaxyRef.current = null;
      }
    };
  }, [createGalaxyBackdrop]);

  // Process data: Clean links, calculate degrees, and filter disconnected nodes
  const processedData = useMemo(() => {
    // Basic defensive check
    if (!data || !data.nodes || !Array.isArray(data.nodes)) {
      return { nodes: [], links: [] };
    }

    // 1. Node Deduplication & Sanitization
    const uniqueNodesMap = new Map<string, GraphNode>();

    data.nodes.forEach(n => {
      if (n && n.id) {
        const id = String(n.id).trim();
        if (id) {
            uniqueNodesMap.set(id, { ...n, id, val: 0 });
        }
      }
    });

    const nodeIds = new Set(uniqueNodesMap.keys());
    const validLinks: any[] = [];

    // 2. Build & Validate Links (precompute curvature/rotation for perf)
    (data.links || []).forEach(link => {
        if (!link) return;

        let sourceId: string | null = null;
        let targetId: string | null = null;

        if (typeof link.source === 'object' && link.source !== null && 'id' in link.source) {
             sourceId = String((link.source as any).id).trim();
        } else if (typeof link.source === 'string' || typeof link.source === 'number') {
             sourceId = String(link.source).trim();
        }

        if (typeof link.target === 'object' && link.target !== null && 'id' in link.target) {
             targetId = String((link.target as any).id).trim();
        } else if (typeof link.target === 'string' || typeof link.target === 'number') {
             targetId = String(link.target).trim();
        }

        if (sourceId && targetId && nodeIds.has(sourceId) && nodeIds.has(targetId)) {
            const u = hashToUnit(`${sourceId}->${targetId}`);
            validLinks.push({
                source: sourceId,
                target: targetId,
                value: link.value || 1,
                __curvature: 0.14 + u * 0.18,
                __rotation: hashToUnit(`${targetId}<-${sourceId}`) * Math.PI * 2,
            });
        }
    });

    // 3. Calculate Degrees based on VALID links only
    const degrees = new Map<string, number>();
    validLinks.forEach(link => {
        degrees.set(link.source, (degrees.get(link.source) || 0) + 1);
        degrees.set(link.target, (degrees.get(link.target) || 0) + 1);
    });

    // 4. Filter Orphaned Nodes (skip when keepOrphans is true, e.g. category filter)
    const filteredNodes = keepOrphans
        ? Array.from(uniqueNodesMap.values())
        : Array.from(uniqueNodesMap.values()).filter(n => (degrees.get(n.id) || 0) > 0);

    // 5. Update values (degree) on the node objects
    filteredNodes.forEach(n => {
       n.val = degrees.get(n.id) || 0;
    });

    // 6. Ensure returned links strictly reference returned nodes
    const finalNodeIds = new Set(filteredNodes.map(n => n.id));
    const finalLinks = validLinks.filter(l => finalNodeIds.has(l.source) && finalNodeIds.has(l.target));

    return { nodes: filteredNodes, links: finalLinks };
  }, [data, keepOrphans, hashToUnit]);

  // When a node is selected, show at most 3 outgoing relationships (sorted by target followers)
  const selectedTopTargets = useMemo(() => {
    if (!selectedNode) return null as Set<string> | null;
    const nodeById = new Map<string, GraphNode>();
    processedData.nodes.forEach(n => nodeById.set(n.id, n));

    const outgoing = processedData.links
      .map((l: any) => ({
        s: typeof l.source === 'object' ? l.source.id : l.source,
        t: typeof l.target === 'object' ? l.target.id : l.target,
      }))
      .filter(x => String(x.s) === selectedNode.id)
      .map(x => ({
        t: String(x.t),
        followers: nodeById.get(String(x.t))?.followers || 0,
      }))
      .sort((a, b) => (b.followers || 0) - (a.followers || 0))
      .slice(0, 3);

    return new Set(outgoing.map(o => o.t));
  }, [selectedNode, processedData.links, processedData.nodes]);



  // Identify connected neighbors for the selected node
  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedNode) return ids;

    processedData.links.forEach((link: any) => {
       const sId = typeof link.source === 'object' ? link.source.id : link.source;
       const tId = typeof link.target === 'object' ? link.target.id : link.target;

       // Only highlight nodes that the selected node follows
       if (sId === selectedNode.id) ids.add(String(tId));
    });
    return ids;
  }, [selectedNode, processedData]);


  // Adjust Physics Forces with max-distance constraint
  useEffect(() => {
    const fg = graphRef.current;
    if (fg) {
      fg.d3Force('charge')?.strength(-800);
      fg.d3Force('link')?.distance(50);
      fg.d3Force('center')?.strength(1.2);

      // Custom force to constrain max distance from center
      const MAX_DISTANCE = 600;
      fg.d3Force('boundingSphere', () => {
        processedData.nodes.forEach((node: any) => {
          const dist = Math.sqrt((node.x || 0) ** 2 + (node.y || 0) ** 2 + (node.z || 0) ** 2);
          if (dist > MAX_DISTANCE) {
            const scale = MAX_DISTANCE / dist;
            node.x = (node.x || 0) * scale;
            node.y = (node.y || 0) * scale;
            node.z = (node.z || 0) * scale;
          }
        });
      });
    }
  }, [processedData]);

  // Galaxy motion: when nothing is selected, slowly rotate all nodes like a galaxy.
  // When a node is selected, freeze this motion for inspection.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    if (selectedNode) {
      fg.d3Force('galacticRotation', null);
      return;
    }

    const makeGalacticRotationForce = () => {
      let nodes: any[] = [];
      const axisTilt = -0.28; // keep similar to backdrop tilt feel
      const cosT = Math.cos(axisTilt);
      const sinT = Math.sin(axisTilt);

      const force: any = (alpha: number) => {
        // alpha falls from ~1 to 0; keep speed stable-ish but still gentle
        const speed = 0.0014 * (0.35 + Math.min(1, alpha));
        const cosA = Math.cos(speed);
        const sinA = Math.sin(speed);

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (!n) continue;

          // Rotate around a slightly tilted axis by transforming into tilted space, rotating, then inverse
          const x0 = n.x || 0;
          const y0 = n.y || 0;
          const z0 = n.z || 0;

          // tilt around X axis
          const y1 = y0 * cosT - z0 * sinT;
          const z1 = y0 * sinT + z0 * cosT;

          // rotate around Y axis in tilted space
          const x2 = x0 * cosA - z1 * sinA;
          const z2 = x0 * sinA + z1 * cosA;

          // inverse tilt around X axis
          const y3 = y1 * cosT + z2 * sinT;
          const z3 = -y1 * sinT + z2 * cosT;

          n.x = x2;
          n.y = y3;
          n.z = z3;
        }
      };

      force.initialize = (_nodes: any[]) => {
        nodes = _nodes || [];
      };

      return force;
    };

    fg.d3Force('galacticRotation', makeGalacticRotationForce());
  }, [selectedNode]);

  // Center camera on selected node
  useEffect(() => {
    const fg = graphRef.current;
    if (fg && selectedNode) {
      const node = processedData.nodes.find((n: any) => n.id === selectedNode.id) as any;
      if (node && typeof node.x === 'number' && typeof node.y === 'number' && typeof node.z === 'number') {
        const distance = 700;
        const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
        fg.cameraPosition(
          { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
          { x: node.x, y: node.y, z: node.z },
          1000
        );
      }
    }
  }, [selectedNode, processedData.nodes]);

  // Color scheme by category - pastel/light tinted colors
  const getCategoryColor = useCallback((group: string) => {
    switch (group) {
      case 'company':
        return '#FFD4A3'; // Light peach/orange
      case 'founder':
        return '#A3D4FF'; // Light sky blue
      case 'researcher':
        return '#E0B3FF'; // Light lavender
      case 'investor':
        return '#B3FFB3'; // Light mint green
      case 'media':
        return '#FFB3D9'; // Light pink
      default:
        return '#D0D4DC'; // Light slate
    }
  }, []);

  // Node color based on category and selection state
  const getNodeColor = useCallback((node: any) => {
    const baseColor = getCategoryColor(node.group || 'company');

    if (selectedNode) {
      if (node.id === selectedNode.id) {
        return baseColor; // Selected node keeps full color
      } else if (neighborIds.has(node.id)) {
        return baseColor; // Neighbors keep full color
      } else {
        return '#333333'; // Dim other nodes
      }
    }

    return baseColor;
  }, [selectedNode, neighborIds, getCategoryColor]);

  // Node size based on follower count
  const getNodeSize = useCallback((node: any) => {
    const followers = typeof node.followers === 'number' ? node.followers : 0;

    // Higher-precision continuous mapping:
    // normalize followers into a target range, then apply a gamma curve so mid/low range has more visible separation
    if (followers > 0) {
      const t = getFollowerT(followers);

      const minSize = 3.0;
      const maxSize = 11.0;
      return minSize + t * (maxSize - minSize);
    }

    // Fallback for nodes without follower data: use connectivity degree (val)
    const val = typeof node.val === 'number' ? node.val : 0;
    return Math.min(6.0, Math.max(2.8, 2.8 + Math.sqrt(Math.max(0, val)) * 0.35));
  }, [getFollowerT]);

  // Create node with glowing sphere (multiple layers) and HTML text label
  const nodeThreeObject = useCallback((node: any) => {
    const group = new THREE.Group();

    const nodeSize = getNodeSize(node);
    const baseColor = getCategoryColor(node.group || 'company');

    const nodeMaterials: Array<(THREE.Material & { color?: THREE.Color })> = [];

    // Deterministic style seed (avoid visual jitter across re-renders)
    const seed = hashToUnit(String(node.id || node.name || 'node'));
    const seed2 = hashToUnit(`b:${String(node.id || node.name || 'node')}`);
    const tF = getFollowerT(node.followers);

    // Core (small, bright)
    const coreGeometry = new THREE.SphereGeometry(nodeSize * 0.62, 12, 12);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.90 + tF * 0.09 });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);
    nodeMaterials.push(coreMaterial);

    // Inner starburst sprite (crisper "star" feel)
    if (nodeStarburstTexture) {
      const burstMaterial = new THREE.SpriteMaterial({
        map: nodeStarburstTexture,
        color: new THREE.Color(baseColor),
        transparent: true,
        opacity: 0.35 + tF * 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const burst = new THREE.Sprite(burstMaterial);
      burst.scale.set(nodeSize * 8.5, nodeSize * 8.5, 1);
      burst.position.set(0, 0, 0);
      group.add(burst);
      nodeMaterials.push(burstMaterial as any);
    }

    // Outer halo sprite (soft bloom)
    if (nodeGlowTexture) {
      const haloMaterial = new THREE.SpriteMaterial({
        map: nodeGlowTexture,
        color: new THREE.Color(baseColor),
        transparent: true,
        opacity: 0.12 + tF * 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMaterial);
      halo.scale.set(nodeSize * 15, nodeSize * 15, 1);
      halo.position.set(0, 0, 0);
      group.add(halo);
      nodeMaterials.push(haloMaterial as any);
    }

    // Thin orbit lines (prettier + less overdraw than filled rings)
    // Max 3 lines, driven mostly by followers
    const ringCount = Math.max(1, Math.min(3, 1 + Math.floor(tF * 2.001)));
    for (let i = 0; i < ringCount; i++) {
      const r = nodeSize * (2.3 + i * 0.9);
      const segments = 72;
      const positions = new Float32Array((segments + 1) * 3);
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        positions[s * 3] = Math.cos(a) * r;
        positions[s * 3 + 1] = 0;
        positions[s * 3 + 2] = Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: Math.max(0.06, (0.08 + tF * 0.18) - i * 0.04),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.rotation.x = (seed * 0.9 + i * 0.25) * 1.1;
      line.rotation.y = (seed2 * 0.9 + i * 0.35) * 1.1;
      line.rotation.z = ((seed + seed2) * 0.6 + i * 0.15) * 1.1;
      group.add(line);
      nodeMaterials.push(mat as any);
    }

    // Static "satellite" star dots along the outer orbit (cheap points)
    const satCount = Math.max(4, Math.min(16, 4 + Math.floor(tF * 10)));
    const satR = nodeSize * (2.3 + (ringCount - 1) * 0.9);
    const satPositions = new Float32Array(satCount * 3);
    for (let i = 0; i < satCount; i++) {
      const a = (i / satCount) * Math.PI * 2 + seed * Math.PI * 2;
      const jitter = (hashToUnit(`${node.id}:${i}`) - 0.5) * nodeSize * 0.35;
      satPositions[i * 3] = Math.cos(a) * (satR + jitter);
      satPositions[i * 3 + 1] = (hashToUnit(`y:${node.id}:${i}`) - 0.5) * nodeSize * 0.4;
      satPositions[i * 3 + 2] = Math.sin(a) * (satR + jitter);
    }
    const satGeo = new THREE.BufferGeometry();
    satGeo.setAttribute('position', new THREE.BufferAttribute(satPositions, 3));
    const satMat = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: true,
      color: baseColor,
      transparent: true,
      opacity: 0.55 + tF * 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sats = new THREE.Points(satGeo, satMat);
    sats.rotation.x = seed * 1.2;
    sats.rotation.y = seed2 * 1.2;
    group.add(sats);
    nodeMaterials.push(satMat as any);

    // Store all materials for dynamic color updates
    materialsRef.current.set(node.id, nodeMaterials);

    // Create HTML text label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'node-label';
    labelDiv.textContent = node.name || node.id;
    labelDiv.style.color = 'white';
    labelDiv.style.fontSize = '9px';
    labelDiv.style.fontFamily = 'Arial, sans-serif';
    labelDiv.style.fontWeight = 'bold';
    labelDiv.style.textShadow = '0 0 2px black, 0 0 2px black';
    labelDiv.style.pointerEvents = 'none';
    labelDiv.style.whiteSpace = 'nowrap';
    labelDiv.style.opacity = '0';
    labelDiv.style.transition = 'opacity 0.2s';

    const label = new CSS2DObject(labelDiv);
    label.position.set(0, -nodeSize - 10, 0);
    group.add(label);

    // Store reference for distance-based visibility
    labelsRef.current.set(node.id, { element: labelDiv, object: group });

    return group;
  }, [getNodeSize, getCategoryColor, nodeGlowTexture, nodeStarburstTexture, hashToUnit, getFollowerT]);

  // Set up CSS2DRenderer for HTML labels
  const extraRenderers = useMemo(() => [new CSS2DRenderer()], []);

  // Update label visibility based on camera distance and selection
  useEffect(() => {
    const VISIBILITY_DISTANCE = 800; // Labels visible within this distance

    const updateLabelVisibility = () => {
      const fg = graphRef.current;
      if (!fg) return;

      const camera = fg.camera();
      if (!camera) return;

      const cameraPos = camera.position;
      const worldPos = new THREE.Vector3();

      labelsRef.current.forEach(({ element, object }, nodeId) => {
        // Always show selected node and its neighbors
        const isSelected = selectedNode?.id === nodeId;
        const isNeighbor = neighborIds.has(nodeId);

        if (isSelected || isNeighbor) {
          element.style.opacity = '1';
          return;
        }

        // Get world position of the node
        object.getWorldPosition(worldPos);

        // Calculate distance from camera
        const distance = cameraPos.distanceTo(worldPos);

        // Show label if close enough
        if (distance < VISIBILITY_DISTANCE) {
          const opacity = Math.max(0, 1 - (distance / VISIBILITY_DISTANCE) * 0.5);
          element.style.opacity = String(opacity);
        } else {
          element.style.opacity = '0';
        }
      });
    };

    // Update visibility on animation frame
    let animationId: number;
    let lastLabelUpdate = 0;
    let lastFrameTime = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = now - lastFrameTime;
      lastFrameTime = now;

      // Galaxy subtle rotation (cheap) every frame
      if (galaxyRef.current) {
        const s = Math.min(50, Math.max(0, dt)) / 16.67; // normalize ~60fps
        galaxyRef.current.rotation.y += 0.00055 * s;
        galaxyRef.current.rotation.z += 0.00010 * s;
      }

      // Labels are CPU-heavy: update at ~10-12fps
      if (now - lastLabelUpdate > 90) {
        lastLabelUpdate = now;
        updateLabelVisibility();
      }
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [selectedNode, neighborIds]);

  // Update node colors when selection changes
  useEffect(() => {
    materialsRef.current.forEach((materials: any, nodeId) => {
      const node = processedData.nodes.find(n => n.id === nodeId);
      if (!node) return;

      const baseColor = getCategoryColor(node.group || 'company');
      const materialsArray = Array.isArray(materials) ? materials : [materials];
      const isHighlighted = !selectedNode || nodeId === selectedNode.id || neighborIds.has(nodeId);

      materialsArray.forEach((mat: any) => {
        if (!mat?.color) return;
        if (isHighlighted) {
          mat.color.set(baseColor);
        } else {
          mat.color.set('#222222');
        }
      });
    });
  }, [selectedNode, neighborIds, processedData.nodes, getCategoryColor]);

  // Link visibility - show all when nothing selected, only outgoing when a node is selected
  const getLinkVisibility = useCallback((link: any) => {
    // Initial state: hide links (galaxy-only). Show only when selecting a node.
    if (!selectedNode) return false;

    const sId = typeof link.source === 'object' ? link.source.id : link.source;
    const tId = typeof link.target === 'object' ? link.target.id : link.target;

    if (String(sId) !== selectedNode.id) return false;
    if (!selectedTopTargets) return false;
    return selectedTopTargets.has(String(tId));
  }, [selectedNode, selectedTopTargets]);

  // Link color - dimmer when showing all, brighter for selected node's links
  const getLinkColor = useCallback((link: any) => {
    if (!selectedNode) return 'rgba(255, 255, 255, 0.07)';
    return 'rgba(255, 255, 255, 0.4)';
  }, [selectedNode]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const fg = graphRef.current;
    if (fg) {
      const camera = fg.camera();
      const controls = fg.controls();
      if (camera && controls) {
        const distance = camera.position.length();
        const newDistance = distance * 0.7; // Zoom in by 30%
        const direction = camera.position.clone().normalize();
        camera.position.copy(direction.multiplyScalar(newDistance));
        controls.update();
      }
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const fg = graphRef.current;
    if (fg) {
      const camera = fg.camera();
      const controls = fg.controls();
      if (camera && controls) {
        const distance = camera.position.length();
        const newDistance = distance * 1.4; // Zoom out by 40%
        const direction = camera.position.clone().normalize();
        camera.position.copy(direction.multiplyScalar(newDistance));
        controls.update();
      }
    }
  }, []);

  const handleResetView = useCallback(() => {
    const fg = graphRef.current;
    if (fg) {
      fg.zoomToFit(500, 100); // 500ms animation, positive padding = more zoomed out
    }
    onClearSelection(); // Clear any selected node
  }, [onClearSelection]);

  return (
    <div ref={containerRef} className="absolute inset-0 z-0 bg-[#0B0C15]">
      {/* Zoom Controls - bottom center, horizontal */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-row bg-black/40 backdrop-blur-md rounded-lg border border-white/10 overflow-hidden">
        <button
          onClick={handleZoomOut}
          className="px-4 py-2 text-white hover:bg-white/10 transition-colors border-r border-white/10"
          title="Zoom Out"
        >
          <span className="text-lg font-light">−</span>
        </button>
        <button
          onClick={handleResetView}
          className="px-4 py-2 text-white hover:bg-white/10 transition-colors border-r border-white/10"
          title="Reset View"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          onClick={handleZoomIn}
          className="px-4 py-2 text-white hover:bg-white/10 transition-colors"
          title="Zoom In"
        >
          <span className="text-lg font-light">+</span>
        </button>
      </div>

      <ForceGraph3D
        ref={graphRef}
        graphData={processedData}
        nodeId="id"
        nodeLabel=""
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#0B0C15"
        extraRenderers={extraRenderers}

        // Custom node with sphere and label
        nodeThreeObject={nodeThreeObject}

        // Link Styling - Simple white lines with visibility control
        linkVisibility={getLinkVisibility}
        linkColor={
          selectedNode
            ? `rgba(255, 255, 255, ${0.18 + getFollowerT(selectedNode.followers) * 0.45})`
            : 'rgba(255, 255, 255, 0.07)'
        }
        linkWidth={selectedNode ? (0.9 + getFollowerT(selectedNode.followers) * 1.2) : 0.7}
        linkOpacity={1}
        linkResolution={selectedNode ? 4 : 2}
        linkCurvature={(link: any) => {
          // Curved links are expensive. Keep straight in overview.
          return selectedNode ? Math.min(0.45, (link.__curvature || 0.2) + 0.12) : 0;
        }}
        linkCurveRotation={(link: any) => {
          return selectedNode ? (link.__rotation || 0) : 0;
        }}
        linkDirectionalParticles={selectedNode ? 1 : 0}
        linkDirectionalParticleColor={() => 'rgba(255,255,255,0.85)'}
        linkDirectionalParticleWidth={selectedNode ? (1.0 + getFollowerT(selectedNode.followers) * 1.2) : 1.4}
        linkDirectionalParticleSpeed={selectedNode ? (0.006 + getFollowerT(selectedNode.followers) * 0.006) : 0.007}

        // Interaction
        enableNodeDrag={true}
        onNodeClick={(node) => node && onNodeClick(node)}
        enablePointerInteraction={true}
        linkHoverPrecision={0}

        // Physics
        d3VelocityDecay={0.4}
        d3AlphaDecay={0.02}

        onNodeDragEnd={(node: any) => {
          if (node && typeof node === 'object') {
             if ('x' in node && typeof node.x === 'number') node.fx = node.x;
             if ('y' in node && typeof node.y === 'number') node.fy = node.y;
             if ('z' in node && typeof node.z === 'number') node.fz = node.z;
          }
        }}

        controlType="orbit"
      />
    </div>
  );
};

export default Graph3D;
