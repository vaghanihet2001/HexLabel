// frontend/src/pages/Annotate.jsx
import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Button,
  Spinner,
  Badge,
  ListGroup,
  Form,
  InputGroup,
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
} from "lucide-react";
import { db } from "../utils/db";
import { useTheme } from "../components/ThemeContext";

// Utility to generate color for class
const colorForLabel = (label) => {
  // deterministic-ish color from label string
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h << 5) - h + label.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 70% 50%)`;
};

// Unique id generator (simple)
const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 9);

export default function Annotate() {
  const { projectId, datasetId, jobId } = useParams();
  const navigate = useNavigate();
  const { themeColors } = useTheme();

  const dsId = Number(datasetId);
  const [job, setJob] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [project, setProject] = useState(null);
  const [images, setImages] = useState([]); // {id,name,url,...}
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const [tool, setTool] = useState("bbox"); // 'bbox' | 'poly'
  const [crosshair, setCrosshair] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [annotations, setAnnotations] = useState([]); // current image annotations
  const [classes, setClasses] = useState([]); // [{name,color,id}]
  const [newClassName, setNewClassName] = useState("");
  const [selectedAnnId, setSelectedAnnId] = useState(null);

  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const createdUrlsRef = useRef(new Set());
  const autosaveTimer = useRef(null);
  const drawingState = useRef({
    inProgress: false,
    start: null, // [x,y] normalized
    currentPoly: [], // array of normalized [x,y]
  });

  // Ensure folder permission helper
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

  // ---- Load dataset, job, images on mount or params change ----
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        console.log("Loading project/dataset/job...");
        const [proj, ds, jb] = await Promise.all([
          db.projects.get(Number(projectId)),
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

        // compute classes from DB (if you have classes store later - for now derive from annotations)
        // load images that are part of job
        const jobImageIds = jb?.imageIds ?? [];
        const imgs =
          jobImageIds.length > 0
            ? await db.images.where("id").anyOf(jobImageIds).toArray()
            : await db.images.where("datasetId").equals(dsId).toArray();

        // Build preview URLs (try folderHandle/raw_images/<name>, fallback img.url or img.file)
        const resolved = [];
        for (const img of imgs) {
          let url = null;
          try {
            if (ds.folderHandle) {
              try {
                // try to open raw_images subfolder (this is where uploads were saved)
                const rawDir = await ds.folderHandle.getDirectoryHandle("raw_images", {
                  create: false,
                });
                const fh = await rawDir.getFileHandle(img.name);
                const file = await fh.getFile();
                url = URL.createObjectURL(file);
                createdUrlsRef.current.add(url);
              } catch (err) {
                // not found in raw_images or permission issue -> fallback
                // console.warn("raw_images lookup failed for", img.name, err);
              }
            }
            if (!url && img.file instanceof Blob) {
              url = URL.createObjectURL(img.file);
              createdUrlsRef.current.add(url);
            }
            if (!url && img.url) {
              // if it's a relative/absolute path, try to use it as-is (web app hosted contexts may block file://)
              url = img.url;
            }
          } catch (e) {
            console.warn("Failed to create url for image", img.name, e);
          }
          resolved.push({ ...img, url });
        }

        if (!mounted) return;
        setImages(resolved);
        setCurrentIdx(0);

        // derive classes from existing annotations in DB (unique className across dataset)
        const allAnn = await db.annotations.where("datasetId").equals(dsId).toArray();
        const labels = new Map();
        for (const r of allAnn) {
          const arr = r?.data ?? [];
          for (const a of arr) {
            const name = a.className || "class";
            if (!labels.has(name)) labels.set(name, colorForLabel(name));
          }
        }
        // initial classes
        setClasses(Array.from(labels.entries()).map(([name, color]) => ({ id: uid(), name, color })));
      } catch (err) {
        console.error("Load failed:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      // revoke created urls
      createdUrlsRef.current.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      });
      createdUrlsRef.current.clear();
    };
  }, [projectId, datasetId, jobId]);

  // ---- Load annotations when image or dataset changes ----
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
        // ensure each annotation has id & color
        const normalized = data.map((a) => ({
          id: a.id ?? uid(),
          type: a.type,
          points: a.points,
          className: a.className || "class",
          color: a.color || colorForLabel(a.className || "class"),
        }));
        setAnnotations(normalized);
        setSelectedAnnId(null);
      } catch (e) {
        console.warn("Failed to load annotations:", e);
        setAnnotations([]);
      }
    };
    loadForImage();
  }, [images, currentIdx, dsId]);

  // ---- Autosave annotations (debounced) ----
  const scheduleSave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
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
        // console.log("Annotations autosaved");
      } catch (err) {
        console.error("Failed autosave:", err);
      }
    }, 1200);
  }, [annotations, currentIdx, images, dsId]);

  useEffect(() => {
    scheduleSave();
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [annotations, scheduleSave]);

  // ---- Helpers to map mouse coords to normalized image coords (0..1) ----
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
    // clamp
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };
  const normalizedToClient = (nx, ny) => {
    const rect = imageClientRect();
    if (!rect) return null;
    return [rect.left + nx * rect.width, rect.top + ny * rect.height];
  };

  // ---- Drawing logic ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resizeCanvas = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const render = () => {
      // clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // draw existing annotations overlay (scale normalized to image rect)
      const rect = imageClientRect();
      if (!rect) return;

      ctx.save();
      // draw poly/bbox with colors
      for (const a of annotations) {
        ctx.strokeStyle = a.color || colorForLabel(a.className || "class");
        ctx.fillStyle = a.color ? hexToRgba(a.color, 0.12) : hexToRgba("#000000", 0.08);
        ctx.lineWidth = a.id === selectedAnnId ? 3 : 2;

        if (a.type === "bbox") {
          // points: [x1,y1,x2,y2] normalized
          const [x1, y1, x2, y2] = a.points;
          const cx = rect.left + x1 * rect.width;
          const cy = rect.top + y1 * rect.height;
          const cw = (x2 - x1) * rect.width;
          const ch = (y2 - y1) * rect.height;
          ctx.strokeRect(cx - rect.left, cy - rect.top, cw, ch);
          ctx.fillRect(cx - rect.left, cy - rect.top, cw, ch);
        } else if (a.type === "poly") {
          const pts = a.points; // [x,y,x,y,...]
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) {
            const px = rect.left + pts[i] * rect.width - rect.left;
            const py = rect.top + pts[i + 1] * rect.height - rect.top;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
        }
      }

      // draw in-progress shape
      const d = drawingState.current;
      if (d.inProgress) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        if (d.mode === "bbox" && d.start && d.current) {
          const [sx, sy] = d.start;
          const [cxn, cyn] = d.current;
          const x = Math.min(sx, cxn);
          const y = Math.min(sy, cyn);
          const w = Math.abs(cxn - sx);
          const h = Math.abs(cyn - sy);
          ctx.strokeRect(
            rect.left + x * rect.width - rect.left,
            rect.top + y * rect.height - rect.top,
            w * rect.width,
            h * rect.height
          );
        } else if (d.mode === "poly" && d.currentPoly.length) {
          const pts = d.currentPoly;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) {
            const px = rect.left + pts[i] * rect.width - rect.left;
            const py = rect.top + pts[i + 1] * rect.height - rect.top;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          // current mouse as last point (if exists)
          if (d.current) {
            const [mx, my] = d.current;
            ctx.lineTo(rect.left + mx * rect.width - rect.left, rect.top + my * rect.height - rect.top);
          }
          ctx.stroke();
        }
      }

      // crosshair
      if (crosshair) {
        const m = drawingState.current.mouse;
        if (m && rect) {
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 1;
          // vertical
          ctx.beginPath();
          ctx.moveTo(m.x - rect.left, 0);
          ctx.lineTo(m.x - rect.left, canvas.height);
          ctx.stroke();
          // horizontal
          ctx.beginPath();
          ctx.moveTo(0, m.y - rect.top);
          ctx.lineTo(canvas.width, m.y - rect.top);
          ctx.stroke();
        }
      }

      ctx.restore();
    };

    // small helper to convert color to rgba for fill
    function hexToRgba(hex, a) {
      // convert hsl or hex? if already hsl return rgba approximation by using canvas fillStyle trick
      if (hex.startsWith("hsl")) {
        // canvas can parse hsl and accept alpha via replacing hsl( -> hsla(
        return hex.replace("hsl(", "hsla(").replace(")", `, ${a})`);
      }
      // hex to rgba
      const c = hex.replace("#", "");
      const bigint = parseInt(c.length === 3 ? c.split("").map(ch=>ch+ch).join("") : c, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r},${g},${b},${a})`;
    }

    // Render loop
    const raf = () => {
      render();
      requestRef = requestAnimationFrame(raf);
    };
    let requestRef = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(requestRef);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [annotations, crosshair, zoom, selectedAnnId]); // re-render when annotations change

  // ---- Mouse handling on container (for drawing) ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onPointerDown = (e) => {
      // only left button
      if (e.button && e.button !== 0) return;
      const imgRect = imageClientRect();
      if (!imgRect) return;
      // check if clicked inside image
      if (e.clientX < imgRect.left || e.clientX > imgRect.right || e.clientY < imgRect.top || e.clientY > imgRect.bottom) return;

      const norm = clientToNormalized(e.clientX, e.clientY);
      if (!norm) return;
      if (tool === "bbox") {
        drawingState.current.inProgress = true;
        drawingState.current.mode = "bbox";
        drawingState.current.start = norm;
        drawingState.current.current = norm;
      } else if (tool === "poly") {
        // add point to poly
        if (!drawingState.current.inProgress) {
          drawingState.current.inProgress = true;
          drawingState.current.mode = "poly";
          drawingState.current.currentPoly = [norm[0], norm[1]];
        } else {
          drawingState.current.currentPoly.push(norm[0], norm[1]);
        }
      }
    };

    const onPointerMove = (e) => {
      const imgRect = imageClientRect();
      drawingState.current.mouse = { x: e.clientX, y: e.clientY };
      if (!imgRect) return;
      const norm = clientToNormalized(e.clientX, e.clientY);
      if (!norm) return;
      if (drawingState.current.inProgress) {
        if (drawingState.current.mode === "bbox") {
          drawingState.current.current = norm;
        } else if (drawingState.current.mode === "poly") {
          drawingState.current.current = norm;
        }
      }
    };

    const finishBBox = () => {
      const d = drawingState.current;
      if (d.inProgress && d.mode === "bbox" && d.start && d.current) {
        const [x1, y1] = d.start;
        const [x2, y2] = d.current;
        const bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
        const ann = {
          id: uid(),
          type: "bbox",
          points: bbox,
          className: classes[0]?.name ?? "class",
          color: classes[0]?.color ?? colorForLabel(classes[0]?.name ?? "class"),
        };
        setAnnotations((p) => [...p, ann]);
      }
      d.inProgress = false;
      d.start = null;
      d.current = null;
    };

    const onPointerUp = (e) => {
      if (drawingState.current.inProgress && drawingState.current.mode === "bbox") {
        finishBBox();
      }
    };

    const onContext = (e) => {
      // right-click finishes polygon (if creating)
      if (drawingState.current.inProgress && drawingState.current.mode === "poly") {
        e.preventDefault();
        const d = drawingState.current;
        const pts = d.currentPoly ?? [];
        if (pts.length >= 6) {
          // close polygon
          const ann = {
            id: uid(),
            type: "poly",
            points: pts,
            className: classes[0]?.name ?? "class",
            color: classes[0]?.color ?? colorForLabel(classes[0]?.name ?? "class"),
          };
          setAnnotations((p) => [...p, ann]);
        }
        d.inProgress = false;
        d.currentPoly = [];
        d.current = null;
      }
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("contextmenu", onContext);

    // keyboard shortcuts
    const onKey = (ev) => {
      if (ev.key === "b" || ev.key === "B") setTool("bbox");
      if (ev.key === "p" || ev.key === "P") setTool("poly");
      if (ev.key === "Enter") {
        // finish poly if exists
        const d = drawingState.current;
        if (d.inProgress && d.mode === "poly") {
          const pts = d.currentPoly ?? [];
          if (pts.length >= 6) {
            const ann = {
              id: uid(),
              type: "poly",
              points: pts,
              className: classes[0]?.name ?? "class",
              color: classes[0]?.color ?? colorForLabel(classes[0]?.name ?? "class"),
            };
            setAnnotations((p) => [...p, ann]);
          }
          d.inProgress = false;
          d.currentPoly = [];
          d.current = null;
        }
      }
      if (ev.key === "Delete" || ev.key === "Backspace") {
        // remove selected annotation
        if (selectedAnnId) setAnnotations((p) => p.filter((a) => a.id !== selectedAnnId));
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        // save now
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
    };

    window.addEventListener("keydown", onKey);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
    };
  }, [tool, classes, annotations, selectedAnnId, images, currentIdx, dsId]);

  // ---- Add class handler ----
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

  // ---- Annotation list UI handlers ----
  const updateAnnotationClass = (annId, className) => {
    const color = colorForLabel(className);
    setAnnotations((p) => p.map((a) => (a.id === annId ? { ...a, className, color } : a)));
  };
  const deleteAnnotation = (annId) => setAnnotations((p) => p.filter((a) => a.id !== annId));

  // ---- UI helpers ----
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
      {/* Top toolbar */}
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

          <Button variant="outline-secondary" size="sm" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
            <ZoomOut size={14} />
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn size={14} />
          </Button>

          <Button variant="outline-secondary" size="sm" onClick={() => setCrosshair((s) => !s)}>
            {crosshair ? <Eye size={14} /> : <EyeOff size={14} />}
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
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, height: "calc(100% - 60px)" }}>
        {/* Left thumbnails */}
        <div
          style={{
            width: 300,
            borderRight: `1px solid ${themeColors.border}`,
            background: themeColors.sidebarBg,
            padding: 8,
            overflowY: "auto",
          }}
        >
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
                  width: "100%",
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
              <img
                ref={imageRef}
                src={currentImage.url}
                alt={currentImage.name}
                style={{
                  maxWidth: `${100 * zoom}%`,
                  maxHeight: `85vh`,
                  objectFit: "contain",
                  display: "block",
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
            </>
          ) : (
            <div style={{ textAlign: "center", color: themeColors.subtleText }}>
              <ImageIcon size={48} />
              <div>No image selected</div>
            </div>
          )}
        </div>

        {/* Right: annotations & classes */}
        <div
          style={{
            width: 320,
            borderLeft: `1px solid ${themeColors.border}`,
            background: themeColors.sidebarBg,
            padding: 12,
            overflowY: "auto",
          }}
        >
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
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ width: 14, height: 14, background: a.color, borderRadius: 3 }} />
                    </div>
                    <div style={{ display: "flex",width: '100%', gap: 6 }}>
                      <Form.Select
                        size="sm"
                        value={a.className}
                        onChange={(e) => updateAnnotationClass(a.id, e.target.value)}
                        style={{ maxWidth:"50%" }}
                      >
                        {classes.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </Form.Select>
                    </div>
                      <Button size="sm" variant="outline-danger" onClick={() => deleteAnnotation(a.id)}>
                        <Trash2 size={14} />
                      </Button>
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
                  size="sm"
                  placeholder="New class name"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addClass();
                  }}
                />
                <Button variant="primary" size="sm" onClick={addClass}>
                  Add
                </Button>
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
                        // assign selected annotation to this class if any selected
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
              onClick={() => {
                // go prev
                setCurrentIdx((i) => Math.max(0, i - 1));
              }}
            >
              <ChevronLeft size={14} /> Prev
            </Button>
            <Button
              variant="outline-secondary"
              onClick={() => {
                setCurrentIdx((i) => Math.min(images.length - 1, i + 1));
              }}
            >
              Next <ChevronRight size={14} />
            </Button>
            <div style={{ marginLeft: "auto", color: themeColors.subtleText, alignSelf: "center" }}>
              {currentIdx + 1}/{images.length}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
