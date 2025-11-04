// frontend/src/pages/dataset/UploadImagesPage.jsx
import React, { useState, useEffect, useRef } from "react";
import { Button, Card, Row, Col, Form, Spinner } from "react-bootstrap";
import { db } from "../../utils/db";
import { useTheme } from "../../components/ThemeContext";
import { CheckSquare, Square, UploadCloud } from "lucide-react";

export default function UploadImagesPage({ datasetId, onJobCreated }) {
  const { themeColors, theme } = useTheme();

  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("Loading...");
  const createdUrlsRef = useRef(new Set());

  // 🧠 Load images
  useEffect(() => {
    let mounted = true;
    const loadImages = async () => {
      setLoading(true);
      try {
        const stored = await db.images?.where("datasetId").equals(datasetId).toArray();
        const mapped = stored.map((it) => ({
          ...it,
          url: it.url || undefined,
        }));
        if (mounted) setImages(mapped);
      } catch (err) {
        console.error("Failed to load images:", err);
      } finally {
        if (mounted) {
          setLoading(false);
          setStatusText("");
        }
      }
    };
    loadImages();
    return () => (mounted = false);
  }, [datasetId]);

  // 🖼️ Upload images (temporary in DB)
  const handleFiles = async (files) => {
    if (!files?.length) return;
    setLoading(true);
    setStatusText("Uploading images...");

    const newImages = [];
    try {
      for (const file of files) {
        const id = crypto.randomUUID();
        const objUrl = URL.createObjectURL(file);
        createdUrlsRef.current.add(objUrl);
        const img = {
          id,
          datasetId,
          name: file.name,
          file,
          url: objUrl,
          uploadedAt: new Date().toISOString(),
        };
        await db.images.put(img);
        newImages.push(img);
      }
      setImages((prev) => [...prev, ...newImages]);
    } catch (err) {
      console.error(err);
      alert("Failed to upload images.");
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  // 🖱️ Drag & drop
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

  // 🧩 Selection logic
  const toggleSelect = (id) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      copy.has(id) ? copy.delete(id) : copy.add(id);
      return copy;
    });
  };
  const selectAll = () => setSelected(new Set(images.map((i) => i.id)));
  const clearSelection = () => setSelected(new Set());

  // 🗑️ Delete selected
  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm("Delete selected images?")) return;
    setLoading(true);
    try {
      for (const id of selected) await db.images.delete(id);
      setImages((prev) => prev.filter((i) => !selected.has(i.id)));
      setSelected(new Set());
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // 🧹 Clear all
  const clearAll = async () => {
    if (!confirm("Clear all images?")) return;
    setLoading(true);
    try {
      await db.images.where("datasetId").equals(datasetId).delete();
      setImages([]);
      setSelected(new Set());
    } catch (err) {
      console.error("Clear failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // 🚀 Create annotation job + copy files to dataset folder
  const createJob = async () => {
    if (selected.size === 0) return alert("Select at least one image first.");
    setLoading(true);
    setStatusText("Creating annotation job...");

    try {
      const dataset = await db.datasets.get(Number(datasetId));
      if (!dataset?.folderHandle) throw new Error("Dataset folder not selected by user.");

      // 📁 Ensure raw_images folder exists
      const rawFolderHandle = await dataset.folderHandle.getDirectoryHandle("raw_images", { create: true });
      const imageIds = [];

      // 🔁 Copy selected images into raw_images/
      for (const id of selected) {
        const imgRec = await db.images.get(id);
        if (!imgRec?.file) continue;
        const targetHandle = await rawFolderHandle.getFileHandle(imgRec.name, { create: true });
        const writable = await targetHandle.createWritable();
        await writable.write(await imgRec.file.arrayBuffer());
        await writable.close();

        // update image record to use relative path
        await db.images.update(id, {
          path: `raw_images/${imgRec.name}`,
          jobId: null, // assigned later per job
          url: undefined,
        });

        imageIds.push(id);
      }

      // 🧱 Create job
      const job = {
        id: crypto.randomUUID(),
        datasetId,
        name: `Job - ${new Date().toLocaleString()}`,
        imageIds,
        status: "not_started",
        createdAt: new Date().toISOString(),
      };
      await db.jobs.add(job);

      alert("✅ Job created and images saved in dataset folder!");
      if (onJobCreated) onJobCreated();
    } catch (err) {
      console.error(err);
      alert("Failed to create job.");
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  // 🎨 UI
  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      style={{
        position: "relative",
        border: dragActive ? "2px dashed #4f46e5" : "2px dashed #ccc",
        borderRadius: 12,
        padding: "2rem",
        background: dragActive ? themeColors.nodeBg : themeColors.background,
        minHeight: "70vh",
        transition: "all 0.25s ease-in-out",
        filter: loading ? "blur(2px)" : "none",
        opacity: loading ? 0.9 : 1,
      }}
    >
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              theme === "dark" ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.75)",
            zIndex: 20,
            borderRadius: 12,
            backdropFilter: "blur(4px)",
          }}
        >
          <Spinner
            animation="border"
            role="status"
            variant={theme === "dark" ? "light" : "dark"}
          />
          <div style={{ marginTop: "1rem", color: themeColors.text, fontWeight: 500 }}>
            {statusText}
          </div>
        </div>
      )}

      {/* Upload box */}
      <div className="text-center mb-4">
        <h5 style={{ color: themeColors.text }}>
          <UploadCloud size={20} className="me-2" />
          Drag & drop images here or click below to upload
        </h5>
        <Form.Group controlId="formFile" className="mt-3">
          <Form.Control
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => handleFiles(e.target.files)}
            style={{ maxWidth: 300, margin: "0 auto" }}
          />
        </Form.Group>
      </div>

      {images.length > 0 && (
        <>
          {/* Toolbar */}
          <div
            className="d-flex justify-content-between align-items-center mb-3"
            style={{
              background: themeColors.toolbarBg,
              padding: "0.75rem 1rem",
              borderRadius: 8,
              boxShadow: `0 1px 3px ${themeColors.shadow}`,
            }}
          >
            <div className="d-flex align-items-center gap-2">
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

          {/* Image Grid */}
          <Row xs={2} sm={3} md={4} lg={5} className="g-3">
            {images.map((img) => (
              <Col key={img.id}>
                <Card
                  style={{
                    position: "relative",
                    background: themeColors.cardBg,
                    color: themeColors.text,
                    border: selected.has(img.id)
                      ? `2px solid ${themeColors.primary}`
                      : `1px solid ${themeColors.border}`,
                    cursor: "pointer",
                    transition: "0.2s",
                  }}
                  onClick={() => toggleSelect(img.id)}
                >
                  <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10 }}>
                    {selected.has(img.id) ? (
                      <CheckSquare size={20} color={themeColors.primary} />
                    ) : (
                      <Square size={20} color={themeColors.text} />
                    )}
                  </div>

                  <div style={{ height: 120, overflow: "hidden", borderRadius: "8px 8px 0 0" }}>
                    <img
                      src={img.url}
                      alt={img.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                      onError={(e) => {
                        const el = e.target;
                        if (img.file instanceof Blob) {
                          const u = URL.createObjectURL(img.file);
                          el.src = u;
                          createdUrlsRef.current.add(u);
                        }
                      }}
                    />
                  </div>

                  <Card.Body className="p-2 text-center">
                    <div style={{ fontSize: "0.8rem", color: themeColors.subtleText }}>
                      {img.name}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: themeColors.subtleText }}>
                      {new Date(img.uploadedAt).toLocaleString()}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}
