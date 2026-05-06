import React, { useEffect, useState, useRef, useCallback } from "react";
import { Card, Row, Col, Button, Form, Spinner, Dropdown, InputGroup, FormControl } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import { CheckSquare, Square, Tag, X, ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "../../utils/db";
import { useTheme } from "../../components/ThemeContext";
import AppModal from "../../components/AppModal";
import LazyThumbnail from "../../components/LazyThumbnail";
import {
  readDatasetTags,
  readImageMeta,
  updateImageMetaTags,
  readDatasetClasses,
  scanImageMetaFromDataset,
} from "../../utils/fs";

export default function DatasetGalleryPage({ datasetId }) {
  const { projectId } = useParams();
  const { themeColors } = useTheme();
  const navigate = useNavigate();

  const [images, setImages]               = useState([]);
  const [classes, setClasses]             = useState([]);   // classId list for filter (null = unlabeled)
  const [datasetClasses, setDatasetClasses] = useState([]); // full class objects {id, name, color}
  const [datasetTags, setDatasetTags]     = useState([]);   // tag dict from dataset.json
  const [imageTagsMap, setImageTagsMap]   = useState({});   // { [imageId]: tagId[] }
  const [selectedClasses, setSelectedClasses] = useState(new Set());
  const [selectedTags, setSelectedTags]   = useState(new Set());
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [searchQuery, setSearchQuery]     = useState("");
  const [loading, setLoading]             = useState(true);

  // Pagination & Lazy Loading
  const [rawDirHandle, setRawDirHandle]   = useState(null);
  const [thumbsDirHandle, setThumbsDirHandle] = useState(null);
  const [currentPage, setCurrentPage]     = useState(1);
  const ITEMS_PER_PAGE = 50;

  // Tag picker popover: which imageId is open
  const [tagPickerOpen, setTagPickerOpen] = useState(null);
  const tagPickerRef = useRef(null);

  // dataset/project folder handles kept for tag writes
  const dsFolderRef = useRef(null);

  // Map<imageId, Set<classId>> for filtering
  const [imageLabelsMap, setImageLabelsMap] = useState(new Map());

  const [modal, setModal] = useState({ show: false });
  const openModal = (data) => setModal({ ...modal, ...data, show: true });
  const closeModal = () => setModal((prev) => ({ ...prev, show: false, onConfirm: null }));

  const createdUrlsRef = useRef(new Set());

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const [ds, proj] = await Promise.all([
          db.datasets.get(datasetId),
          db.projects.get(projectId),
        ]);
        if (!ds) return;

        const dsFolder = ds.folderHandle ||
          (proj?.folderHandle ? await proj.folderHandle.getDirectoryHandle(ds.name).catch(() => null) : null);
        dsFolderRef.current = dsFolder;

        // ── Step 1: Load classes from dataset.json (source of truth) ─────────
        // Don't derive class names from annotation records — that table may be
        // empty after a rebuild. The class dictionary always lives in dataset.json.
        let datasetClasses = [];
        if (dsFolder) {
          try { datasetClasses = await readDatasetClasses(dsFolder); } catch { }
        }
        if (mounted) {
          setDatasetClasses(datasetClasses);
          // Build display names list + include an "Unlabeled" sentinel (null)
          setClasses([null, ...datasetClasses.map(c => c.id)]);
        }

        // ── Step 2: Load tags dictionary from dataset.json ────────────────────
        const tags = dsFolder ? await readDatasetTags(dsFolder) : [];
        if (mounted) setDatasetTags(tags);

        // ── Step 3: Sync images from FS (images/meta/) → db.images ───────────
        // CRITICAL: verify the raw file actually exists before upserting.
        // If we sync a meta file whose raw image was deleted, the image will
        // ghost-resurrect in the gallery on next load.
        let rawDirHandle = null;
        let thumbsDirHandle = null;
        if (dsFolder) {
          try {
            const imagesDir = await dsFolder.getDirectoryHandle("images");
            rawDirHandle = await imagesDir.getDirectoryHandle("raw");
            thumbsDirHandle = await imagesDir.getDirectoryHandle("thumbs", { create: true });
          } catch { /* no images folder yet */ }

          if (rawDirHandle) {
            try {
              // 1. Preload all file names from the raw directory for instant synchronous checks O(1)
              const rawFileNames = new Set();
              for await (const entry of rawDirHandle.values()) {
                rawFileNames.add(entry.name);
              }

              const fsMetas = await scanImageMetaFromDataset(dsFolder);
              for (const meta of fsMetas) {
                // Verify raw file exists — if not, the image was deleted
                if (!rawFileNames.has(meta.name)) continue;
                
                const existing = await db.images.get(meta.id);
                if (!existing) await db.images.put({ ...meta, datasetId });
              }
            } catch (syncErr) {
              console.warn("[gallery] FS image sync failed:", syncErr);
            }
          }
        }

        // ── Step 4: Load images from DB ───────────────────────────────────────
        const dbImgs = await db.images.where("datasetId").equals(datasetId).toArray();

        // Find completed jobs
        const dbJobs = await db.jobs.where("datasetId").equals(datasetId).toArray();
        const completedJobIds = new Set(
          dbJobs.filter(j => j.status === "completed").map(j => j.id)
        );

        // Exclude images that are still in the temp upload staging area
        // (those belong on the Upload page, not the gallery)
        const tempIds = new Set(
          (await db.tempImages.where("datasetId").equals(datasetId).toArray()).map(t => t.id)
        );

        // Deduplicate by id and ONLY show images in COMPLETED jobs
        const seen = new Set();
        const imgs = dbImgs.filter(img => {
          if (tempIds.has(img.id)) return false;
          if (!completedJobIds.has(img.jobId)) return false;
          if (seen.has(img.id)) return false;
          seen.add(img.id);
          return true;
        });

        // We will need the Set of file names again for validation
        const finalRawFileNames = new Set();
        if (rawDirHandle) {
          for await (const entry of rawDirHandle.values()) {
            finalRawFileNames.add(entry.name);
          }
        }

        const resolved = [];
        const tagsMap = {};

        for (const img of imgs) {
          // Just verify the file exists on disk to avoid rendering dead records.
          let fileExists = false;
          if (rawDirHandle) {
            fileExists = finalRawFileNames.has(img.name);
          }

          if (!fileExists && !img.url) {
            // Orphaned DB record — auto-clean so it won't reappear next load
            db.images.delete(img.id).catch(() => {});
            continue;
          }

          // tagIds are synced to DB in step 3 or during upload.
          const tagIds = img.tagIds ?? [];
          tagsMap[img.id] = tagIds;
          resolved.push(img);
        }

        if (!mounted) return;
        setImages(resolved);
        setImageTagsMap(tagsMap);
        if (rawDirHandle) setRawDirHandle(rawDirHandle);
        if (thumbsDirHandle) setThumbsDirHandle(thumbsDirHandle);

        // ── Step 5: Build per-image label map (imageId → Set<classId>) ────────
        // Primary: use db.annotations (populated when user annotates).
        // Fallback: scan annotations/active/*.json from FS — this is necessary
        // after a project rebuild when db.annotations is empty.
        const annoMap = new Map();

        const dbAnns = await db.annotations.where("datasetId").equals(datasetId)
          .filter(a => !a.versionId)
          .toArray();

        if (dbAnns.length > 0) {
          for (const ann of dbAnns) {
            const arr = ann?.data ?? ann?.annotations ?? [];
            const ids = new Set(arr.filter(a => a.classId).map(a => a.classId));
            if (ids.size > 0) annoMap.set(ann.imageId, ids);
          }
        } else if (dsFolder) {
          // Scan FS annotation files
          try {
            const annotationsDir = await dsFolder.getDirectoryHandle("annotations");
            const activeDir = await annotationsDir.getDirectoryHandle("active");
            for await (const entry of activeDir.values()) {
              if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
              try {
                const fh = await activeDir.getFileHandle(entry.name);
                const file = await fh.getFile();
                const data = JSON.parse(await file.text());
                const arr = data?.annotations ?? [];
                const ids = new Set(arr.filter(a => a.classId).map(a => a.classId));
                if (ids.size > 0) annoMap.set(data.imageId, ids);
              } catch { /* skip corrupt files */ }
            }
          } catch { /* no annotations/active folder */ }
        }

        setImageLabelsMap(annoMap);
      } catch (err) {
        console.error("Failed to load images:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [datasetId, projectId]);

  // Close tag picker when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target)) {
        setTagPickerOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // -------------------------------------------------------------------------
  // Tag actions
  // -------------------------------------------------------------------------
  const toggleTagOnImage = useCallback(async (imageId, tagId) => {
    setImageTagsMap((prev) => {
      const current = prev[imageId] ?? [];
      const updated = current.includes(tagId)
        ? current.filter((t) => t !== tagId)
        : [...current, tagId];
      // Persist to meta file
      if (dsFolderRef.current) {
        updateImageMetaTags(dsFolderRef.current, imageId, updated).catch(console.warn);
      }
      return { ...prev, [imageId]: updated };
    });
  }, []);

  // -------------------------------------------------------------------------
  // Filter
  // -------------------------------------------------------------------------
  const toggleClass = (cls) => {
    setSelectedClasses((prev) => {
      const copy = new Set(prev);
      copy.has(cls) ? copy.delete(cls) : copy.add(cls);
      return copy;
    });
  };

  const toggleTagFilter = (tagId) => {
    setSelectedTags((prev) => {
      const copy = new Set(prev);
      copy.has(tagId) ? copy.delete(tagId) : copy.add(tagId);
      return copy;
    });
  };

  const toggleImageSelect = (id) => {
    setSelectedImages((prev) => {
      const copy = new Set(prev);
      copy.has(id) ? copy.delete(id) : copy.add(id);
      return copy;
    });
  };

  const filteredImages = images.filter((img) => {
    if (searchQuery && !(img.originalName || img.name).toLowerCase().includes(searchQuery.toLowerCase()))
      return false;

    if (selectedClasses.size > 0) {
      const imgLabels = imageLabelsMap.get(img.id);
      if (!imgLabels && selectedClasses.has(null)) { /* match unlabeled */ }
      else if (!imgLabels) return false;
      else {
        const hasMatch = [...imgLabels].some((c) => selectedClasses.has(c));
        if (!hasMatch) return false;
      }
    }

    if (selectedTags.size > 0) {
      const imgTags = imageTagsMap[img.id] ?? [];
      const hasTagMatch = [...selectedTags].some((t) => imgTags.includes(t));
      if (!hasTagMatch) return false;
    }

    return true;
  });

  // Pagination calculation
  const totalPages = Math.ceil(filteredImages.length / ITEMS_PER_PAGE);
  const currentImages = filteredImages.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Reset to page 1 if filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClasses, selectedTags]);

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  const deleteSelectedImages = async () => {
    if (selectedImages.size === 0) return;
    openModal({
      type: "confirm",
      title: "Delete Images?",
      message: `Delete ${selectedImages.size} selected images?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        setLoading(true);
        try {
          const folder = dsFolderRef.current;
          let rawDir, metaDir, activeAnnsDir;
          if (folder) {
            try {
              const imagesDir = await folder.getDirectoryHandle("images");
              rawDir = await imagesDir.getDirectoryHandle("raw");
              metaDir = await imagesDir.getDirectoryHandle("meta");
            } catch { }
            try {
              const annotationsDir = await folder.getDirectoryHandle("annotations");
              activeAnnsDir = await annotationsDir.getDirectoryHandle("active");
            } catch { }
          }

          for (const id of selectedImages) {
            const img = images.find(i => i.id === id);
            
            // 1. Delete from IndexedDB (images + annotations)
            await db.images.delete(id);
            await db.annotations.where("datasetId").equals(datasetId).and(a => a.imageId === id).delete().catch(() => {});

            // 2. Delete physical files from disk so they don't resurrect on next sync
            if (folder && img) {
              if (rawDir) await rawDir.removeEntry(img.name).catch(() => {});
              if (metaDir) await metaDir.removeEntry(`${id}.json`).catch(() => {});
              if (activeAnnsDir) await activeAnnsDir.removeEntry(`${id}.json`).catch(() => {});
            }
          }
          
          setImages((prev) => prev.filter((img) => !selectedImages.has(img.id)));
          setSelectedImages(new Set());
          return true;
        } catch (err) {
          console.error("Failed to delete images:", err);
        } finally {
          setLoading(false);
        }
      },
      autoClose: true,
    });
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const tc = themeColors;

  if (loading)
    return (
      <div style={{ height: "60vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Spinner animation="border" role="status" />
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <AppModal {...modal} show={modal.show} onClose={closeModal} />

      {/* ---- Toolbar ---- */}
      <div className="d-flex justify-content-start align-items-center mb-3 flex-wrap gap-2" style={{ flexShrink: 0 }}>
        <InputGroup style={{ maxWidth: 240 }}>
          <FormControl
            placeholder="Search by name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ background: tc.inputBg, color: tc.text, borderColor: tc.border }}
          />
        </InputGroup>

        {/* Class filter */}
        <Dropdown autoClose="outside">
          <Dropdown.Toggle size="sm" variant="outline-secondary" id="class-filter-dd"
            style={{ background: tc.buttonBg, color: tc.text, borderColor: tc.border }}>
            Classes {selectedClasses.size > 0 && <span style={{ marginLeft: 4, background: tc.primary, color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 11 }}>{selectedClasses.size}</span>}
          </Dropdown.Toggle>
          <Dropdown.Menu style={{ maxHeight: 200, overflowY: "auto", padding: "0.5rem", backgroundColor: tc.cardBg, color: tc.text, border: `1px solid ${tc.border}` }}>
            {classes.map((cls, idx) => (
              <div key={idx} style={{ padding: "4px 8px", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); toggleClass(cls); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {selectedClasses.has(cls) ? <CheckSquare size={15} color={tc.primary} /> : <Square size={15} color={tc.text} />}
                  <span style={{ fontSize: 13 }}>
                    {cls === null
                      ? "Unlabeled"
                      : (datasetClasses?.find ? datasetClasses.find(c => c.id === cls)?.name : null) || cls}
                  </span>
                </div>
              </div>
            ))}
          </Dropdown.Menu>
        </Dropdown>

        {/* Tag filter */}
        {datasetTags.length > 0 && (
          <Dropdown autoClose="outside">
            <Dropdown.Toggle size="sm" variant="outline-secondary" id="tag-filter-dd"
              style={{ background: tc.buttonBg, color: tc.text, borderColor: tc.border }}>
              <Tag size={13} style={{ marginRight: 4 }} />
              Tags {selectedTags.size > 0 && <span style={{ marginLeft: 4, background: tc.primary, color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 11 }}>{selectedTags.size}</span>}
            </Dropdown.Toggle>
            <Dropdown.Menu style={{ maxHeight: 220, overflowY: "auto", padding: "0.5rem", backgroundColor: tc.cardBg, color: tc.text, border: `1px solid ${tc.border}` }}>
              {datasetTags.map((tag) => (
                <div key={tag.id} style={{ padding: "4px 8px", cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); toggleTagFilter(tag.id); }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {selectedTags.has(tag.id) ? <CheckSquare size={15} color={tc.primary} /> : <Square size={15} color={tc.text} />}
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: tag.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13 }}>{tag.name}</span>
                  </div>
                </div>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        )}

        <Button size="sm" variant="outline-danger" onClick={deleteSelectedImages}>
          Delete Selected
        </Button>
      </div>

      <div style={{ color: tc.subtleText, fontSize: 13, marginBottom: 12 }}>
        <strong style={{ color: tc.text }}>{filteredImages.length}</strong> images
      </div>

      {/* ---- Image Grid ---- */}
      <Row xs={2} sm={3} md={4} lg={5} className="g-3 m-0" style={{ flex: 1, overflowY: "auto", alignContent: "flex-start", paddingBottom: 16 }}>
        {currentImages.map((img) => {
          const imgTags = imageTagsMap[img.id] ?? [];
          return (
            <Col key={img.id}>
              <Card style={{
                position: "relative",
                background: tc.cardBg,
                color: tc.text,
                border: selectedImages.has(img.id)
                  ? `2px solid ${tc.primary}`
                  : `1px solid ${tc.border}`,
                cursor: "pointer",
                transition: "0.2s",
                borderRadius: 10,
                overflow: "visible",
              }}>
                {/* Select checkbox */}
                <div style={{ position: "absolute", top: 5, left: 5, zIndex: 10 }}
                  onClick={() => toggleImageSelect(img.id)}>
                  {selectedImages.has(img.id)
                    ? <CheckSquare color={tc.primary} size={18} />
                    : <Square color={tc.text} size={18} />}
                </div>

                {/* Annotate button */}
                <div style={{ position: "absolute", top: 3, right: 5, zIndex: 10 }}>
                  <Button size="sm" variant="outline-primary" className="mt-1 p-1"
                    style={{ fontSize: "0.65rem" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/annotate/${projectId}/${datasetId}/${img.jobId || "unassigned"}?imageId=${img.id}`);
                    }}>
                    🖊
                  </Button>
                </div>

                {/* Thumbnail */}
                <div style={{ height: 120, overflow: "hidden", borderRadius: "10px 10px 0 0" }}>
                  <LazyThumbnail img={img} rawDirHandle={rawDirHandle} thumbsDirHandle={thumbsDirHandle} />
                </div>

                {/* Name */}
                <Card.Body className="p-2">
                  <div style={{ fontSize: "0.72rem", color: tc.subtleText, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={img.originalName || img.name}>
                    {img.originalName || img.name}
                  </div>

                  {/* Tag chips row */}
                  {datasetTags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", minHeight: 20 }}>
                      {/* Existing tag chips */}
                      {imgTags.map((tagId) => {
                        const tag = datasetTags.find((t) => t.id === tagId);
                        if (!tag) return null;
                        return (
                          <span key={tagId} style={{
                            background: tag.color + "33",
                            border: `1px solid ${tag.color}`,
                            color: tag.color,
                            borderRadius: 10,
                            fontSize: 10,
                            padding: "1px 6px",
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                            cursor: "pointer",
                          }}
                            onClick={(e) => { e.stopPropagation(); toggleTagOnImage(img.id, tagId); }}
                            title={`Remove tag "${tag.name}"`}>
                            {tag.name}
                            <X size={9} />
                          </span>
                        );
                      })}

                      {/* Add tag button */}
                      <span style={{ position: "relative" }}>
                        <span
                          style={{
                            background: tc.inputBg,
                            border: `1px dashed ${tc.border}`,
                            color: tc.subtleText,
                            borderRadius: 10,
                            fontSize: 10,
                            padding: "1px 6px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagPickerOpen(tagPickerOpen === img.id ? null : img.id);
                          }}
                          title="Add tag">
                          <Tag size={9} /> +
                        </span>

                        {/* Tag picker popover */}
                        {tagPickerOpen === img.id && (
                          <div ref={tagPickerRef} style={{
                            position: "absolute",
                            bottom: "calc(100% + 6px)",
                            left: 0,
                            zIndex: 9999,
                            background: tc.cardBg,
                            border: `1px solid ${tc.border}`,
                            borderRadius: 8,
                            padding: "8px",
                            minWidth: 150,
                            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                          }}>
                            <div style={{ fontSize: 11, color: tc.subtleText, marginBottom: 6, fontWeight: 600 }}>Add / remove tags</div>
                            {datasetTags.map((tag) => {
                              const active = imgTags.includes(tag.id);
                              return (
                                <div key={tag.id}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 7,
                                    padding: "4px 6px", borderRadius: 6, cursor: "pointer",
                                    background: active ? tag.color + "22" : "transparent",
                                  }}
                                  onClick={(e) => { e.stopPropagation(); toggleTagOnImage(img.id, tag.id); }}>
                                  <div style={{ width: 10, height: 10, borderRadius: 3, background: tag.color, flexShrink: 0 }} />
                                  <span style={{ fontSize: 12, color: tc.text, flex: 1 }}>{tag.name}</span>
                                  {active && <CheckSquare size={13} color={tag.color} />}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </span>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* ---- Pagination ---- */}
      {totalPages > 1 && (
        <div className="d-flex justify-content-center align-items-center py-2 gap-3" style={{ flexShrink: 0, borderTop: `1px solid ${tc.border}` }}>
          <Button 
            variant="outline-secondary" 
            size="sm" 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          >
            <ChevronLeft size={16} /> Prev
          </Button>
          <span style={{ color: tc.text, fontSize: 14 }}>
            Page {currentPage} of {totalPages}
          </span>
          <Button 
            variant="outline-secondary" 
            size="sm" 
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          >
            Next <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
