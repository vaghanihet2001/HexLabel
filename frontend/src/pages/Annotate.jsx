// frontend/src/pages/Annotate.jsx
import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
} from "lucide-react";
import { db } from "../utils/db";
import { useTheme } from "../components/ThemeContext";
import AppModal from "../components/AppModal";

import {
  readDatasetMetadata,
  writeDatasetMetadata,
  writeJobFile,
  readJobFile,
  deleteJobFile,
  readImageMeta,
  writeImageMeta,
  readDatasetClasses,
  addDatasetClass,
  deleteImageFiles,
  deleteAnnotationFile,
} from "../utils/fs";

/* ---------------------------
  Helpers
--------------------------- */

// Utility to generate color for class
const colorForLabel = (label) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h << 5) - h + label.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 70% 50%)`;
};
const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 9);

/* ---------------------------
  Component
--------------------------- */
export default function Annotate() {
  const { projectId, datasetId, jobId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
  const [defaultClassId, setDefaultClassId] = useState(null);
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
    edit: { annId: null, type: null, index: null, offset: null }, // type: move, corner, vertex
    mouse: { cx: 0, cy: 0 },
    hover: { type: "none", annId: null, index: null },
    defaultClassId: null,
    classes: [],
  });

  // Keep ref in sync
  useEffect(() => {
    stateRef.current.defaultClassId = defaultClassId;
    stateRef.current.classes = classes;
  }, [defaultClassId, classes]);

  // History state for undo/redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Shortcuts modal state
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Panel state
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const classInputRef = useRef(null);

  // -----------------------------
  // AppModal (custom confirm)
  // -----------------------------
  const [modal, setModal] = useState({
    show: false,
    type: "info",
    title: "",
    message: "",
    confirmText: "OK",
    cancelText: "Cancel",
    onConfirm: null,
    autoClose: false,
  });
  const openModal = (d) => setModal({ ...modal, ...d, show: true });
  const closeModal = () => setModal((m) => ({ ...m, show: false, onConfirm: null }));

  // -----------------------------
  // helpers: ensure folder permission
  // -----------------------------
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

  // helper: resolve dataset folder handle in robust way
  const resolveDatasetFolder = async () => {
    if (dataset?.folderHandle) return dataset.folderHandle;
    if (project?.folderHandle) {
      try {
        return await project.folderHandle.getDirectoryHandle(dataset.name);
      } catch {
        return null;
      }
    }
    return null;
  };

  /* -----------------------------
     Filesystem helpers (internal)
     - writeAnnotationFile (annotations/active/<imageId>.json)
     - readAnnotationFile
     - deleteAnnotationFile (active + versions)
     - deleteImageFile (images/raw/<imageName>)
     - updateJobFileAfterImageDeletion
     - updateDatasetJsonJobCounts
  ----------------------------- */

  const writeAnnotationFile = async (folderHandle, imageId, payload, versionId = null) => {
    // uses Option B: filename = <imageId>.json
    if (!folderHandle) return;
    try {
      const annotationsHandle = await folderHandle.getDirectoryHandle("annotations", { create: true });
      if (versionId) {
        const versionsHandle = await annotationsHandle.getDirectoryHandle("versions", { create: true });
        const vHandle = await versionsHandle.getDirectoryHandle(versionId, { create: true });
        const fh = await vHandle.getFileHandle(`${imageId}.json`, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(payload, null, 2));
        await w.close();
      } else {
        const activeHandle = await annotationsHandle.getDirectoryHandle("active", { create: true });
        const fh = await activeHandle.getFileHandle(`${imageId}.json`, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(payload, null, 2));
        await w.close();
      }
    } catch (err) {
      console.warn("writeAnnotationFile failed:", err);
    }
  };

  const readAnnotationFile = async (folderHandle, imageId, versionId = null) => {
    if (!folderHandle) return null;
    try {
      const annotationsHandle = await folderHandle.getDirectoryHandle("annotations");
      if (versionId) {
        const versionsHandle = await annotationsHandle.getDirectoryHandle("versions");
        const vHandle = await versionsHandle.getDirectoryHandle(versionId);
        const fh = await vHandle.getFileHandle(`${imageId}.json`);
        const file = await fh.getFile();
        return JSON.parse(await file.text());
      } else {
        const activeHandle = await annotationsHandle.getDirectoryHandle("active");
        const fh = await activeHandle.getFileHandle(`${imageId}.json`);
        const file = await fh.getFile();
        return JSON.parse(await file.text());
      }
    } catch (err) {
      // file not found or other error
      return null;
    }
  };



  const updateJobFileAfterImageDeletion = async (folderHandle, removedImageId) => {
    if (!folderHandle) return;
    try {
      const jobsHandle = await folderHandle.getDirectoryHandle("jobs");
      for await (const entry of jobsHandle.values()) {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
        try {
          const fh = await jobsHandle.getFileHandle(entry.name);
          const file = await fh.getFile();
          const job = JSON.parse(await file.text());
          const newImageIds = (job.imageIds || []).filter((id) => id !== removedImageId);
          if (newImageIds.length !== (job.imageIds || []).length) {
            job.imageIds = newImageIds;
            // update job file
            const wfh = await jobsHandle.getFileHandle(entry.name, { create: true });
            const w = await wfh.createWritable();
            await w.write(JSON.stringify(job, null, 2));
            await w.close();
            // also update DB record
            await db.jobs.update(job.id, { imageIds: newImageIds });
          }
        } catch (err) {
          // skip invalid job file
        }
      }
    } catch (err) {
      // no jobs folder or other error
    }
  };

  const updateDatasetJsonJobCounts = async (folderHandle) => {
    if (!folderHandle) return;
    try {
      const meta = (await readDatasetMetadata(folderHandle)) || {};
      meta.jobs = meta.jobs || [];
      // For each job in dataset.json, recompute imageCount from file system or db
      for (let i = 0; i < meta.jobs.length; i++) {
        const j = meta.jobs[i];
        // prefer DB job row if present
        const dbJob = await db.jobs.get(j.id);
        if (dbJob) {
          meta.jobs[i].imageCount = (dbJob.imageIds || []).length;
          meta.jobs[i].status = dbJob.status;
        } else {
          // fallback: try to read job file
          try {
            const jobsHandle = await folderHandle.getDirectoryHandle("jobs");
            const fh = await jobsHandle.getFileHandle(`${j.id}.json`);
            const file = await fh.getFile();
            const job = JSON.parse(await file.text());
            meta.jobs[i].imageCount = (job.imageIds || []).length;
            meta.jobs[i].status = job.status || "not_started";
          } catch {
            meta.jobs[i].imageCount = 0;
          }
        }
      }
      await writeDatasetMetadata(folderHandle, meta);
    } catch (err) {
      console.warn("updateDatasetJsonJobCounts failed:", err);
    }
  };

  /* -----------------------------
     Reset image / canvas helpers
  ----------------------------- */
  const resetImageAndCanvas = () => {
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    if (canvasRef.current && containerRef.current) {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    if (imageRef.current) {
      imageRef.current.style.transform = `translate(0px, 0px) scale(1)`;
      imageRef.current.style.transformOrigin = "center center";
    }
  };

  const handleLeftPanelToggle = (open) => {
    setLeftPanelOpen(open);
    setTimeout(resetImageAndCanvas, 0);
  };
  const handleRightPanelToggle = (open) => {
    setRightPanelOpen(open);
    setTimeout(resetImageAndCanvas, 0);
  };

  /* -----------------------------
     LOAD: dataset, job, images, classes
  ----------------------------- */
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
          openModal({
            type: "error",
            title: "Dataset not found",
            message: "Dataset not found. Returning to project.",
          });
          navigate(`/project/${projectId}`);
          return;
        }
        setProject(proj || null);
        setDataset(ds);
        setJob(jb || null);

        // load images (job-specific or whole dataset)
        const jobImageIds = jb?.imageIds ?? [];
        let imgs =
          jobImageIds.length > 0
            ? await db.images.where("id").anyOf(jobImageIds).toArray()
            : await db.images.where("datasetId").equals(dsId).toArray();

        // CLEANUP: If the DB returned a stale blob: url (due to a previous bug), remove it
        for (let i = 0; i < imgs.length; i++) {
          if (imgs[i].url && typeof imgs[i].url === "string") {
            delete imgs[i].url;
            db.images.update(imgs[i].id, { url: undefined }).catch(() => {});
          }
        }

        // Resolve dataset folder handle once
        const dsFolder = ds.folderHandle || (proj?.folderHandle
          ? await proj.folderHandle.getDirectoryHandle(ds.name).catch(() => null)
          : null);

        // -------------------------------------------------------
        // RECOVERY: If DB records are missing (IndexedDB cleared),
        // try three strategies in order — no scanning, no guessing.
        //
        // Tier 1: images/meta/<imageId>.json           (new jobs with meta files)
        // Tier 2: images/raw/<imageId>.<ext>           (new UUID-named files without
        //          meta yet, AND legacy readable-name files like frame_00001.jpg)
        // Tier 3: job.imageNames map                   (jobs created in the brief
        //          window between UUID change & meta file addition)
        // -------------------------------------------------------
        if (jobImageIds.length > 0 && imgs.length < jobImageIds.length && dsFolder) {
          const foundIds = new Set(imgs.map(i => i.id));
          const missingIds = jobImageIds.filter(id => !foundIds.has(id));
          const imageNamesMap = jb?.imageNames ?? {}; // legacy fallback map

          let imagesDir, rawDir;
          try {
            imagesDir = await dsFolder.getDirectoryHandle("images");
            rawDir = await imagesDir.getDirectoryHandle("raw");
          } catch { /* no images folder at all */ }

          const tryOpenFile = async (filename) => {
            if (!rawDir) return null;
            try {
              const fh = await rawDir.getFileHandle(filename);
              const file = await fh.getFile();
              const url = URL.createObjectURL(file);
              createdUrlsRef.current.add(url);
              return { file, url, filename };
            } catch { return null; }
          };

          for (const missingId of missingIds) {
            let recovered = null;

            // --- Tier 0: fix 0 - read imageName from annotation file (unmigrated data) ---
            if (!recovered) {
              try {
                const annFile = await readAnnotationFile(dsFolder, missingId, null);
                if (annFile && annFile.imageName) {
                  const opened = await tryOpenFile(annFile.imageName);
                  if (opened) {
                    recovered = {
                      id: missingId,
                      name: annFile.imageName,
                      originalName: annFile.imageName,
                      datasetId: dsId,
                      jobId: jb?.id ?? null,
                      tagIds: [],
                      createdAt: new Date().toISOString(),
                      url: opened.url,
                    };
                  }
                }
              } catch { /* no annotation file */ }
            }


            // --- Tier 1: meta file (new jobs) ---
            if (!recovered) {
              try {
                const meta = await readImageMeta(dsFolder, missingId);
                if (meta?.name) {
                  const opened = await tryOpenFile(meta.name);
                  if (opened) {
                    recovered = { ...meta, datasetId: dsId, url: opened.url, _hasMeta: true };
                  }
                }
              } catch { /* no meta file */ }
            }

            // --- Tier 2: id is the filename base (legacy readable OR new UUID) ---
            if (!recovered) {
              const exts = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"];
              for (const ext of exts) {
                const opened = await tryOpenFile(`${missingId}${ext}`);
                if (opened) {
                  recovered = {
                    id: missingId,
                    name: opened.filename,
                    originalName: opened.filename,
                    datasetId: dsId,
                    jobId: jb?.id ?? null,
                    tagIds: [],
                    createdAt: new Date().toISOString(),
                    url: opened.url,
                  };
                  break;
                }
              }
            }

            // --- Tier 3: job.imageNames map (transition-period jobs) ---
            if (!recovered && imageNamesMap[missingId]) {
              const knownName = imageNamesMap[missingId];
              const opened = await tryOpenFile(knownName);
              if (opened) {
                recovered = {
                  id: missingId,
                  name: knownName,
                  originalName: knownName,
                  datasetId: dsId,
                  jobId: jb?.id ?? null,
                  tagIds: [],
                  createdAt: new Date().toISOString(),
                  url: opened.url,
                };
              }
            }

            if (recovered) {
              // Re-register in DB so next load is instant
              const { url: _u, _hasMeta: _h, ...dbPayload } = recovered;
              await db.images.put(dbPayload);
              // Write meta file if missing, so future recovery is Tier 1
              if (!recovered._hasMeta) {
                try {
                  await (await import("../utils/fs")).writeImageMeta(dsFolder, dbPayload);
                } catch { /* best effort */ }
              }
              imgs.push(recovered);
            } else {
              console.warn(`Recovery failed for image ${missingId} — file not found on disk`);
            }
          }
        }


        const resolved = [];
        for (const img of imgs) {
          // If recovery already attached a url, use it directly
          if (img.url) {
            resolved.push(img);
            continue;
          }
          let url = null;
          try {
            if (dsFolder) {
              try {
                const imagesDir = await dsFolder.getDirectoryHandle("images");
                const rawDir = await imagesDir.getDirectoryHandle("raw");
                const fh = await rawDir.getFileHandle(img.name);
                const file = await fh.getFile();
                url = URL.createObjectURL(file);
                createdUrlsRef.current.add(url);
              } catch { /* fallback to stored blob / url */ }
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

        // Deep linking: if ?imageId=... is present, jump to it
        const targetImageId = searchParams.get("imageId");
        if (targetImageId) {
          const idx = resolved.findIndex((img) => img.id === targetImageId);
          if (idx !== -1) setCurrentIdx(idx);
          else setCurrentIdx(0);
        } else {
          setCurrentIdx(0);
        }

        // Load classes from dataset.json (the class dictionary — source of truth)
        // This replaces the old approach of scanning all annotation files.
        const dsMeta = await readDatasetMetadata(dsFolder);
        const builtClasses = (dsMeta?.classes ?? []).map(c => ({
          id: c.id,
          name: c.name,
          color: c.color,
        }));
        setClasses(builtClasses);

        // Set first class as default if none set
        if (!defaultClassId && builtClasses.length > 0) {
          setDefaultClassId(builtClasses[0].id);
          // Also update stateRef immediately so the canvas loop has the correct value
          // before the next React render cycle flushes the useEffect sync.
          stateRef.current.classes = builtClasses;
          stateRef.current.defaultClassId = builtClasses[0].id;
        }
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
        } catch { }
      });
      createdUrlsRef.current.clear();
      mounted = false;
    };
  }, [projectId, datasetId, jobId]);

  /* -----------------------------
     ANNOTATIONS REF + autosave wiring
  ----------------------------- */
  const annotationsRef = useRef(annotations);
  // Guard: true while loadForImage is running — prevents autosave from firing
  // with stale/empty annotations before the async load completes.
  const isLoadingRef = useRef(false);

  useEffect(() => {
    annotationsRef.current = annotations;
    // Only schedule a save for genuine user edits, not for loads
    if (!isLoadingRef.current) {
      scheduleSave();
    }
  }, [annotations]);

  // load annotations for current image (DB preferred, fallback to FS active)
  useEffect(() => {
    const loadForImage = async () => {
      const img = images[currentIdx];
      if (!img) {
        setAnnotations([]);
        return;
      }

      // Cancel any pending autosave from the previous image before we start
      // loading — this prevents a stale save racing against the new load.
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }

      isLoadingRef.current = true;

      try {
        // First try DB (by imageId for reliability)
        const recById = await db.annotations
          .where("datasetId")
          .equals(dsId)
          .and((a) => a.imageId === img.id && !a.versionId)
          .first();

        // Also try by imageName for backwards-compatibility
        const rec = recById || await db.annotations
          .where("datasetId")
          .equals(dsId)
          .and((a) => a.imageName === img.name && !a.versionId)
          .first();

        let data = rec?.data ?? null;

        // If DB empty or data is empty, try reading FS active annotation file (by image id)
        if (!data || data.length === 0) {
          try {
            const dsFolder = dataset?.folderHandle || (project?.folderHandle ? await project.folderHandle.getDirectoryHandle(dataset.name).catch(() => null) : null);
            if (dsFolder) {
              const fileObj = await readAnnotationFile(dsFolder, img.id, null);
              if (fileObj?.annotations?.length > 0) data = fileObj.annotations;
            }
          } catch (err) {
            // ignore
          }
        }

        // normalize annotations: support both old (className) and new (classId) format
        const normalized = (data || []).map((a, index) => {
          // New format: has classId
          if (a.classId) {
            return {
              id: a.id || index.toString(),
              type: a.type,
              points: a.points,
              classId: a.classId,
              visible: a.visible !== false,
            };
          }
          // Old format: has className (pre-migration) — keep for display, mark unclassified
          return {
            id: a.id || index.toString(),
            type: a.type,
            points: a.points,
            classId: null,          // will show as "Unclassified" until migrated
            _legacyClassName: a.className || "class",
            _legacyColor: a.color || colorForLabel(a.className || "class"),
            visible: a.visible !== false,
          };
        });

        setAnnotations(normalized);
        setSelectedAnnId(null);

        // reset pan/zoom when image changes
        panRef.current = { x: 0, y: 0 };
        setZoom(1);
      } catch (e) {
        console.warn("Failed to load annotations:", e);
        setAnnotations([]);
      } finally {
        // Allow autosave again after load settles
        // Small delay so React can flush setAnnotations before the guard is released
        setTimeout(() => { isLoadingRef.current = false; }, 100);
      }
    };

    loadForImage();
  }, [images, currentIdx, dsId, dataset, project]);

  /* -----------------------------
     AUTOSAVE (debounced) — writes DB + filesystem
  ----------------------------- */

  // Helper to perform the actual save immediately
  const saveImageAnnotations = useCallback(async (img, currentAnnotations) => {
    if (!img) return;
    try {
      const payload = {
        datasetId: dsId,
        imageId: img.id,
        imageName: img.name,
        data: currentAnnotations,
        updatedAt: new Date().toISOString(),
        versionId: null, // active annotations (working copy)
      };

      // Upsert DB
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

      // Write filesystem active annotation file (imageId.json)
      const dsFolder = dataset?.folderHandle || (project?.folderHandle ? await project.folderHandle.getDirectoryHandle(dataset.name).catch(() => null) : null);
      if (dsFolder) {
        const filePayload = {
          imageId: img.id,
          imageName: img.name,
          datasetId: dsId,
          // Save annotations with classId (new format)
          // Legacy className/color fields are dropped on save
          annotations: currentAnnotations.map(a => ({
            id: a.id,
            type: a.type,
            points: a.points,
            classId: a.classId ?? null,
            visible: a.visible,
          })),
          updatedAt: new Date().toISOString(),
          versionId: null,
        };
        await writeAnnotationFile(dsFolder, img.id, filePayload, null);
      }
    } catch (err) {
      console.error("❌ Failed save:", err);
    }
  }, [dsId, dataset, project]);

  const scheduleSave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    autosaveTimer.current = setTimeout(() => {
      saveImageAnnotations(images[currentIdx], annotationsRef.current);
    }, 500);
  }, [currentIdx, images, saveImageAnnotations]);

  useEffect(() => {
    if (images.length === 0) return;

    return () => {
      // When image changes or component unmounts, flush any pending save immediately
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
        // Only save if not in the middle of a load
        if (!isLoadingRef.current) {
          saveImageAnnotations(images[currentIdx], annotationsRef.current);
        }
      }
    };
  }, [currentIdx, images, saveImageAnnotations]);

  /* -----------------------------
     Canvas drawing, rendering & interactions
     (unchanged logic mostly; omitted repeated comments for brevity)
  ----------------------------- */
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

    const normToCanvas = (nx, ny) => {
      const rect = imageRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const cx = (rect.left - container.getBoundingClientRect().left) + nx * rect.width;
      const cy = (rect.top - container.getBoundingClientRect().top) + ny * rect.height;
      return [cx, cy];
    };

    function drawHandle(ctx, x, y, color) {
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
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const rect = imageRef.current?.getBoundingClientRect();
      if (!rect) return;

      ctx.save();

      // draw existing annotations
      for (const a of annotations) {
        if (a.visible === false) continue;
        // Resolve class color: look up by classId in the classes dict
        const cls = stateRef.current.classes.find(c => c.id === a.classId);
        const stroke = cls?.color || a._legacyColor || "#888";
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

          const corners = [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2],
          ];
          corners.forEach((c, i) => {
            const [hx, hy] = normToCanvas(c[0], c[1]);
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

      // draw in-progress shapes
      const d = stateRef.current.draw;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      if (d.inProgress) {
        if (d.mode === "bbox" || (d.mode == null && tool === "bbox")) {
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
        } else if (d.mode === "poly" || (d.mode == null && tool === "poly")) {
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
            for (let i = 0; i < pts.length; i += 2) {
              const [vx, vy] = normToCanvas(pts[i], pts[i + 1]);
              drawHandle(ctx, vx, vy, "#fff");
            }
          }
        }
      }

      // crosshair/dot
      if (crosshair) {
        const m = stateRef.current.mouse;
        if (m && rect) {
          const cRect = container.getBoundingClientRect();
          const localX = m.cx - cRect.left;
          const localY = m.cy - cRect.top;
          // Double line for contrast (Black outer, White inner)
          ctx.beginPath();
          ctx.moveTo(localX, 0);
          ctx.lineTo(localX, localY - 20);
          ctx.moveTo(localX, localY + 20);
          ctx.lineTo(localX, canvas.height);
          ctx.moveTo(0, localY);
          ctx.lineTo(localX - 20, localY);
          ctx.moveTo(localX + 20, localY);
          ctx.lineTo(canvas.width, localY);

          ctx.lineCap = "square";

          // Black outline
          ctx.strokeStyle = "black";
          ctx.lineWidth = 4;
          ctx.stroke();

          // White inner
          ctx.strokeStyle = "white";
          ctx.lineWidth = 2;
          ctx.stroke();

          // Dot with contrast
          ctx.beginPath();
          ctx.arc(localX, localY, 3, 0, Math.PI * 2);
          ctx.fillStyle = "white";
          ctx.fill();
          ctx.strokeStyle = "black";
          ctx.lineWidth = 1;
          ctx.stroke();

          // Current Drawing Label
          // Current Drawing Label
          const currentClasses = stateRef.current.classes;
          const currentDefaultId = stateRef.current.defaultClassId;
          const defClass = currentClasses.find(c => c.id === currentDefaultId) || currentClasses[0];
          const activeClass = defClass?.name;

          if (activeClass) {
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "bottom";

            // Text Halo for visibility
            ctx.strokeStyle = "black";
            ctx.lineWidth = 3;
            ctx.strokeText(activeClass, localX + 10, localY - 10);

            ctx.fillStyle = "white";
            ctx.fillText(activeClass, localX + 10, localY - 10);
          }

          ctx.restore();
        }
      } else {
        const m = stateRef.current.mouse;
        if (m && rect) {
          const cRect = container.getBoundingClientRect();
          const localX = m.cx - cRect.left;
          const localY = m.cy - cRect.top;
          ctx.save();

          // High contrast dot (White fill, Black stroke)
          ctx.beginPath();
          ctx.arc(localX, localY, 3, 0, Math.PI * 2);
          ctx.fillStyle = "white";
          ctx.fill();
          ctx.strokeStyle = "black";
          ctx.lineWidth = 1;
          ctx.stroke();

          // Current Drawing Label (Show even if crosshair is off)
          // Current Drawing Label (Show even if crosshair is off)
          const currentClasses = stateRef.current.classes;
          const currentDefaultId = stateRef.current.defaultClassId;
          const defClass = currentClasses.find(c => c.id === currentDefaultId) || currentClasses[0];
          const activeClass = defClass?.name;

          if (activeClass) {
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "bottom";

            // Text Halo for visibility
            ctx.strokeStyle = "black";
            ctx.lineWidth = 3;
            ctx.strokeText(activeClass, localX + 10, localY - 10);

            ctx.fillStyle = "white";
            ctx.fillText(activeClass, localX + 10, localY - 10);
          }

          ctx.restore();
        }
      }

      ctx.restore();
    };

    let rafId = requestAnimationFrame(function loop() {
      draw();
      rafId = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [annotations, selectedAnnId, crosshair, zoom, tool, images, currentIdx, classes, defaultClassId]);

  /* -----------------------------
     Pointer event handlers: drawing / editing / pan / hover
     (kept behavior consistent with your original implementation)
  ----------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.style.cursor = "none";

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

    const hitTestHandle = (clientX, clientY) => {
      const rect = imageClientRect();
      if (!rect) return { type: "none" };
      const cRect = container.getBoundingClientRect();
      const localX = clientX - cRect.left;
      const localY = clientY - cRect.top;

      for (let k = annotations.length - 1; k >= 0; k--) {
        const a = annotations[k];
        if (a.visible === false) continue;
        if (a.type === "bbox") {
          const [x1, y1, x2, y2] = a.points;
          const [cx1, cy1] = normalizedToClient(x1, y1);
          const [cx2, cy2] = normalizedToClient(x2, y2);
          const left = Math.min(cx1, cx2), top = Math.min(cy1, cy2);
          const right = Math.max(cx1, cx2), bottom = Math.max(cy1, cy2);
          const cLeft = left - cRect.left;
          const cTop = top - cRect.top;
          const cRight = right - cRect.left;
          const cBottom = bottom - cRect.top;
          const handleR = 12;
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
          if (localX >= cLeft && localX <= cRight && localY >= cTop && localY <= cBottom) {
            return { type: "inside", annId: a.id };
          }
        } else if (a.type === "poly") {
          for (let i = 0; i < a.points.length; i += 2) {
            const [vx, vy] = normalizedToClient(a.points[i], a.points[i + 1]);
            const lx = vx - container.getBoundingClientRect().left;
            const ly = vy - container.getBoundingClientRect().top;
            const dx = localX - lx;
            const dy = localY - ly;
            if (dx * dx + dy * dy <= 12 * 12) return { type: "vertex", annId: a.id, index: i / 2 };
          }

          // Check edges for adding points
          for (let i = 0; i < a.points.length; i += 2) {
            const p1 = [a.points[i], a.points[i + 1]];
            const p2 = [a.points[(i + 2) % a.points.length], a.points[(i + 3) % a.points.length]];
            const [x1, y1] = normalizedToClient(p1[0], p1[1]);
            const [x2, y2] = normalizedToClient(p2[0], p2[1]);

            // Check distance to segment in client coords
            const dist = distToSegment([clientX, clientY], [x1, y1], [x2, y2]);
            if (dist < 8) return { type: "edge", annId: a.id, index: i / 2 };
          }

          const rect = imageClientRect();
          if (!rect) continue;
          const nx = (localX - (rect.left - container.getBoundingClientRect().left)) / rect.width;
          const ny = (localY - (rect.top - container.getBoundingClientRect().top)) / rect.height;
          if (pointInPoly(nx, ny, a.points)) return { type: "inside", annId: a.id };
        }
      }
      return { type: "none" };
    };

    const distToSegment = (p, v, w) => {
      const l2 = (w[0] - v[0]) ** 2 + (w[1] - v[1]) ** 2;
      if (l2 === 0) return Math.hypot(p[0] - v[0], p[1] - v[1]);
      let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p[0] - (v[0] + t * (w[0] - v[0])), p[1] - (v[1] + t * (w[1] - v[1])));
    };

    const pointInPoly = (x, y, pts) => {
      let inside = false;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i], yi = pts[i + 1];
        const xj = pts[j], yj = pts[j + 1];
        const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const updateHover = (clientX, clientY) => {
      const hit = hitTestHandle(clientX, clientY);
      if (hit.type === "corner" || hit.type === "vertex" || hit.type === "edge") {
        const hv = { type: hit.type, annId: hit.annId, index: hit.index };
        stateRef.current.hover = hv;
      } else {
        stateRef.current.hover = { type: "none", annId: null, index: null };
      }
    };

    const startPan = (e) => {
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: panRef.current.x,
        startY: panRef.current.y,
      };
    };
    const doPan = (e) => {
      if (!panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      panRef.current.x = panStartRef.current.startX + dx;
      panRef.current.y = panStartRef.current.startY + dy;
      const img = imageRef.current;
      if (img) {
        img.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoom})`;
        img.style.transition = "transform 0s";
        img.style.transformOrigin = "center center";
      }
    };
    const endPan = () => {
      panStartRef.current = null;
    };

    const onPointerDown = (e) => {
      if (e.button && e.button !== 0) return;
      stateRef.current.mouse = { cx: e.clientX, cy: e.clientY };

      if (handMode || spaceDownRef.current) {
        startPan(e);
        return;
      }

      if (dataset?.type === "classify") return;

      const imgRect = imageClientRect();
      if (!imgRect) return;
      if (e.clientX < imgRect.left || e.clientX > imgRect.right || e.clientY < imgRect.top || e.clientY > imgRect.bottom) return;

      updateHover(e.clientX, e.clientY);
      const hit = hitTestHandle(e.clientX, e.clientY);

      if (hit.type === "corner" || hit.type === "vertex" || hit.type === "inside" || hit.type === "edge") {
        const ann = annotations.find((a) => a.id === hit.annId);
        if (!ann) return;

        // Remove vertex (Alt + Click on vertex)
        if (hit.type === "vertex" && ann.type === "poly" && e.altKey) {
          if (ann.points.length > 6) { // Minimum 3 points (6 coords)
            const idx = hit.index;
            const newPts = [...ann.points];
            newPts.splice(idx * 2, 2);
            setAnnotations(p => p.map(a => a.id === ann.id ? { ...a, points: newPts } : a));
          }
          return;
        }

        // Add vertex (Click on edge)
        if (hit.type === "edge" && ann.type === "poly") {
          const idx = hit.index; // insert after this index
          const norm = clientToNormalized(e.clientX, e.clientY);
          if (norm) {
            const newPts = [...ann.points];
            // insert after index (2 coords per point)
            newPts.splice((idx + 1) * 2, 0, norm[0], norm[1]);
            setAnnotations(p => p.map(a => a.id === ann.id ? { ...a, points: newPts } : a));

            // Immediately start dragging the new vertex
            setSelectedAnnId(ann.id);
            stateRef.current.mode = "editing";
            stateRef.current.edit.annId = ann.id;
            stateRef.current.edit.type = "vertex";
            stateRef.current.edit.index = idx + 1;
          }
          return;
        }

        setSelectedAnnId(ann.id);
        stateRef.current.mode = "editing";
        stateRef.current.edit.annId = ann.id;
        if (hit.type === "corner") {
          stateRef.current.edit.type = "corner";
          stateRef.current.edit.index = hit.index;
        } else if (hit.type === "vertex") {
          stateRef.current.edit.type = "vertex";
          stateRef.current.edit.index = hit.index;
        } else if (hit.type === "inside" && ann.type === "bbox") {
          stateRef.current.edit.type = "move";
          stateRef.current.edit.index = null;
          const [x1, y1, x2, y2] = ann.points;
          const cx = (x1 + x2) / 2;
          const cy = (y1 + y2) / 2;
          const [centx, centy] = normalizedToClient(cx, cy);
          stateRef.current.edit.offset = [e.clientX - centx, e.clientY - centy];
        }
      } else {
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
            stateRef.current.draw.currentPoly.push(norm[0], norm[1]);
          }
        }
      }
    };

    const onPointerMove = (e) => {
      stateRef.current.mouse = { cx: e.clientX, cy: e.clientY };
      updateHover(e.clientX, e.clientY);

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
        const norm = clientToNormalized(e.clientX, e.clientY);
        if (!norm) return;
        if (edit.type === "move") {
          const [offsetX, offsetY] = edit.offset || [0, 0];
          let newCenterClientX = e.clientX - offsetX;
          let newCenterClientY = e.clientY - offsetY;
          const rect = imageClientRect();
          const newCenterNx = (newCenterClientX - rect.left) / rect.width;
          const newCenterNy = (newCenterClientY - rect.top) / rect.height;
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
            let cx = 0, cy = 0;
            for (let i = 0; i < pts.length; i += 2) {
              cx += pts[i];
              cy += pts[i + 1];
            }
            cx /= (pts.length / 2);
            cy /= (pts.length / 2);
            const dx = newCenterNx - cx;
            const dy = newCenterNy - cy;
            const newPts = pts.map((v, i) => (i % 2 === 0 ? Math.min(1, Math.max(0, v + dx)) : Math.min(1, Math.max(0, v + dy))));
            setAnnotations((p) => p.map((it) => (it.id === ann.id ? { ...it, points: newPts } : it)));
          }
        } else if (edit.type === "corner" && ann.type === "bbox") {
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
          const newPts = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map((v) => Math.min(1, Math.max(0, v)));
          setAnnotations((p) => p.map((it) => (it.id === ann.id ? { ...it, points: newPts } : it)));
        } else if (edit.type === "vertex" && ann.type === "poly") {
          const idx = edit.index;
          const pts = ann.points.slice();
          pts[idx * 2] = norm[0];
          pts[idx * 2 + 1] = norm[1];
          setAnnotations((p) => p.map((it) => (it.id === ann.id ? { ...it, points: pts } : it)));
        }
      }
    };

    const onPointerUp = (e) => {
      if (panStartRef.current) {
        endPan();
        return;
      }

      if (stateRef.current.mode === "drawing") {
        const d = stateRef.current.draw;
        if (d.inProgress) {
          if (d.mode === "bbox") {
            if (d.start && d.current) {
              const [x1, y1] = d.start;
              const [x2, y2] = d.current;
              const bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
              if (Math.abs(bbox[2] - bbox[0]) > 0.002 && Math.abs(bbox[3] - bbox[1]) > 0.002) {
                const currentClasses = stateRef.current.classes;
                const currentDefaultId = stateRef.current.defaultClassId;
                const defClass = currentClasses.find(c => c.id === currentDefaultId) || currentClasses[0];
                const ann = {
                  id: uid(),
                  type: "bbox",
                  points: bbox,
                  classId: defClass?.id ?? null,
                  visible: true,
                };
                setAnnotations((p) => [...p, ann]);
                setSelectedAnnId(ann.id); // Auto-select new annotation
              }
            }
          }
        }
      }

      if (stateRef.current.draw.inProgress && stateRef.current.draw.mode === "bbox") {
        stateRef.current.draw.inProgress = false;
        stateRef.current.draw.start = null;
        stateRef.current.draw.current = null;
      }
      if (stateRef.current.mode === "editing") {
        stateRef.current.edit = { annId: null, type: null, index: null, offset: null };
        stateRef.current.mode = null;
      } else if (stateRef.current.mode === "drawing") {
        if (stateRef.current.draw.mode === "bbox") {
          stateRef.current.mode = null;
        }
      }
    };

    const onContext = (e) => {
      if (dataset?.type === "classify") return;
      const d = stateRef.current.draw;
      if (d.inProgress && d.mode === "poly") {
        e.preventDefault();
        const pts = d.currentPoly ?? [];
        if (pts.length >= 6) {
          const currentClasses = stateRef.current.classes;
          const currentDefaultId = stateRef.current.defaultClassId;
          const defClass = currentClasses.find(c => c.id === currentDefaultId) || currentClasses[0];
          const ann = {
            id: uid(),
            type: "poly",
            points: pts,
            classId: defClass?.id ?? null,
            visible: true,
          };
          setAnnotations((p) => [...p, ann]);
          setSelectedAnnId(ann.id); // Auto-select new annotation
        }
        d.inProgress = false;
        d.currentPoly = [];
        d.current = null;
        stateRef.current.mode = null;
      }
    };

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const zoomFactor = delta > 0 ? 1.08 : 0.92;
        const newZoom = Math.min(4, Math.max(0.25, zoom * zoomFactor));
        const rect = imageClientRect();
        if (!rect) {
          setZoom(newZoom);
          return;
        }
        const cursorX = e.clientX;
        const cursorY = e.clientY;
        const nx = (cursorX - rect.left) / rect.width;
        const ny = (cursorY - rect.top) / rect.height;
        const img = imageRef.current;
        const prevScale = zoom;
        const nextScale = newZoom;
        const imgCenterX = rect.left + rect.width / 2;
        const imgCenterY = rect.top + rect.height / 2;
        const dx = cursorX - imgCenterX;
        const dy = cursorY - imgCenterY;
        const ratio = (nextScale / prevScale) - 1;
        panRef.current.x -= dx * ratio;
        panRef.current.y -= dy * ratio;
        setZoom(newZoom);
        if (img) {
          img.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${newZoom})`;
          img.style.transformOrigin = "center center";
        }
      }
    };

    const onKey = (ev) => {
      if (ev.code === "Space") {
        if (ev.type === "keydown") {
          spaceDownRef.current = true;
        }
      }

      const activeElement = document.activeElement;
      const isInputFocused = ["INPUT", "SELECT", "TEXTAREA"].includes(activeElement.tagName) || activeElement.isContentEditable;

      if (!isInputFocused) {
        if (dataset?.type === "classify") {
          const num = parseInt(ev.key);
          if (!isNaN(num) && num > 0 && num <= classes.length) {
            const cls = classes[num - 1];
            if (cls) setClassification(cls.id);
          }
        }
        if (ev.key === "b" || ev.key === "B") setTool("bbox");
        if (ev.key === "p" || ev.key === "P") setTool("poly");
        if (ev.key === "a" || ev.key === "A" || ev.key === "ArrowLeft") {
          handlePrevImage();
        }
        if (ev.key === "d" || ev.key === "D" || ev.key === "ArrowRight") {
          handleNextImage();
        }
        if ((ev.key === "Delete" || ev.key === "Backspace") && ev.type === "keydown") {
          if (selectedAnnId) deleteAnnotation(selectedAnnId);
        }
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.key === "z") {
        ev.preventDefault();
        if (ev.shiftKey) {
          if (historyIndex < history.length - 1) {
            setHistoryIndex(i => i + 1);
            setAnnotations(history[historyIndex + 1]);
          }
        } else {
          if (historyIndex > 0) {
            setHistoryIndex(i => i - 1);
            setAnnotations(history[historyIndex - 1]);
          }
        }
      }

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

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
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

            // write annotation file
            const dsFolder = dataset?.folderHandle || (project?.folderHandle ? await project.folderHandle.getDirectoryHandle(dataset.name).catch(() => null) : null);
            if (dsFolder) {
              const filePayload = {
                imageId: img.id,
                imageName: img.name,
                datasetId: dsId,
                annotations,
                updatedAt: new Date().toISOString(),
                versionId: null,
              };
              await writeAnnotationFile(dsFolder, img.id, filePayload, null);
            }

            alert("Saved");
          } catch (err) {
            console.error("Save failed:", err);
            alert("Save failed. See console.");
          }
        })();
      }

    };

    const onKeyUp = (ev) => {
      if (ev.code === "Space") spaceDownRef.current = false;
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    container.addEventListener("contextmenu", onContext);
    container.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);

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
  }, [annotations, classes, currentIdx, images, tool, dsId, selectedAnnId, handMode, zoom, defaultClassId]);

  /* -----------------------------
     Classes & annotation list helpers
  ----------------------------- */
  const addClass = async () => {
    const name = newClassName.trim();
    if (!name) return;
    if (classes.some((c) => c.name === name)) {
      setNewClassName("");
      return;
    }
    const c = { id: uid(), name, color: colorForLabel(name) };
    setClasses((p) => [c, ...p]);
    // Sync stateRef immediately
    stateRef.current.classes = [c, ...classes];
    setDefaultClassId((prev) => prev ?? c.id);
    stateRef.current.defaultClassId = stateRef.current.defaultClassId ?? c.id;
    setNewClassName("");

    // Persist to dataset.json (Option A: always write new classes permanently)
    try {
      const dsFolder = dataset?.folderHandle ||
        (project?.folderHandle ? await project.folderHandle.getDirectoryHandle(dataset.name).catch(() => null) : null);
      if (dsFolder) await addDatasetClass(dsFolder, c);
    } catch (e) {
      console.warn("Failed to persist new class to dataset.json:", e);
    }

    // Auto-assign to any unclassified annotations
    setAnnotations((prev) =>
      prev.map((a) => {
        if (!a.classId) return { ...a, classId: c.id };
        return a;
      })
    );
  };

  const updateAnnotationClass = (annId, classId) => {
    updateAnnotations((p) => p.map((a) => (a.id === annId ? { ...a, classId } : a)));
  };

  const deleteAnnotation = (annId) => updateAnnotations((p) => p.filter((a) => a.id !== annId));

  const toggleAnnotationVisible = (annId) => {
    updateAnnotations((p) => p.map((a) => (a.id === annId ? { ...a, visible: !a.visible } : a)));
  };

  const addToHistory = (newAnnotations) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newAnnotations]);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const updateAnnotations = (updater) => {
    setAnnotations((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      addToHistory(next);
      return next;
    });
  };

  const setClassification = (classId) => {
    const cls = classes.find(c => c.id === classId);
    if (!cls) return;
    const ann = {
      id: "image-class",
      type: "class",
      classId: cls.id,
      name: cls.name,
      color: cls.color
    };
    updateAnnotations([ann]);
  };

  const handleNextImage = () => {
    const isClassify = dataset?.type === "classify";
    const unlabelled = isClassify ? annotations.length === 0 : annotations.some((a) => !a.classId);
    if (unlabelled) {
      openModal({
        type: "error",
        title: isClassify ? "Image Not Classified" : "Unclassified Annotations",
        message: isClassify ? "Please select a class for this image." : "Please assign a class to all annotations before moving to the next image.",
      });
      return;
    }

    if (currentIdx < images.length - 1) {
      setCurrentIdx((i) => Math.min(images.length - 1, i + 1));
    }
  };

  const handlePrevImage = () => {
    if (currentIdx > 0) {
      setCurrentIdx((i) => Math.max(0, i - 1));
    }
  };

  /* -----------------------------
     Delete IMAGE flow (AppModal confirm, DB + FS cleanup)
  ----------------------------- */
  const confirmDeleteImage = (img) => {
    if (!img) return;
    openModal({
      type: "confirm",
      title: "Delete Image?",
      message:
        `This will permanently delete the image "${img.name}" from disk, remove its annotations and remove it from any jobs.\n\nThis cannot be undone. Continue?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          setLoading(true);

          // 1) Delete file from disk (images/raw/<name>)
          const dsFolder = dataset?.folderHandle || (project?.folderHandle ? await project.folderHandle.getDirectoryHandle(dataset.name).catch(() => null) : null);
          if (dsFolder) {
            await deleteImageFiles(dsFolder, img.id, img.name);
            await deleteAnnotationFile(dsFolder, img.id, img.name);
            // update job files and DB job.imageIds
            await updateJobFileAfterImageDeletion(dsFolder, img.id);
            // update dataset.json job counts
            await updateDatasetJsonJobCounts(dsFolder);
          }

          // 2) Remove annotations from DB
          try {
            await db.annotations.where("datasetId").equals(dsId).and(a => a.imageName === img.name).delete();
          } catch { }

          // 3) Remove image row from DB
          await db.images.delete(img.id);

          // 4) Remove image id from any db.jobs.imageIds arrays
          try {
            const jobsContaining = await db.jobs.filter(j => (j.imageIds || []).includes(img.id)).toArray();
            for (const jb of jobsContaining) {
              const newIds = (jb.imageIds || []).filter(x => x !== img.id);
              await db.jobs.update(jb.id, { imageIds: newIds });
            }
          } catch { }

          // 5) Update UI state
          setImages((imgs) => imgs.filter((i, idx) => i.id !== img.id));
          setCurrentIdx((i) => Math.max(0, Math.min(i, images.length - 2)));

          setLoading(false);
          return true;
        } catch (err) {
          console.error("Delete image failed:", err);
          openModal({ type: "error", title: "Delete Failed", message: "Failed to delete image. See console." });
          setLoading(false);
          return false;
        }
      },
      autoClose: true,
    });
  };

  /* -----------------------------
     Shortcuts modal component
  ----------------------------- */
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
            <tr><td><kbd>Right Click</kbd></td><td>Complete Polygon</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Click</kbd></td><td>Add point to Polygon</td></tr>
            <tr><td><kbd>Alt</kbd>+<kbd>Click</kbd></td><td>Remove point from Polygon</td></tr>
          </tbody>
        </table>
      </Modal.Body>
    </Modal>
  );

  /* -----------------------------
     UI helpers & render
  ----------------------------- */
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
      <AppModal {...modal} show={modal.show} onClose={closeModal} />

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
          {dataset?.type !== "classify" && (
            <>
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
            </>
          )}

          <Button variant="outline-secondary" size="sm" onClick={() => {
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

          <Button
            variant={handMode ? "primary" : "outline-secondary"}
            size="sm"
            onClick={() => setHandMode((h) => !h)}
            title="Toggle hand tool (or hold Space)"
          >
            Hand
          </Button>

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
              const img = images[currentIdx];
              if (!img) return alert("No image");
              try {
                const payload = {
                  datasetId: dsId,
                  imageId: img.id,
                  imageName: img.name,
                  data: annotations,
                  updatedAt: new Date().toISOString(),
                };
                const existing = await db.annotations
                  .where("datasetId")
                  .equals(dsId)
                  .and((a) => a.imageName === img.name)
                  .first();
                if (existing) await db.annotations.update(existing.id, payload);
                else {
                  payload.id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
                  await db.annotations.add(payload);
                }

                // write annotation file
                const dsFolder = dataset?.folderHandle || (project?.folderHandle ? await project.folderHandle.getDirectoryHandle(dataset.name).catch(() => null) : null);
                if (dsFolder) {
                  const filePayload = {
                    imageId: img.id,
                    imageName: img.name,
                    datasetId: dsId,
                    annotations,
                    updatedAt: new Date().toISOString(),
                    versionId: null,
                  };
                  await writeAnnotationFile(dsFolder, img.id, filePayload, null);
                }

                alert("Saved");
              } catch (err) {
                console.error("Save failed:", err);
                alert("Save failed - see console");
              }
            }}
          >
            <Save size={14} /> Save
          </Button>

          <Button
            variant="danger"
            size="sm"
            onClick={() => confirmDeleteImage(currentImage)}
            title="Delete current image"
          >
            <Trash2 size={14} /> Delete Image
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, height: "calc(100% - 60px)" }}>
        <div className="image-annotation-left-panel" style={{ position: "relative", height: "100%" }}>
          <div style={{
            position: "absolute",
            top: 10,
            left: leftPanelOpen ? 310 : 10,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            background: themeColors.toolbarBg,
            borderRadius: 6,
            border: `1px solid ${themeColors.border}`
          }}
            onClick={() => handleLeftPanelToggle(!leftPanelOpen)}>
            images <ImageIcon />
          </div>

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
              <div className="d-flex justify-content-between align-items-center mb-2">
                <b>Images</b>
                <Badge bg="secondary">{images.length}</Badge>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {images.map((img, i) => (
                  <div
                    key={img.id}
                    onClick={() => setCurrentIdx(i)}
                    style={{
                      cursor: "pointer",
                      border: i === currentIdx ? `2px solid ${themeColors.accent ?? "#4f46e5"}` : `1px solid ${themeColors.border}`,
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
                          console.warn("Thumbnail failed to load in sidebar:", img.url);
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
              <div className="annotation-stage" style={{ transition: "transform 0.05s linear" }}>
                  <img
                    ref={imageRef}
                    src={currentImage.url}
                    alt={currentImage.name}
                    style={{
                    maxWidth: `100%`,
                    maxHeight: `85vh`,
                    objectFit: "contain",
                      display: "block",
                    transform: `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoom})`,
                    transformOrigin: "center center",
                      userSelect: "none",
                    }}
                    onError={(e) => {
                      console.warn(`Full image load failed in Annotate view for image: ${currentImage.name} (URL: ${currentImage.url})`);
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
                      pointerEvents: "none",
                    }}
                  />
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
                    <Button size="sm" className="arrow-button" onClick={handlePrevImage}>
                      <ChevronLeft size={16} />
                    </Button>
                  </div>

                  <div style={{ textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {currentImage.name}
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="sm" className="arrow-button" onClick={handleNextImage}>
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

        <div className="image-annotation-right-panel" style={{ position: "relative", height: "100%" }}>
          <div style={{
            position: "absolute",
            top: 10,
            right: rightPanelOpen ? 310 : 10,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            background: themeColors.toolbarBg,
            borderRadius: 6,
            border: `1px solid ${themeColors.border}`
          }}
            onClick={() => handleRightPanelToggle(!rightPanelOpen)}>
            labels <TagIcon />
          </div>

          {rightPanelOpen && (
            <div
              style={{
                width: 300,
                height: "100%",
                borderLeft: `1px solid ${themeColors.border}`,
                background: themeColors.sidebarBg,
                padding: 8,
                display: "flex",
                flexDirection: "column",
                transition: "width 0.2s",
                position: "relative",
              }}
            >
              {dataset?.type === "classify" ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ marginBottom: 8, flexShrink: 0 }}>
                    <h6 style={{ marginBottom: 12 }}>Image Classification</h6>
                    {classes.length === 0 ? (
                      <div className="text-center p-4" style={{ opacity: 0.5 }}>
                        No classes defined.
                      </div>
                    ) : (
                      <div className="d-flex flex-column gap-2 overflow-auto mb-3" style={{ maxHeight: "40vh" }}>
                        {classes.map((cls, idx) => {
                          const isSelected = annotations.some(a => a.type === 'class' && a.classId === cls.id);
                          return (
                            <Button
                              key={cls.id}
                              variant={isSelected ? "primary" : "outline-secondary"}
                              className="w-100 text-start d-flex align-items-center justify-content-between p-2"
                              style={{ 
                                background: isSelected ? cls.color : 'transparent',
                                borderColor: isSelected ? cls.color : themeColors.border,
                                color: isSelected ? '#fff' : themeColors.text
                              }}
                              onClick={() => setClassification(cls.id)}
                            >
                              <div className="d-flex align-items-center overflow-hidden">
                                <div className="me-2" style={{ width: 12, height: 12, borderRadius: '2px', background: isSelected ? '#fff' : cls.color }}></div>
                                <span className="text-truncate">{cls.name}</span>
                              </div>
                              <Badge bg={isSelected ? "light" : "secondary"} text={isSelected ? "dark" : "light"}>
                                {idx < 9 ? idx + 1 : ""}
                              </Badge>
                            </Button>
                          );
                        })}
                      </div>
                    )}
                    
                    <hr />
                    <h6 className="mt-2 text-muted" style={{ fontSize: "0.85rem" }}>Add Class</h6>
                    <InputGroup>
                      <Form.Control
                        ref={classInputRef}
                        size="sm"
                        placeholder="Class name..."
                        value={newClassName}
                        onChange={(e) => setNewClassName(e.target.value)}
                        onFocus={() => { stateRef.current.isInputFocused = true; }}
                        onBlur={() => { stateRef.current.isInputFocused = false; }}
                        onKeyDown={(e) => { if (e.key === "Enter") addClass(); }}
                      />
                      <Button variant="primary" size="sm" onClick={addClass}>Add</Button>
                    </InputGroup>
                  </div>
                </div>
              ) : (
                <>
                  {/* 1. Classes Section (Fixed at Top) */}
                  <div style={{ marginBottom: 8, flexShrink: 0 }}>
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

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 150, overflowY: "auto" }}>
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
                                if (selectedAnnId) updateAnnotationClass(selectedAnnId, c.id);
                              }}
                            >
                              Assign
                            </Button>
                            <Button
                              size="sm"
                              variant={defaultClassId === c.id ? "primary" : "outline-secondary"}
                              onClick={() => setDefaultClassId(c.id)}
                              title="Set as default class for new annotations"
                            >
                              {defaultClassId === c.id ? "Default" : "Set Default"}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <hr />

                  {/* 2. Annotations List (Scrollable) */}
                  <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <h6 style={{ margin: 0 }}>Annotations</h6>
                      <small style={{ color: themeColors.subtleText }}>{annotations.length}</small>
                    </div>

                    <div style={{ width: '100%' }}>
                      {annotations.length === 0 ? (
                        <div style={{ color: themeColors.subtleText }}>No annotations yet.</div>
                      ) : (
                        <ListGroup>
                          {annotations.map((a) => (
                            <ListGroup.Item
                              key={a.id}
                              active={a.id === selectedAnnId}
                              onClick={() => setSelectedAnnId(a.id)}
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                                justifyContent: "space-between",
                                color: themeColors.text,
                                backgroundColor: themeColors.cardBg,
                                border: `1px solid ${themeColors.border}`,
                              }}
                            >
                              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                                {(() => {
                                  const cls = classes.find(c => c.id === a.classId);
                                  return <div style={{ width: 14, height: 14, background: cls?.color || a._legacyColor || "#888", borderRadius: 3, flexShrink: 0 }} />;
                                })()}
                                <div style={{ flex: 1 }}>
                                  <Form.Select
                                    size="sm"
                                    value={a.classId || ""}
                                    onChange={(e) => updateAnnotationClass(a.id, e.target.value)}
                                  >
                                    {!a.classId && (
                                      <option value="" disabled>— Unclassified —</option>
                                    )}
                                    {classes.map((c) => (
                                      <option key={c.id} value={c.id}>
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
                  </div>
                </>
              )}

              {/* 3. Footer Info (Optional, removed buttons) */}
              <div style={{ marginTop: 8, borderTop: `1px solid ${themeColors.border}`, paddingTop: 8, textAlign: "center", color: themeColors.subtleText }}>
                Image {currentIdx + 1} of {images.length}
              </div>
            </div>
          )}
        </div>
      </div>

      <ShortcutsModal />
    </div>
  );
}
