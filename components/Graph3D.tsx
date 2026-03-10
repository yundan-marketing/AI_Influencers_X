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

  const nodeGlowTexture = useMemo(() => {
    return createRadialGradientTexture([
      { at: 0.0, color: 'rgba(255,255,255,1.0)' },
      { at: 0.12, color: 'rgba(255,255,255,0.85)' },
      { at: 0.35, color: 'rgba(255,255,255,0.35)' },
      { at: 0.7, color: 'rgba(255,255,255,0.08)' },
      { at: 1.0, color: 'rgba(0,0,0,0.0)' },
    ]);
  }, [createRadialGradientTexture]);

  const createGalaxyBackdrop = useCallback(() => {
    const group = new THREE.Group();
    group.name = 'galaxy-backdrop';

    // 1) Background stars (spherical distribution)
    const isMobile = window.innerWidth < 768;
    const dpr = window.devicePixelRatio || 1;
    const quality = Math.max(0.45, Math.min(1, (isMobile ? 0.7 : 1) * (1.1 / Math.min(dpr, 2))));

    const starCount = Math.round(2200 * quality);
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
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.name = 'galaxy-stars';
    group.add(stars);

    // 2) Spiral disk (galaxy arms)
    const armCount = 2;
    const diskCount = Math.round(2000 * quality);
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
      opacity: 0.45,
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
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.name = 'galaxy-core';
      sprite.scale.set(760, 760, 1);
      sprite.position.set(0, 0, 0);
      group.add(sprite);
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
    const followers = node.followers || 0;
    if (followers >= 1000000) return 8;   // 1M+
    if (followers >= 500000) return 6.5;  // 500K+
    if (followers >= 100000) return 5;    // 100K+
    if (followers >= 50000) return 4;     // 50K+
    if (followers >= 10000) return 3.5;   // 10K+
    return 3;
  }, []);

  // Create node with glowing sphere (multiple layers) and HTML text label
  const nodeThreeObject = useCallback((node: any) => {
    const group = new THREE.Group();

    const nodeSize = getNodeSize(node);
    const baseColor = getCategoryColor(node.group || 'company');

    const nodeMaterials: Array<(THREE.Material & { color?: THREE.Color })> = [];

    // Core star
    const coreGeometry = new THREE.SphereGeometry(nodeSize * 0.75, 14, 14);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.95 });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);
    nodeMaterials.push(coreMaterial);

    // Halo glow sprite (very cheap vs multi-sphere glow)
    if (nodeGlowTexture) {
      const haloMaterial = new THREE.SpriteMaterial({
        map: nodeGlowTexture,
        color: new THREE.Color(baseColor),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMaterial);
      halo.scale.set(nodeSize * 10, nodeSize * 10, 1);
      halo.position.set(0, 0, 0);
      group.add(halo);
      nodeMaterials.push(haloMaterial as any);
    }

    // Orbit rings for "mini galaxy" look when links are hidden
    const ringCount = Math.max(1, Math.min(2, Math.floor((node.val || 0) / 6) + 1));
    for (let i = 0; i < ringCount; i++) {
      const r = nodeSize * (2.3 + i * 0.8);
      const ringGeo = new THREE.RingGeometry(r * 0.88, r, 36);
      const ringMat = new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = (Math.random() - 0.5) * 1.2;
      ring.rotation.y = (Math.random() - 0.5) * 1.2;
      ring.rotation.z = (Math.random() - 0.5) * 1.2;
      group.add(ring);
      nodeMaterials.push(ringMat);
    }

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
  }, [getNodeSize, getCategoryColor, nodeGlowTexture]);

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
        galaxyRef.current.rotation.y += 0.00035 * s;
        galaxyRef.current.rotation.z += 0.00008 * s;
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

    return sId === selectedNode.id;
  }, [selectedNode]);

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
        linkColor={selectedNode ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.07)'}
        linkWidth={selectedNode ? 1.15 : 0.7}
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
        linkDirectionalParticleWidth={1.4}
        linkDirectionalParticleSpeed={0.007}

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
