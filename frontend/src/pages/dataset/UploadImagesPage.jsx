// frontend/src/pages/dataset/UploadImagesPage.jsx
import React, { useState, useEffect, useRef } from "react";
import { Button, Card, Row, Col, Form, Spinner } from "react-bootstrap";
import { db } from "../../utils/db";
import { useTheme } from "../../components/ThemeContext";
import { CheckSquare, Square, UploadCloud } from "lucide-react";

export default function UploadImagesPage({
  dataset,
  project,
  datasetId,
  projectId,
  onJobCreated,
}) {
  const { themeColors, theme } = useTheme();

  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("Loading...");
  const createdUrlsRef = useRef(new Set());

  // ----------------------------------------
  // LOAD TEMP IMAGES (REFRESH-PROOF)
  // ----------------------------------------
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const stored = await db.tempImages
          .where("datasetId")
          .equals(datasetId)
          .toArray();

        const mapped = stored.map((it) => ({
          ...it,
          url: it.url || URL.createObjectURL(it.blob),
        }));

        mapped.forEach((m) => createdUrlsRef.current.add(m.url));

        if (mounted) setImages(mapped);
      } catch (err) {
        console.error("❌ Failed to load temp images:", err);
      } finally {
        setLoading(false);
        setStatusText("");
      }
    };
    load();
    return () => (mounted = false);
  }, [datasetId]);

  // ----------------------------------------
  // UPLOAD FILES
  // ----------------------------------------
  const handleFiles = async (files) => {
    const valid = Array.from(files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (valid.length === 0) return alert("No valid image selected.");

    setLoading(true);
    setStatusText("Uploading...");

    const newImages = [];

    for (const file of valid) {
      const id = crypto.randomUUID();
      const ext = file.name.includes(".")
        ? file.name.substring(file.name.lastIndexOf("."))
        : "";
      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      const url = URL.createObjectURL(blob);
      createdUrlsRef.current.add(url);

      const img = {
        id,
        datasetId,
        name: `${id}${ext}`,
        originalName: file.name,
        blob,
        url,
        createdAt: new Date().toISOString(),
      };

      await db.tempImages.put(img);
      newImages.push(img);
    }

    setImages((prev) => [...prev, ...newImages]);
    setLoading(false);
    setStatusText("");
  };

  // ----------------------------------------
  // DRAG & DROP
  // ----------------------------------------
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (["dragenter", "dragover"].includes(e.type)) setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length > 0) handleFiles(e.dataTransfer.files);
  };

  // ----------------------------------------
  // SELECTION
  // ----------------------------------------
  const toggleSelect = (id) =>
    setSelected((p) => {
      const s = new Set(p);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const selectAll = () => setSelected(new Set(images.map((i) => i.id)));
  const clearSelection = () => setSelected(new Set());

  // ----------------------------------------
  // DELETE SELECTED
  // ----------------------------------------
  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm("Delete selected images?")) return;

    for (const id of selected) await db.tempImages.delete(id);

    setImages((prev) => prev.filter((i) => !selected.has(i.id)));
    clearSelection();
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL uploaded images?")) return;

    await db.tempImages.where("datasetId").equals(datasetId).delete();
    setImages([]);
    clearSelection();
  };

  // ----------------------------------------
  // CREATE JOB
  // ----------------------------------------
  const createJob = async () => {
    if (selected.size === 0) return alert("Select at least one image.");

    setLoading(true);
    setStatusText("Creating Job...");

    try {
      // ensure folder exists
      const rawFolderHandle = await dataset.folderHandle.getDirectoryHandle(
        "raw_images",
        { create: true }
      );

      const jobImageIds = [];

      for (const id of selected) {
        const img = await db.tempImages.get(id);
        if (!img) continue;

        const fileHandle = await rawFolderHandle.getFileHandle(img.name, {
          create: true,
        });
        const writable = await fileHandle.createWritable();
        await writable.write(await img.blob.arrayBuffer());
        await writable.close();

        await db.images.put({
          id: img.id,
          datasetId,
          name: img.name,
          originalName: img.originalName,
          path: `raw_images/${img.name}`,
          createdAt: new Date().toISOString(),
          jobId: null,
        });

        jobImageIds.push(img.id);
      }

      // create job record
      const job = {
        id: crypto.randomUUID(),
        datasetId,
        name: `Job - ${new Date().toLocaleString()}`,
        status: "not_started",
        imageIds: jobImageIds,
        createdAt: new Date().toISOString(),
      };

      await db.jobs.add(job);

      alert("Job created successfully.");
      onJobCreated && onJobCreated();
    } catch (err) {
      console.error("❌ createJob failed:", err);
      alert("Failed to create job.");
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  // ----------------------------------------
  // UI
  // ----------------------------------------
  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      style={{
        position: "relative",
        border: dragActive ? "2px dashed #4f46e5" : "2px dashed #aaa",
        borderRadius: 12,
        padding: "2rem",
        background: themeColors.background,
        transition: "0.25s",
      }}
    >
      {/* LOADING OVERLAY */}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: theme === "dark" ? "rgba(0,0,0,0.6)" : "#ffffffcc",
            zIndex: 20,
          }}
        >
          <Spinner animation="border" />
          <div style={{ marginTop: 10, color: themeColors.text }}>
            {statusText}
          </div>
        </div>
      )}

      {/* Upload box */}
      <div className="text-center mb-4">
        <h5 style={{ color: themeColors.text }}>
          <UploadCloud size={20} /> Drag & drop images or select files
        </h5>
        <Form.Control
          type="file"
          multiple
          accept="image/*"
          style={{ width: 300, margin: "1rem auto" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Toolbar */}
      {images.length > 0 && (
        <div
          className="d-flex justify-content-between align-items-center mb-3"
          style={{
            background: themeColors.toolbarBg,
            padding: "0.75rem 1rem",
            borderRadius: 8,
          }}
        >
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-secondary" onClick={selectAll}>
              Select All
            </Button>
            <Button size="sm" variant="outline-secondary" onClick={clearSelection}>
              Clear Selection
            </Button>
            <Button size="sm" variant="outline-danger" onClick={deleteSelected}>
              Delete Selected
            </Button>
            <Button size="sm" variant="outline-danger" onClick={clearAll}>
              Clear All
            </Button>
          </div>

          <Button size="sm" variant="primary" onClick={createJob}>
            Create Annotation Job
          </Button>
        </div>
      )}

      {/* Image grid */}
      <Row xs={2} sm={3} md={4} lg={5} className="g-3">
        {images.map((img) => (
          <Col key={img.id}>
            <Card
              style={{
                cursor: "pointer",
                userSelect: "none",
                background: themeColors.cardBg,
                border: selected.has(img.id)
                  ? `2px solid ${themeColors.primary}`
                  : `1px solid ${themeColors.border}`,
              }}
              onClick={() => toggleSelect(img.id)}
              draggable={false}
            >
              <div style={{ position: "absolute", top: 6, left: 6, zIndex: 5 }}>
                {selected.has(img.id) ? (
                  <CheckSquare color={themeColors.primary} />
                ) : (
                  <Square color={themeColors.text} />
                )}
              </div>

              <div style={{ height: 120, overflow: "hidden" }}>
                <img
                  src={img.url}
                  alt={img.originalName}
                  draggable={false}
                  style={{ objectFit: "cover", width: "100%", height: "100%" }}
                  onError={(e) => {
                    if (img.blob) {
                      const newUrl = URL.createObjectURL(img.blob);
                      e.target.src = newUrl;
                      createdUrlsRef.current.add(newUrl);
                    }
                  }}
                />
              </div>

              <Card.Body className="p-2 text-center">
                <div style={{ fontSize: 12 }}>{img.originalName}</div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
