// frontend/src/pages/Annotate.jsx
import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Button,
  Spinner,
  Badge,
  ListGroup,
  Form,
  InputGroup,
  Modal,
} from "react-bootstrap";
import {
  ArrowLeft,
  Save,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Image as ImageIcon,
  Square,
  Triangle,
  Eye,
  EyeOff,
  Trash2,
  Keyboard,
  TagIcon,
  // added Hand icon
} from "lucide-react";
import { db } from "../utils/db";
import { useTheme } from "../components/ThemeContext";

// Utility to generate color for class
const colorForLabel = (label) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h << 5) - h + label.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 70% 50%)`;
};
const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 9);

export default function Annotate() {
  const { projectId, datasetId, jobId } = useParams();
  const navigate = useNavigate();
  const { themeColors } = useTheme();

  const dsId = datasetId;
  const [job, setJob] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [project, setProject] = useState(null);
  const [images, setImages] = useState([]); // {id,name,url,...}
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  // UI / tool state
  const [tool, setTool] = useState("bbox"); // 'bbox' | 'poly'
  const [crosshair, setCrosshair] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [annotations, setAnnotations] = useState([]); // loaded for current image
  const [classes, setClasses] = useState([]); // [{id,name,color}]
  const [newClassName, setNewClassName] = useState("");
  const [selectedAnnId, setSelectedAnnId] = useState(null);

  // Pan/hand tool state (NEW)
  const [handMode, setHandMode] = useState(false); // toggle button
  const panRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef(null); // {clientX, clientY, startX, startY}
  const spaceDownRef = useRef(false);

  // refs
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const createdUrlsRef = useRef(new Set());
  const autosaveTimer = useRef(null);

  // drawing/edit state (mutable ref to avoid re-render loops)
  const stateRef = useRef({
    mode: null, // 'drawing' | 'editing' | null
    draw: {
      inProgress: false,
      start: null, // normalized [x,y]
      current: null, // normalized [x,y]
      currentPoly: [], // normalized [x,y,...]
      mode: null,
    },
    edit: {
      annId: null,
      type: null, // 'move' | 'corner' | 'vertex'
      index: null, // index for corner/vertex
      offset: null, // client offset during move
    },
    mouse: { cx: 0, cy: 0 }, // client coords
    hover: { type: "none", annId: null, index: null }, // NEW: for handle hover
  });

  // History state for undo/redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Shortcuts modal state
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Panel state
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const classInputRef = useRef(null);

  // helpers: ensure folder permission (same as before)
  async function ensureFolderAccess(handle) {
    try {
      if (!handle) return false;
      let p = await handle.queryPermission({ mode: "read" });
      if (p === "granted") return true;
      p = await handle.requestPermission({ mode: "read" });
      return p === "granted";
    } catch (e) {
      console.warn("Folder permission check failed:", e);
      return false;
    }
  }

  // --------------------- LOAD: dataset, job, images, classes ---------------------
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const [proj, ds, jb] = await Promise.all([
          db.projects.get(projectId),
          db.datasets.get(dsId),
          db.jobs.get(jobId),
        ]);
        if (!ds) {
          alert("Dataset not found.");
          navigate(`/project/${projectId}`);
          return;
        }
        setProject(proj || null);
        setDataset(ds);
        setJob(jb || null);

        // load images
        const jobImageIds = jb?.imageIds ?? [];
        const imgs =
          jobImageIds.length > 0
            ? await db.images.where("id").anyOf(jobImageIds).toArray()
            : await db.images.where("datasetId").equals(dsId).toArray();

        const resolved = [];
        for (const img of imgs) {
          let url = null;
          try {
            if (ds.folderHandle) {
              try {
                const rawDir = await ds.folderHandle.getDirectoryHandle("raw_images", {
                  create: false,
                });
                const fh = await rawDir.getFileHandle(img.name);
                const file = await fh.getFile();
                url = URL.createObjectURL(file);
                createdUrlsRef.current.add(url);
              } catch (err) {
                /* fallback */
              }
            }
            if (!url && img.file instanceof Blob) {
              url = URL.createObjectURL(img.file);
              createdUrlsRef.current.add(url);
            }
            if (!url && img.url) url = img.url;
          } catch (e) {
            console.warn("Failed to create url for image", img.name, e);
          }
          resolved.push({ ...img, url });
        }

        if (!mounted) return;
        setImages(resolved);
        setCurrentIdx(0);

        // derive classes from all annotations in DB for this dataset
        const allAnn = await db.annotations.where("datasetId").equals(dsId).toArray();
        const labels = new Map();
        for (const r of allAnn) {
          const arr = r?.data ?? [];
          for (const a of arr) {
            const name = a.className || "class";
            if (!labels.has(name)) labels.set(name, colorForLabel(name));
          }
        }
        setClasses(Array.from(labels.entries()).map(([name, color]) => ({ id: uid(), name, color })));
      } catch (err) {
        console.error("Load failed:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      createdUrlsRef.current.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      });
      createdUrlsRef.current.clear();
      mounted = false;
    };
  }, [projectId, datasetId, jobId]);

 // --------------------- ANNOTATIONS REF ---------------------
  const annotationsRef = useRef(annotations);
  useEffect(() => {
    annotationsRef.current = annotations;
    scheduleSave(); // schedule autosave whenever annotations change
  }, [annotations]);

  // --------------------- LOAD annotations for current image ---------------------
  useEffect(() => {
    const loadForImage = async () => {
      const img = images[currentIdx];
      if (!img) {
        setAnnotations([]);
        return;
      }

      try {
        const rec = await db.annotations
          .where({ datasetId: dsId, imageName: img.name })
          .first();
        const data = rec?.data ?? [];

        // normalize annotations, add visible flag
        const normalized = data.map((a, index) => ({
          id: a.id || index.toString(), // fallback id
          type: a.type,
          points: a.points,
          className: a.className || "class",
          color: a.color || "#FF0000", // fallback color
          visible: a.visible !== false,
        }));

        setAnnotations(normalized);
        setSelectedAnnId(null);

        // reset pan/zoom when image changes
        panRef.current = { x: 0, y: 0 };
        setZoom(1);
      } catch (e) {
        console.warn("Failed to load annotations:", e);
        setAnnotations([]);
      }
    };

    loadForImage();
  }, [images, currentIdx, dsId]);

  // --------------------- AUTOSAVE (debounced) ---------------------
  const scheduleSave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    autosaveTimer.current = setTimeout(async () => {
      const img = images[currentIdx];
      if (!img) return;

      try {
        const payload = {
          datasetId: dsId,
          imageName: img.name,
          data: annotationsRef.current,
          updatedAt: new Date().toISOString(),
        };

        const existing = await db.annotations
          .where("datasetId")
          .equals(dsId)
          .and((a) => a.imageName === img.name)
          .first();

        if (existing) {
          await db.annotations.update(existing.id, payload);
        } else {
          payload.id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
          await db.annotations.add(payload);
        }

        console.log("✅ autosaved:", img.name);
      } catch (err) {
        console.error("❌ Failed autosave:", err);
      }
    }, 800);
  }, [currentIdx, images, dsId]);

  // --------------------- EFFECT TO TRIGGER AUTOSAVE ---------------------
  useEffect(() => {
    if (images.length === 0) return;
    scheduleSave();

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [currentIdx, images, scheduleSave]);


  // --------------------- Coordinate helpers ---------------------
  // Note: imageClientRect relies on the rendered img bounding rect which already
  // reflects CSS transforms (translate + scale). That makes mapping simpler.
  const imageClientRect = () => {
    const imgEl = imageRef.current;
    if (!imgEl) return null;
    return imgEl.getBoundingClientRect();
  };
  const clientToNormalized = (clientX, clientY) => {
    const rect = imageClientRect();
    if (!rect) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };
  const normalizedToClient = (nx, ny) => {
    const rect = imageClientRect();
    if (!rect) return null;
    return [rect.left + nx * rect.width, rect.top + ny * rect.height];
  };

  // --------------------- Drawing & render overlay ---------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");

    function resizeCanvas() {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // helper: convert normalized to canvas-local coords (canvas origin = container top-left)
    const normToCanvas = (nx, ny) => {
      const rect = imageClientRect();
      if (!rect) return null;
      const cx = (rect.left - container.getBoundingClientRect().left) + nx * rect.width;
      const cy = (rect.top - container.getBoundingClientRect().top) + ny * rect.height;
      return [cx, cy];
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const rect = imageClientRect();
      if (!rect) return;

      ctx.save();

      // draw existing annotations
      for (const a of annotations) {
        if (a.visible === false) continue;
        const stroke = a.color || colorForLabel(a.className || "class");
        // fill with 30% opacity
        ctx.strokeStyle = stroke;
        ctx.lineWidth = a.id === selectedAnnId ? 3 : 2;
        ctx.fillStyle = "rgba(255,255,255,0.30)";

        if (a.type === "bbox") {
          const [x1, y1, x2, y2] = a.points;
          const [cx, cy] = normToCanvas(x1, y1);
          const w = (x2 - x1) * rect.width;
          const h = (y2 - y1) * rect.height;
          ctx.beginPath();
          ctx.rect(cx, cy, w, h);
          ctx.fill();
          ctx.stroke();
          // draw corner handles (white dot inside colored ring)
          const corners = [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2],
          ];
          corners.forEach((c, i) => {
            const [hx, hy] = normToCanvas(c[0], c[1]);
            // If hovered handle -> draw ring (hollow) larger
            if (stateRef.current.hover.type === "corner" && stateRef.current.hover.annId === a.id && stateRef.current.hover.index === i) {
              drawHandleHover(ctx, hx, hy, stroke);
            } else {
              drawHandle(ctx, hx, hy, stroke);
            }
          });
        } else if (a.type === "poly") {
          const pts = a.points;
          if (pts.length < 6) continue;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) {
            const [px, py] = normToCanvas(pts[i], pts[i + 1]);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // vertex handles
          for (let i = 0; i < pts.length; i += 2) {
            const [vx, vy] = normToCanvas(pts[i], pts[i + 1]);
            const vidx = i / 2;
            if (stateRef.current.hover.type === "vertex" && stateRef.current.hover.annId === a.id && stateRef.current.hover.index === vidx) {
              drawHandleHover(ctx, vx, vy, stroke);
            } else {
              drawHandle(ctx, vx, vy, stroke);
            }
          }
        }
      }

      // draw in-progress (live) shapes
      const d = stateRef.current.draw;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      if (d.inProgress) {
        if (stateRef.current.draw.mode === "bbox" || (stateRef.current.draw.mode == null && tool === "bbox")) {
          if (d.start && d.current) {
            const [sx, sy] = d.start;
            const [cxn, cyn] = d.current;
            const rx = Math.min(sx, cxn);
            const ry = Math.min(sy, cyn);
            const rw = Math.abs(cxn - sx) * rect.width;
            const rh = Math.abs(cyn - sy) * rect.height;
            const [rxp, ryp] = normToCanvas(rx, ry);
            ctx.beginPath();
            ctx.rect(rxp, ryp, rw, rh);
            ctx.fill();
            ctx.stroke();
          }
        } else if (stateRef.current.draw.mode === "poly" || (stateRef.current.draw.mode == null && tool === "poly")) {
          const pts = d.currentPoly || [];
          if (pts.length >= 2) {
            ctx.beginPath();
            for (let i = 0; i < pts.length; i += 2) {
              const [px, py] = normToCanvas(pts[i], pts[i + 1]);
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            if (d.current) {
              const [mx, my] = d.current;
              const [mxp, myp] = normToCanvas(mx, my);
              ctx.lineTo(mxp, myp);
            }
            ctx.stroke();
            // draw vertex handles for created vertices
            for (let i = 0; i < pts.length; i += 2) {
              const [vx, vy] = normToCanvas(pts[i], pts[i + 1]);
              drawHandle(ctx, vx, vy, "#fff");
            }
          }
        }
      }

      // crosshair with small central white dot and lines a little away from dot
      if (crosshair) {
        const m = stateRef.current.mouse;
        if (m && rect) {
          // translate mouse to canvas-local
          const cRect = container.getBoundingClientRect();
          const localX = m.cx - cRect.left;
          const localY = m.cy - cRect.top;
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,1)";
          ctx.lineWidth = 2;

          // draw vertical and horizontal lines leaving a gap of 20px around central dot
          ctx.beginPath();
          ctx.moveTo(localX, 0);
          ctx.lineTo(localX, localY - 20);
          ctx.moveTo(localX, localY + 20);
          ctx.lineTo(localX, canvas.height);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(0, localY);
          ctx.lineTo(localX - 20, localY);
          ctx.moveTo(localX + 20, localY);
          ctx.lineTo(canvas.width, localY);
          ctx.stroke();

          // central white dot
          ctx.beginPath();
          ctx.fillStyle = "white";
          ctx.arc(localX, localY, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else {
        // when crosshair disabled show small central dot only (still painted above).
        // But we already draw dot only when crosshair true; if you want dot-only mode, adjust here.
        const m = stateRef.current.mouse;
        if (m && rect) {
          // translate mouse to canvas-local
          const cRect = container.getBoundingClientRect();
          const localX = m.cx - cRect.left;
          const localY = m.cy - cRect.top;
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,1)";
          ctx.lineWidth = 2;
          // central white dot
          ctx.beginPath();
          ctx.fillStyle = "white";
          ctx.arc(localX, localY, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    };

    // helpers used above
    function drawHandle(ctx, x, y, color) {
      // default handle: small white filled dot with colored ring
      ctx.beginPath();
      ctx.fillStyle = "white";
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    function drawHandleHover(ctx, x, y, color) {
      // hovered handle: hollow ring (bigger), no inner dot
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      // subtle inner translucent fill to hint hover (optional)
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    function drawCenterDot(ctx, x, y) {
      ctx.beginPath();
      ctx.fillStyle = "white";
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    function hexToRgba(hex, a) {
      if (!hex) return `rgba(0,0,0,${a})`;
      if (hex.startsWith("hsl")) {
        return hex.replace("hsl(", "hsla(").replace(")", `, ${a})`);
      }
      const c = hex.replace("#", "");
      const bigint = parseInt(c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r},${g},${b},${a})`;
    }
    function polygonCentroid(pts, rect) {
      if (!pts || pts.length < 6) return null;
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < pts.length; i += 2) {
        const x0 = pts[i], y0 = pts[i + 1];
        const j = (i + 2) % pts.length;
        const x1 = pts[j], y1 = pts[j + 1];
        const a = x0 * y1 - x1 * y0;
        area += a;
        cx += (x0 + x1) * a;
        cy += (y0 + y1) * a;
      }
      if (area === 0) return null;
      area = area / 2;
      cx = cx / (6 * area);
      cy = cy / (6 * area);
      return normToCanvas(cx, cy);
    }

    let rafId = requestAnimationFrame(function loop() {
      draw();
      rafId = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [annotations, selectedAnnId, crosshair, zoom, tool, images, currentIdx]);

  // --------------------- Interaction: pointer events for draw/edit + pan/hover ---------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ensure cursor hidden on annotation stage — we draw crosshair/dot ourselves
    // but keep default cursor for interactive controls (buttons) — container only covers center stage.
    container.style.cursor = "none";

    const hitTestHandle = (clientX, clientY) => {
      // returns {type: 'handle'|'vertex'|'inside'|'none', annId, index}
      const rect = imageClientRect();
      if (!rect) return { type: "none" };
      const cRect = container.getBoundingClientRect();
      const localX = clientX - cRect.left;
      const localY = clientY - cRect.top;

      // loop annotations top-to-bottom (reverse) to hit topmost first
      for (let k = annotations.length - 1; k >= 0; k--) {
        const a = annotations[k];
        if (a.visible === false) continue;
        if (a.type === "bbox") {
          const [x1, y1, x2, y2] = a.points;
          const [cx1, cy1] = normalizedToClient(x1, y1);
          const [cx2, cy2] = normalizedToClient(x2, y2);
          const left = Math.min(cx1, cx2), top = Math.min(cy1, cy2);
          const right = Math.max(cx1, cx2), bottom = Math.max(cy1, cy2);
          // compute container-local corners
          const cLeft = left - cRect.left;
          const cTop = top - cRect.top;
          const cRight = right - cRect.left;
          const cBottom = bottom - cRect.top;
          // handle radius in local coords (hover radius)
          const handleR = 12; // increased to make hover easier
          const corners = [
            [cLeft, cTop],
            [cRight, cTop],
            [cRight, cBottom],
            [cLeft, cBottom],
          ];
          for (let i = 0; i < corners.length; i++) {
            const dx = localX - corners[i][0];
            const dy = localY - corners[i][1];
            if (dx * dx + dy * dy <= handleR * handleR) return { type: "corner", annId: a.id, index: i };
          }
          // inside bbox?
          if (localX >= cLeft && localX <= cRight && localY >= cTop && localY <= cBottom) {
            return { type: "inside", annId: a.id };
          }
        } else if (a.type === "poly") {
          // vertex hit
          for (let i = 0; i < a.points.length; i += 2) {
            const [vx, vy] = normalizedToClient(a.points[i], a.points[i + 1]);
            const lx = vx - container.getBoundingClientRect().left;
            const ly = vy - container.getBoundingClientRect().top;
            const dx = localX - lx;
            const dy = localY - ly;
            if (dx * dx + dy * dy <= 12 * 12) return { type: "vertex", annId: a.id, index: i / 2 };
          }
          // point-in-polygon test for inside (ray-casting)
          const rect = imageClientRect();
          if (!rect) continue;
          // map local to normalized
          const nx = (localX - (rect.left - container.getBoundingClientRect().left)) / rect.width;
          const ny = (localY - (rect.top - container.getBoundingClientRect().top)) / rect.height;
          if (pointInPoly(nx, ny, a.points)) return { type: "inside", annId: a.id };
        }
      }
      return { type: "none" };
    };

    const pointInPoly = (x, y, pts) => {
      // pts: [x,y,x,y...], x,y normalized
      let inside = false;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i], yi = pts[i + 1];
        const xj = pts[j], yj = pts[j + 1];
        const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // helper: set hover based on pointer
    const updateHover = (clientX, clientY) => {
      const hit = hitTestHandle(clientX, clientY);
      if (hit.type === "corner" || hit.type === "vertex") {
        const hv = { type: hit.type, annId: hit.annId, index: hit.index };
        stateRef.current.hover = hv;
      } else {
        stateRef.current.hover = { type: "none", annId: null, index: null };
      }
    };

    // PAN helpers
    const startPan = (e) => {
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: panRef.current.x,
        startY: panRef.current.y,
      };
      // set container cursor to grabbing visually (but we keep the cursor hidden per request; if you want visible, set '' or 'grabbing')
      // container.style.cursor = 'grabbing';
    };
    const doPan = (e) => {
      if (!panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      panRef.current.x = panStartRef.current.startX + dx;
      panRef.current.y = panStartRef.current.startY + dy;
      // apply transform to image
      const img = imageRef.current;
      if (img) {
        img.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoom})`;
        img.style.transition = "transform 0s";
        img.style.transformOrigin = "center center";
      }
    };
    const endPan = () => {
      panStartRef.current = null;
      // container.style.cursor = 'none'; // keep hidden
    };

    // DRAW/EDIT/INTERACTION handlers
    const onPointerDown = (e) => {
      // only left button for drawing/editing; but allow middle/left for pan if needed
      if (e.button && e.button !== 0) return;
      stateRef.current.mouse = { cx: e.clientX, cy: e.clientY };

      // If hand mode (toggle) OR space pressed -> start panning
      if (handMode || spaceDownRef.current) {
        startPan(e);
        // capture pointer moves for pan (we won't do drawing)
        return;
      }

      const imgRect = imageClientRect();
      if (!imgRect) return;

      // ignore if clicked outside image
      if (e.clientX < imgRect.left || e.clientX > imgRect.right || e.clientY < imgRect.top || e.clientY > imgRect.bottom) return;

      // update hover before hit test (ensures we detect vertex/corner)
      updateHover(e.clientX, e.clientY);
      const hit = hitTestHandle(e.clientX, e.clientY);

      if (hit.type === "corner" || hit.type === "vertex" || hit.type === "inside") {
        // start editing selected annotation
        const ann = annotations.find((a) => a.id === hit.annId);
        if (!ann) return;
        setSelectedAnnId(ann.id);
        stateRef.current.mode = "editing";
        stateRef.current.edit.annId = ann.id;
        if (hit.type === "corner") {
          stateRef.current.edit.type = "corner";
          stateRef.current.edit.index = hit.index; // 0..3
        } else if (hit.type === "vertex") {
          stateRef.current.edit.type = "vertex";
          stateRef.current.edit.index = hit.index; // vertex index
        } else {
          stateRef.current.edit.type = "move";
          stateRef.current.edit.index = null;
          // store offset between mouse client and annotation center for move
          // compute annotation center client coords
          if (ann.type === "bbox") {
            const [x1, y1, x2, y2] = ann.points;
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;
            const [centx, centy] = normalizedToClient(cx, cy);
            stateRef.current.edit.offset = [e.clientX - centx, e.clientY - centy];
          } else if (ann.type === "poly") {
            // centroid approximate
            const rect = imageClientRect();
            const c = computePolyCentroidClient(ann.points, rect);
            stateRef.current.edit.offset = [e.clientX - c[0], e.clientY - c[1]];
          }
        }
        // start capturing pointermove/up (editing will be performed in pointermove handler)
      } else {
        // start drawing new shape
        const norm = clientToNormalized(e.clientX, e.clientY);
        if (!norm) return;
        stateRef.current.mode = "drawing";
        if (tool === "bbox") {
          stateRef.current.draw.inProgress = true;
          stateRef.current.draw.mode = "bbox";
          stateRef.current.draw.start = norm;
          stateRef.current.draw.current = norm;
        } else if (tool === "poly") {
          if (!stateRef.current.draw.inProgress) {
            stateRef.current.draw.inProgress = true;
            stateRef.current.draw.mode = "poly";
            stateRef.current.draw.currentPoly = [norm[0], norm[1]];
            stateRef.current.draw.current = norm;
          } else {
            // if already drawing poly, add vertex
            stateRef.current.draw.currentPoly.push(norm[0], norm[1]);
          }
        }
      }
    };

    const onPointerMove = (e) => {
      stateRef.current.mouse = { cx: e.clientX, cy: e.clientY };

      // Update hover always (so handle becomes ring)
      updateHover(e.clientX, e.clientY);

      // If panning
      if (panStartRef.current) {
        doPan(e);
        return;
      }

      const imgRect = imageClientRect();
      if (!imgRect) return;

      if (stateRef.current.mode === "drawing" && stateRef.current.draw.inProgress) {
        const norm = clientToNormalized(e.clientX, e.clientY);
        if (!norm) return;
        stateRef.current.draw.current = norm;
      } else if (stateRef.current.mode === "editing") {
        const edit = stateRef.current.edit;
        const annIdx = annotations.findIndex((a) => a.id === edit.annId);
        if (annIdx === -1) return;
        const ann = annotations[annIdx];
        // mouse normalized
        const norm = clientToNormalized(e.clientX, e.clientY);
        if (!norm) return;
        if (edit.type === "move") {
          // compute delta normalized and move whole shape
          const [offsetX, offsetY] = edit.offset || [0, 0];
          // compute new center in client coords:
          let newCenterClientX = e.clientX - offsetX;
          let newCenterClientY = e.clientY - offsetY;
          // convert to normalized center
          const rect = imageClientRect();
          const newCenterNx = (newCenterClientX - rect.left) / rect.width;
          const newCenterNy = (newCenterClientY - rect.top) / rect.height;
          // compute current center normalized and delta
          if (ann.type === "bbox") {
            const [x1, y1, x2, y2] = ann.points;
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2;
            const dx = newCenterNx - cx;
            const dy = newCenterNy - cy;
            const newPts = [x1 + dx, y1 + dy, x2 + dx, y2 + dy].map((v) => Math.min(1, Math.max(0, v)));
            setAnnotations((p) => p.map((it) => (it.id === ann.id ? { ...it, points: newPts } : it)));
          } else if (ann.type === "poly") {
            const pts = ann.points.slice();
            // compute centroid
            let cx = 0, cy = 0;
            for (let i = 0; i < pts.length; i += 2) {
              cx += pts[i];
              cy += pts[i+1];
            }
            cx /= (pts.length/2);
            cy /= (pts.length/2);
            const dx = newCenterNx - cx;
            const dy = newCenterNy - cy;
            const newPts = pts.map((v, i) => (i%2===0 ? Math.min(1, Math.max(0, v + dx)) : Math.min(1, Math.max(0, v + dy))));
            setAnnotations((p) => p.map((it) => (it.id === ann.id ? { ...it, points: newPts } : it)));
          }
        } else if (edit.type === "corner" && ann.type === "bbox") {
          // corner indices 0..3 map to (x1,y1),(x2,y1),(x2,y2),(x1,y2)
          const [nx, ny] = norm;
          let [x1, y1, x2, y2] = ann.points;
          if (edit.index === 0) {
            x1 = nx; y1 = ny;
          } else if (edit.index === 1) {
            x2 = nx; y1 = ny;
          } else if (edit.index === 2) {
            x2 = nx; y2 = ny;
          } else if (edit.index === 3) {
            x1 = nx; y2 = ny;
          }
          // normalize ordering
          const newPts = [Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2), Math.max(y1,y2)].map((v) => Math.min(1, Math.max(0, v)));
          setAnnotations((p) => p.map((it) => (it.id === ann.id ? { ...it, points: newPts } : it)));
        } else if (edit.type === "vertex" && ann.type === "poly") {
          const idx = edit.index;
          const pts = ann.points.slice();
          pts[idx*2] = norm[0];
          pts[idx*2+1] = norm[1];
          setAnnotations((p) => p.map((it) => (it.id === ann.id ? { ...it, points: pts } : it)));
        }
      }
    };

    const computePolyCentroidClient = (pts, rect) => {
      if (!rect) return [0,0];
      let cx = 0, cy = 0;
      for (let i = 0; i < pts.length; i += 2) {
        cx += pts[i]; cy += pts[i+1];
      }
      cx /= pts.length/2; cy /= pts.length/2;
      return normalizedToClient(cx, cy);
    };

    const onPointerUp = (e) => {
      // finalize panning if active
      if (panStartRef.current) {
        endPan();
        return;
      }

      // finalize drawing or editing
      if (stateRef.current.mode === "drawing") {
        const d = stateRef.current.draw;
        if (d.inProgress) {
          if (d.mode === "bbox") {
            if (d.start && d.current) {
              const [x1, y1] = d.start;
              const [x2, y2] = d.current;
              const bbox = [Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2), Math.max(y1,y2)];
              // ignore too small
              if (Math.abs(bbox[2]-bbox[0]) > 0.002 && Math.abs(bbox[3]-bbox[1]) > 0.002) {
                const ann = {
                  id: uid(),
                  type: "bbox",
                  points: bbox,
                  className: classes[0]?.name ?? "class",
                  color: classes[0]?.color ?? colorForLabel(classes[0]?.name ?? "class"),
                  visible: true,
                };
                setAnnotations((p) => [...p, ann]);
              }
            }
          } else if (d.mode === "poly") {
            // when finishing poly by double-click or enter/context, we handle elsewhere; on pointerup we don't auto-close
          }
        }
      }
      // reset draw inprogress for bbox
      if (stateRef.current.draw.inProgress && stateRef.current.draw.mode === "bbox") {
        stateRef.current.draw.inProgress = false;
        stateRef.current.draw.start = null;
        stateRef.current.draw.current = null;
      }
      if (stateRef.current.mode === "editing") {
        // clear editing
        stateRef.current.edit = { annId: null, type: null, index: null, offset: null };
        stateRef.current.mode = null;
      } else if (stateRef.current.mode === "drawing") {
        // remain in drawing mode for poly; for bbox we cleared above
        if (stateRef.current.draw.mode === "bbox") {
          stateRef.current.mode = null;
        }
      }
    };

    // right-click finishes polygon
    const onContext = (e) => {
      const d = stateRef.current.draw;
      if (d.inProgress && d.mode === "poly") {
        e.preventDefault();
        const pts = d.currentPoly ?? [];
        if (pts.length >= 6) {
          const ann = {
            id: uid(),
            type: "poly",
            points: pts,
            className: classes[0]?.name ?? "class",
            color: classes[0]?.color ?? colorForLabel(classes[0]?.name ?? "class"),
            visible: true,
          };
          setAnnotations((p) => [...p, ann]);
        }
        d.inProgress = false;
        d.currentPoly = [];
        d.current = null;
        stateRef.current.mode = null;
      }
    };

    // Ctrl/Cmd + scroll to zoom centered at cursor (NEW)
    const onWheel = (e) => {
      // If user holds ctrl or meta, perform zoom centered at mouse pointer
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const zoomFactor = delta > 0 ? 1.08 : 0.92;
        const newZoom = Math.min(4, Math.max(0.25, zoom * zoomFactor));
        // adjust pan so zoom centers on cursor
        const rect = imageClientRect();
        if (!rect) {
          setZoom(newZoom);
          return;
        }
        // cursor point relative to image
        const cursorX = e.clientX;
        const cursorY = e.clientY;
        // compute cursor position normalized within image BEFORE zoom
        const nx = (cursorX - rect.left) / rect.width;
        const ny = (cursorY - rect.top) / rect.height;
        // compute image center in client coords and current pan
        const img = imageRef.current;
        const prevScale = zoom;
        const nextScale = newZoom;
        // We'll update pan so that the point under the cursor stays under the cursor
        // client point = imgLeft + nx * imgWidth * prevScale + pan.x
        // After zoom: imgLeft' + nx * imgWidth * nextScale + pan'.x should equal cursorX
        // Using getBoundingClientRect to compute current image left/top should already reflect pan+scale,
        // so a simpler approach is compute the difference and adjust pan by (cursor - newRectCursor)
        // Temporarily set scale to compute new bounding rect: apply transform, read rect, then compute pan delta.
        // To avoid flicker we compute mathematically: deltaPan = (1 - nextScale/prevScale) * (cursor - imageCenter) 
        // approximate using image center:
        const imgCenterX = rect.left + rect.width / 2;
        const imgCenterY = rect.top + rect.height / 2;
        const dx = cursorX - imgCenterX;
        const dy = cursorY - imgCenterY;
        const ratio = (nextScale / prevScale) - 1;
        panRef.current.x -= dx * ratio;
        panRef.current.y -= dy * ratio;
        // apply new zoom and pan
        setZoom(newZoom);
        if (img) {
          img.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${newZoom})`;
          img.style.transformOrigin = "center center";
        }
      }
    };

    const onKey = (ev) => {
      // space toggles pan while held
      if (ev.code === "Space") {
        if (ev.type === "keydown") {
          spaceDownRef.current = true;
        }
      }

      // Tool shortcuts
      if (ev.key === "b" || ev.key === "B") setTool("bbox");
      if (ev.key === "p" || ev.key === "P") setTool("poly");

      // In onKey handler, add guard for class name input
      const activeElement = document.activeElement;
      const isClassInputFocused = classInputRef.current && classInputRef.current === activeElement;

      // Navigation shortcuts (A/D and Arrow keys)
      if (!isClassInputFocused) {
        if (ev.key === "a" || ev.key === "A" || ev.key === "ArrowLeft") {
          handlePrevImage();
        }
        if (ev.key === "d" || ev.key === "D" || ev.key === "ArrowRight") {
          handleNextImage();
        }
      }

      // Undo/Redo
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "z") {
        ev.preventDefault();
        if (ev.shiftKey) {
          // Redo
          if (historyIndex < history.length - 1) {
            setHistoryIndex(i => i + 1);
            setAnnotations(history[historyIndex + 1]);
          }
        } else {
          // Undo
          if (historyIndex > 0) {
            setHistoryIndex(i => i - 1);
            setAnnotations(history[historyIndex - 1]);
          }
        }
      }

      // ESC to cancel drawing
      if (ev.key === "Escape") {
        const d = stateRef.current.draw;
        if (d.inProgress) {
          d.inProgress = false;
          d.currentPoly = [];
          d.current = null;
          d.start = null;
          stateRef.current.mode = null;
        }
      }

      // Save shortcut
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        // manual save
        (async () => {
          const img = images[currentIdx];
          if (!img) return;
          try {
            const payload = {
              datasetId: dsId,
              imageName: img.name,
              data: annotations,
              updatedAt: new Date().toISOString(),
            };
            const existing = await db.annotations
              .where({ datasetId: dsId, imageName: img.name })
              .first();
            if (existing) await db.annotations.update(existing.id, payload);
            else await db.annotations.add(payload);
            alert("Saved!");
          } catch (err) {
            console.error("Save failed:", err);
            alert("Save failed. See console.");
          }
        })();
      }

      // Fix Delete key to delete annotation
      if ((ev.key === "Delete" || ev.key === "Backspace") && ev.type === "keydown") {
        if (selectedAnnId) deleteAnnotation(selectedAnnId);
      }
    };

    const onKeyUp = (ev) => {
      if (ev.code === "Space") spaceDownRef.current = false;
    };

    // Attach listeners
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("contextmenu", onContext);
    container.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);

    // Ensure image transform matches state initially
    const img = imageRef.current;
    if (img) {
      img.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoom})`;
      img.style.transformOrigin = "center center";
    }

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("contextmenu", onContext);
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [annotations, classes, currentIdx, images, tool, dsId, selectedAnnId, handMode, zoom]);

  // --------------------- Classes & annotation list helpers ---------------------
  const addClass = async () => {
    const name = newClassName.trim();
    if (!name) return;
    if (classes.some((c) => c.name === name)) {
      setNewClassName("");
      return;
    }
    const c = { id: uid(), name, color: colorForLabel(name) };
    setClasses((p) => [c, ...p]);
    setNewClassName("");
  };

  const updateAnnotationClass = (annId, className) => {
    const color = colorForLabel(className);
    updateAnnotations((p) => p.map((a) => (a.id === annId ? { ...a, className, color } : a)));
  };

  const deleteAnnotation = (annId) => updateAnnotations((p) => p.filter((a) => a.id !== annId));

  const toggleAnnotationVisible = (annId) => {
    updateAnnotations((p) => p.map((a) => (a.id === annId ? { ...a, visible: !a.visible } : a)));
  };

  // Add to history
  const addToHistory = (newAnnotations) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newAnnotations]);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  // Update setAnnotations to track history
  const updateAnnotations = (updater) => {
    setAnnotations((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      addToHistory(next);
      return next;
    });
  };

  // Handle next image
  const handleNextImage = () => {
    if (currentIdx < images.length - 1) {
      setCurrentIdx((i) => Math.min(images.length - 1, i + 1));
    }
  };

  // Handle previous image
  const handlePrevImage = () => {
    if (currentIdx > 0) {
      setCurrentIdx((i) => Math.max(0, i - 1));
    }
  };

  // Shortcuts Modal
  const ShortcutsModal = () => (
    <Modal show={showShortcuts} onHide={() => setShowShortcuts(false)}>
      <Modal.Header closeButton>
        <Modal.Title>Keyboard Shortcuts</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <table className="table table-sm">
          <tbody>
            <tr><td><kbd>B</kbd></td><td>Box Tool</td></tr>
            <tr><td><kbd>P</kbd></td><td>Polygon Tool</td></tr>
            <tr><td><kbd>A</kbd> or <kbd>←</kbd></td><td>Previous Image</td></tr>
            <tr><td><kbd>D</kbd> or <kbd>→</kbd></td><td>Next Image</td></tr>
            <tr><td><kbd>Space</kbd></td><td>Hold for Pan Tool</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Cancel Drawing</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>Undo</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>Redo</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save</td></tr>
            <tr><td><kbd>Delete</kbd></td><td>Delete Selected</td></tr>
            <tr><td><kbd>Enter</kbd></td><td>Complete Polygon</td></tr>
          </tbody>
        </table>
      </Modal.Body>
    </Modal>
  );

  // --------------------- UI helpers ---------------------
  const currentImage = images[currentIdx];

  if (loading)
    return (
      <div
        style={{
          height: "80vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: themeColors.background,
        }}
      >
        <Spinner animation="border" />
      </div>
    );

  return (
    <div
      style={{
        height: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "column",
        background: themeColors.background,
        color: themeColors.text,
      }}
    >
      {/* Top toolbar (kept as you had it) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 8,
          borderBottom: `1px solid ${themeColors.border}`,
          background: themeColors.toolbarBg,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="outline-secondary" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back
          </Button>
          <strong style={{ fontSize: 16 }}>{job?.name ?? "Annotation"}</strong>
          <div style={{ marginLeft: 12, color: themeColors.subtleText }}>
            Project : {project?.name ?? `Project ${projectId}`} | Dataset : {dataset?.name ?? `Dataset ${datasetId}`}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button
            variant={tool === "bbox" ? "primary" : "outline-secondary"}
            size="sm"
            onClick={() => setTool("bbox")}
          >
            <Square size={14} /> BBox
          </Button>
          <Button
            variant={tool === "poly" ? "primary" : "outline-secondary"}
            size="sm"
            onClick={() => setTool("poly")}
          >
            <Triangle size={14} /> Polygon
          </Button>

          <Button variant="outline-secondary" size="sm" onClick={() => {
            // zoom out and keep image centered
            setZoom((z) => {
              const nz = Math.max(0.25, z - 0.25);
              const img = imageRef.current;
              if (img) img.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${nz})`;
              return nz;
            });
          }}>
            <ZoomOut size={14} />
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={() => {
            setZoom((z) => {
              const nz = Math.min(3, z + 0.25);
              const img = imageRef.current;
              if (img) img.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${nz})`;
              return nz;
            });
          }}>
            <ZoomIn size={14} />
          </Button>

          <Button variant="outline-secondary" size="sm" onClick={() => setCrosshair((s) => !s)}>
            {crosshair ? <Eye size={14} /> : <EyeOff size={14} />}
          </Button>

          {/* Hand mode toggle (NEW) */}
          <Button
            variant={handMode ? "primary" : "outline-secondary"}
            size="sm"
            onClick={() => setHandMode((h) => !h)}
            title="Toggle hand tool (or hold Space)"
          >
            {/* Use text "Hand" to avoid adding extra icon dependency */}
            Hand
          </Button>

          {/* Add Shortcuts Help Button */}
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setShowShortcuts(true)}
            title="Show Keyboard Shortcuts"
          >
            <Keyboard size={14} />
          </Button>

          <Button
            variant="success"
            size="sm"
            onClick={async () => {
              // manual save
              const img = images[currentIdx];
              if (!img) return alert("No image");
              try {
                const payload = {
                  datasetId: dsId,
                  imageName: img.name,
                  data: annotations,
                  updatedAt: new Date().toISOString(),
                };
                const existing = await db.annotations
                  .where({ datasetId: dsId, imageName: img.name })
                  .first();
                if (existing) await db.annotations.update(existing.id, payload);
                else await db.annotations.add(payload);
                alert("Saved");
              } catch (err) {
                console.error("Save failed:", err);
                alert("Save failed - see console");
              }
            }}
          >
            <Save size={14} /> Save
          </Button>

          {/* Delete Image Button */}
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (!images[currentIdx]) return;
              const imgToDelete = images[currentIdx];
              // Remove image from images array
              setImages((imgs) => imgs.filter((img, idx) => idx !== currentIdx));
              // Move to previous image if possible
              setCurrentIdx((idx) => Math.max(0, idx - 1));
              // Optionally, delete annotations for this image from db
              try {
                await db.annotations.where({ datasetId: dsId, imageName: imgToDelete.name }).delete();
              } catch (err) {
                console.error("Failed to delete image annotations:", err);
              }
            }}
            title="Delete current image"
          >
            <Trash2 size={14} /> Delete Image
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, height: "calc(100% - 60px)" }}>
        <div className="image-annotation-left-panel" style={{ position: "relative",height: "100%" }}>
        <div style = {{position: "absolute",
                       top: 10, 
                       left: leftPanelOpen ? 310 : 10, 
                       zIndex: 1, 
                       display: "flex", 
                       alignItems: "center", 
                       gap: 4, 
                       padding: "4px 8px",
                      background: themeColors.toolbarBg, 
                      borderRadius: 6, 
                      border: `1px solid ${themeColors.border}`}}
              onClick={() => setLeftPanelOpen((open) => !open)}>
          images <ImageIcon></ImageIcon>
        </div>
        {/* Left thumbnails */}
        {leftPanelOpen && (
          <div
            style={{
              width: 300,
              height: "100%",
              borderRight: `1px solid ${themeColors.border}`,
              background: themeColors.sidebarBg,
              padding: 8,
              overflowY: "auto",
              transition: "width 0.2s",
              position: "relative",
            }}
          >
            {/* <Button
              variant="outline-secondary"
              size="sm"
              style={{ position: "absolute", left: 8, top: 8, zIndex: 2 }}
              onClick={() => setLeftPanelOpen(false)}
              title="Hide sidebar"
            >
              <ChevronLeft size={14} />
            </Button> */}
            <div className="d-flex justify-content-between align-items-center mb-2">
              <b>Images</b>
              <Badge bg="secondary">{images.length}</Badge>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              {images.map((img, i) => (
                <div
                  key={img.id}
                  onClick={() => setCurrentIdx(i)}
                  style={{
                    cursor: "pointer",
                    border:
                      i === currentIdx ? `2px solid ${themeColors.accent ?? "#4f46e5"}` : `1px solid ${themeColors.border}`,
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  {img.url ? (
                    <img
                      src={img.url}
                      alt={img.name}
                      style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }}
                      onError={(e) => {
                        e.currentTarget.src = "";
                        console.warn("Thumbnail failed:", img.url);
                      }}
                    />
                  ) : (
                    <div style={{ width: "100%", aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center", color: themeColors.subtleText }}>
                      <ImageIcon />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
     
        </div>
        {/* Center: image + canvas overlay */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: themeColors.canvasBg ?? themeColors.background,
            position: "relative",
            overflow: "hidden",
          }}
          ref={containerRef}
        >
       
          {currentImage?.url ? (
            <>
              <div
                className="annotation-stage"
                style={{
                  transition: "transform 0.05s linear",
                  // hide default cursor over stage (we render crosshair/dot ourselves)
                  // Note: buttons and sidebar will still use system cursor
                }}
              >
              <img
                ref={imageRef}
                src={currentImage.url}
                alt={currentImage.name}
                style={{
                  maxWidth: `100%`,
                  maxHeight: `85vh`,
                  objectFit: "contain",
                  display: "block",
                  // transform will be set dynamically (pan + zoom)
                  transform: `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  userSelect: "none",
                }}
                onError={(e) => {
                  e.currentTarget.src = "";
                  console.warn("Full image load failed:", currentImage.url);
                }}
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none", // pointer events handled on container
                }}
              />
              {/* bottom bar with name and nav (full width) */}
              <div
                style={{
                  position: "absolute",
                  bottom: 10,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "60%",
                  maxWidth: 900,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(0,0,0,0.6)",
                  color: "white",
                  padding: "6px 8px",
                  borderRadius: 6,
                }}
              >
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    size="sm"
                    variant="light"
                    onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                </div>

                <div style={{ textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {currentImage.name}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    size="sm"
                    variant="light"
                    onClick={() => setCurrentIdx((i) => Math.min(images.length - 1, i + 1))}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", color: themeColors.subtleText }}>
              <ImageIcon size={48} />
              <div>No image selected</div>
            </div>
          )}
        </div>

        <div className="image-annotation-right-panel" style={{ position: "relative" }}>
        <div style = {{position: "absolute",
                       top: 10, 
                       right: rightPanelOpen ? 310 : 10, 
                       zIndex: 1, 
                       display: "flex", 
                       alignItems: "center", 
                       gap: 4, 
                       padding: "4px 8px",
                      background: themeColors.toolbarBg, 
                      borderRadius: 6, 
                      border: `1px solid ${themeColors.border}`}}
            onClick={() => setRightPanelOpen((open) => !open)}>
          labels <TagIcon></TagIcon>
        </div>
        {/* Right: annotations & classes */}
        {rightPanelOpen && (
          <div
            style={{
              width: 300,
              height: "100%",
              borderRight: `1px solid ${themeColors.border}`,
              background: themeColors.sidebarBg,
              padding: 8,
              overflowY: "auto",
              transition: "width 0.2s",
              position: "relative",
            }}
          >
            {/* <Button
              variant="outline-secondary"
              size="sm"
              style={{ position: "absolute",height: '100px', left: -5, top:"50%", zIndex: 2 }}
              onClick={() => setRightPanelOpen(false)}
              title="Hide sidebar"
            >
              <ChevronRight size={14} />
            </Button> */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h6 style={{ margin: 0 }}>Annotations</h6>
              <small style={{ color: themeColors.subtleText }}>{annotations.length}</small>
            </div>

            <div style={{ marginBottom: 8 ,width: '100%'}}>
              {annotations.length === 0 ? (
                <div style={{ color: themeColors.subtleText }}>No annotations yet.</div>
              ) : (
                <ListGroup>
                  {annotations.map((a) => (
                    <ListGroup.Item
                      key={a.id}
                      active={a.id === selectedAnnId}
                      onClick={() => setSelectedAnnId(a.id)}
                      style={{ display: "flex",
                                gap: 8,
                                alignItems: "center",
                                justifyContent: "space-between",
                                color: themeColors.text,
                                backgroundColor: themeColors.cardBg,
                                border: `1px solid ${themeColors.border}`,}}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                        <div style={{ width: 14, height: 14, background: a.color, borderRadius: 3 }} />
                        <div style={{ flex: 1 }}>
                          <Form.Select
                            size="sm"
                            value={a.className}
                            onChange={(e) => updateAnnotationClass(a.id, e.target.value)}
                          >
                            {classes.map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </Form.Select>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 6 }}>
                        <Button size="sm" variant="outline-secondary" onClick={() => toggleAnnotationVisible(a.id)}>
                          {a.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                        <Button size="sm" variant="outline-danger" onClick={() => deleteAnnotation(a.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </div>

            <hr />

            <div style={{ marginBottom: 8 }}>
              <h6 style={{ marginBottom: 8 }}>Classes</h6>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <InputGroup>
                  <Form.Control
                    ref={classInputRef}
                    size="sm"
                    placeholder="New class name"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addClass(); }}
                  />
                  <Button variant="primary" size="sm" onClick={addClass}>Add</Button>
                </InputGroup>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {classes.map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ width: 14, height: 14, background: c.color, borderRadius: 3 }} />
                      <div>{c.name}</div>
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => {
                          if (selectedAnnId) updateAnnotationClass(selectedAnnId, c.name);
                        }}
                      >
                        Assign
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <hr />

            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant="outline-secondary"
                onClick={() => { setCurrentIdx((i) => Math.max(0, i - 1)); }}
              >
                <ChevronLeft size={14} /> Prev
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => { setCurrentIdx((i) => Math.min(images.length - 1, i + 1)); }}
              >
                Next <ChevronRight size={14} />
              </Button>
              <div style={{ marginLeft: "auto", color: themeColors.subtleText, alignSelf: "center" }}>
                {currentIdx + 1}/{images.length}
              </div>
            </div>
          </div>
        )}
 
        </div>
      </div>
      <ShortcutsModal />
    </div>
  );
}
