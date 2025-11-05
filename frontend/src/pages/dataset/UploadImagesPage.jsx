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

  // 🧠 Load temp images from IndexedDB
  useEffect(() => {
    let mounted = true;
    const loadImages = async () => {
      setLoading(true);
      try {
        const stored = await db.tempImages
          ?.where("datasetId")
          .equals(datasetId)
          .toArray();

        const mapped = stored.map((it) => ({
          ...it,
          url: it.url || URL.createObjectURL(it.blob), // recreate preview URL if missing
        }));

        mapped.forEach((m) => createdUrlsRef.current.add(m.url));
        if (mounted) setImages(mapped);
      } catch (err) {
        console.error("Failed to load temp images:", err);
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

  // 🖼️ Upload images → store as blob in tempImages (with UUID filenames)
  const handleFiles = async (files) => {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return alert("No valid images selected");
    setLoading(true);
    setStatusText("Uploading images...");

    const newImages = [];
    try {
      for (const file of files) {
        const id = crypto.randomUUID();
        const extIndex = file.name.lastIndexOf(".");
        const ext = extIndex !== -1 ? file.name.slice(extIndex) : "";
        const blob = new Blob([await file.arrayBuffer()], { type: file.type });
        const url = URL.createObjectURL(blob);
        createdUrlsRef.current.add(url);

        const img = {
          id,
          datasetId,
          name: `${id}${ext}`, // file stored with image ID
          originalName: file.name,
          blob,
          url,
          uploadedAt: new Date().toISOString(),
        };

        await db.tempImages.put(img);
        newImages.push(img);
      }

      setImages((prev) => [...prev, ...newImages]);
    } catch (err) {
      console.error("Image upload failed:", err);
      alert("Failed to upload images.");
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };

  // 🖱️ Drag & Drop
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
  const toggleSelect = (id) =>
    setSelected((prev) => {
      const copy = new Set(prev);
      copy.has(id) ? copy.delete(id) : copy.add(id);
      return copy;
    });

  const selectAll = () => setSelected(new Set(images.map((i) => i.id)));
  const clearSelection = () => setSelected(new Set());

  // 🗑️ Delete selected temp images
  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm("Delete selected uploaded images?")) return;
    setLoading(true);
    try {
      for (const id of selected) await db.tempImages.delete(id);
      setImages((prev) => prev.filter((i) => !selected.has(i.id)));
      setSelected(new Set());
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // 🧹 Clear all temp images
  const clearAll = async () => {
    if (!confirm("Clear all uploaded images?")) return;
    setLoading(true);
    try {
      await db.tempImages.where("datasetId").equals(datasetId).delete();
      setImages([]);
      setSelected(new Set());
    } catch (err) {
      console.error("Clear failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // 🚀 Create Annotation Job (copy from tempImages → images)
  const createJob = async () => {
    if (selected.size === 0) return alert("Select at least one image first.");
    setLoading(true);
    setStatusText("Creating annotation job...");

    try {
      const dataset = await db.datasets.get(datasetId);
      if (!dataset?.folderHandle)
        throw new Error("Dataset folder not selected by user.");

      // 📁 Ensure raw_images folder exists
      const rawFolderHandle = await dataset.folderHandle.getDirectoryHandle(
        "raw_images",
        { create: true }
      );
      const imageIds = [];

      for (const id of selected) {
        const imgRec = await db.tempImages.get(id);
        if (!imgRec?.blob) continue;

        const targetHandle = await rawFolderHandle.getFileHandle(imgRec.name, {
          create: true,
        });
        const writable = await targetHandle.createWritable();
        await writable.write(await imgRec.blob.arrayBuffer());
        await writable.close();

        const newImage = {
          id: imgRec.id, // keep the same UUID for consistency
          datasetId,
          jobId: null,
          name: imgRec.name,
          originalName: imgRec.originalName,
          path: `raw_images/${imgRec.name}`,
          createdAt: new Date().toISOString(),
        };
        await db.images.put(newImage);
        imageIds.push(newImage.id);
      }

      // 🧩 Create job entry
      const job = {
        id: crypto.randomUUID(),
        datasetId,
        name: `Job - ${new Date().toLocaleString()}`,
        imageIds,
        status: "not_started",
        createdAt: new Date().toISOString(),
      };
      await db.jobs.add(job);

      alert("✅ Job created successfully!");
      if (onJobCreated) onJobCreated();
    } catch (err) {
      console.error("Job creation failed:", err);
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
              theme === "dark"
                ? "rgba(0,0,0,0.65)"
                : "rgba(255,255,255,0.75)",
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

      {/* Upload Box */}
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
                      alt={img.originalName}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
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
                    <div style={{ fontSize: "0.8rem", color: themeColors.subtleText }}>
                      {img.originalName}
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
