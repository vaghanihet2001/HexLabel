import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, ListGroup, Form } from "react-bootstrap";
import { Pencil, Trash2, CheckCircle2, Settings } from "lucide-react";
import { useTheme } from "../../components/ThemeContext";
import { db, generateId } from "../../utils/db";
import { 
  writeVersionFile, 
  deleteVersionFile, 
  scanVersionsFromDatasetFolder,
  createVersionSnapshot 
} from "../../utils/fs";
import { exportDatasetVersion, EXPORT_FORMATS } from "../../utils/exportUtils";
import AppModal from "../../components/AppModal";

export default function VersionsPage({ datasetId: propDatasetId }) {
  const params = useParams();
  const datasetId = propDatasetId || params.datasetId;
  const { themeColors } = useTheme();

  const [dataset, setDataset]   = useState(null);
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editName, setEditName] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState(null);
  const [exporting, setExporting]             = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat]       = useState(EXPORT_FORMATS[0].value);

  // Creation form — only Info + Split now
  const [mode, setMode]           = useState("view"); // view | create
  const [step, setStep]           = useState(1);
  const [name, setName]           = useState("");
  const [description, setDescription] = useState("");
  const [split, setSplit]         = useState({ train: 80, val: 10, test: 10 });

  useEffect(() => {
    (async () => {
      const ds = await db.datasets.get(datasetId);
      setDataset(ds || null);
      const dt = new Date().toISOString().replace(/[:.]/g, "-");
      setName(`${ds?.name || "dataset"}-${dt}`);

      // Sync from FS if possible
      if (ds) {
        try {
          let dsHandle = ds.folderHandle;
          if (!dsHandle && ds.projectId) {
            const proj = await db.projects.get(ds.projectId);
            if (proj?.folderHandle) {
              dsHandle = await proj.folderHandle.getDirectoryHandle(ds.name).catch(() => null);
            }
          }
          if (dsHandle) {
            const fsVersions = await scanVersionsFromDatasetFolder(dsHandle);
            if (fsVersions.length > 0) await db.datasetVersions.bulkPut(fsVersions);
          }
        } catch (err) {
          console.warn("Failed to sync versions from FS", err);
        }
      }

      const vs = await db.datasetVersions.where("datasetId").equals(datasetId).toArray();
      setVersions(vs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));

      if (ds?.type === "segment") setExportFormat("yolo-segment");
      else if (ds?.type === "detect") setExportFormat("yolo-hbb");

    })();
  }, [datasetId]);

  // -------------------------------------------------------------------------
  // Create version
  // -------------------------------------------------------------------------
  const createVersion = async () => {
    const total = Number(split.train) + Number(split.val) + Number(split.test);
    if (total !== 100) return window.alert("Splits must sum to 100");

    const id = generateId?.() || crypto.randomUUID();

    // Only snapshot annotations belonging to completed jobs
    const completedJobs = await db.jobs.where("datasetId").equals(datasetId).filter(j => j.status === "completed").toArray();
    const completedJobIds = new Set(completedJobs.map(j => j.id));

    const validImages = await db.images.where("datasetId").equals(datasetId).filter(img => completedJobIds.has(img.jobId)).toArray();
    const validImageIds = new Set(validImages.map(img => img.id));

    const currentAnns = await db.annotations
      .where("datasetId").equals(datasetId)
      .filter(a => !a.versionId && validImageIds.has(a.imageId))
      .toArray();

    const snapshotAnns = currentAnns.map(a => ({
      ...a,
      id: generateId(),
      versionId: id,
      originalAnnotationId: a.id,
    }));

    const ver = {
      id, datasetId, name, description,
      splits: { ...split }, preprocessing: {}, augmentation: {},
      createdAt: new Date().toISOString(),
    };

    try {
      setExporting(true); // Reuse exporting for "Creating..." feedback
      await db.datasetVersions.put(ver);
      
      // Full Filesystem Snapshot (images + annotations + classes/tags)
      const dsHandle = await getDsHandle();
      if (dsHandle) {
        await createVersionSnapshot(dsHandle, ver, Array.from(validImageIds));
      }

      const vs = await db.datasetVersions.where("datasetId").equals(datasetId).toArray();
      setVersions(vs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
      setSelected(id);
      setMode("view");
      setStep(1);
    } catch (err) {
      console.error("Failed to create version", err);
      alert("Failed to create version: " + err.message);
    } finally {
      setExporting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  const handleDeleteClick = (vid) => { setVersionToDelete(vid); setShowDeleteModal(true); };

  const confirmDelete = async () => {
    if (!versionToDelete) return;
    try {
      await db.datasetVersions.delete(versionToDelete);
      const dsHandle = await getDsHandle();
      if (dsHandle) await deleteVersionFile(dsHandle, versionToDelete);
      setVersions(v => v.filter(x => x.id !== versionToDelete));
      if (selected === versionToDelete) setSelected(null);
    } catch (err) {
      console.error("Delete failed", err);
    } finally {
      setShowDeleteModal(false);
      setVersionToDelete(null);
    }
  };

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------
  const handleExportClick = (vid) => { setSelected(vid); setShowExportModal(true); };

  const handleExportConfirm = async () => {
    const v = versions.find(x => x.id === selected);
    if (!v) return;
    setExporting(true);
    try {
      const proj = await db.projects.get(dataset.projectId);
      await exportDatasetVersion(v, dataset, proj, exportFormat);
    } catch (err) {
      console.error("Export failed", err);
      alert("Export failed: " + err.message);
    } finally {
      setExporting(false);
      setShowExportModal(false);
    }
  };

  // -------------------------------------------------------------------------
  // Helper — get dataset folder handle
  // -------------------------------------------------------------------------
  const getDsHandle = async () => {
    if (dataset?.folderHandle) return dataset.folderHandle;
    if (dataset?.projectId) {
      const proj = await db.projects.get(dataset.projectId);
      if (proj?.folderHandle) {
        return proj.folderHandle.getDirectoryHandle(dataset.name).catch(() => null);
      }
    }
    return null;
  };

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------
  const tc = themeColors;
  const styles = {
    container: { display: "flex", color: tc.text },
    left: { flex: 1, padding: 18, background: tc.background, borderRight: `1px solid ${tc.border}` },
    right: { width: 320, height: "70vh", padding: 14, background: tc.sidebarBg, borderLeft: `1px solid ${tc.border}` },
    card: { background: tc.cardBg, padding: 16, borderRadius: 10, border: `1px solid ${tc.border}` },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  };

  const STEPS = ["Info", "Split", "Finish"];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div style={styles.container}>

      {/* ---- Left: main area ---- */}
      <div style={styles.left}>
        <div style={styles.header}>
          <div>
            <h4 style={{ margin: 0 }}>{dataset?.name || "Dataset"}</h4>
            <small style={{ color: tc.subtleText }}>{dataset?.description}</small>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="outline-secondary"
              onClick={() => { setMode("create"); setSelected(null); setStep(1); }}>
              + Create Version
            </Button>
            <Button size="sm" variant="success"
              onClick={() => { if (selected) handleExportClick(selected); }}
              disabled={!selected || exporting}>
              {exporting ? "Exporting…" : "Export Dataset"}
            </Button>
          </div>
        </div>

        {/* Creation / selected preview */}
        <div style={styles.card}>

          {/* Nothing selected */}
          {mode === "view" && !selected && (
            <div style={{ textAlign: "center", padding: 40, color: tc.subtleText }}>
              Select a version from the right to view details, or create a new version.
            </div>
          )}

          {/* Version detail */}
          {mode === "view" && selected && (() => {
            const ver = versions.find(v => v.id === selected);
            if (!ver) return <div>Version not found</div>;
            return (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {editName ? (
                      <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)}
                        onBlur={async () => {
                          setEditName(false);
                          await db.datasetVersions.update(selected, { name });
                          const vs = await db.datasetVersions.where("datasetId").equals(datasetId).toArray();
                          setVersions(vs);
                        }} />
                    ) : (
                      <h5 style={{ margin: 0 }}>{ver.name}</h5>
                    )}
                    <Button variant="link" size="sm" onClick={() => setEditName(true)} style={{ color: tc.text }}>
                      <Pencil size={14} />
                    </Button>
                  </div>

                  <p style={{ color: themeColors.subtleText }}>{ver.description}</p>

                  <div style={{ display: "flex", gap: 18 }}>
                    <div>
                      <strong>Splits</strong>
                      <div style={{ color: themeColors.subtleText }}>Train: {ver.splits.train}%</div>
                      <div style={{ color: themeColors.subtleText }}>Val: {ver.splits.val}%</div>
                      <div style={{ color: themeColors.subtleText }}>Test: {ver.splits.test}%</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Create wizard — 3 steps only */}
          {mode === "create" && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[1, 2, 3].map(n => (
                  <div key={n} onClick={() => setStep(n)} style={{ padding: 8, borderRadius: 8, cursor: 'pointer', background: step === n ? themeColors.primary : themeColors.cardBg, color: step === n ? '#fff' : themeColors.text, border: `1px solid ${themeColors.border}` }}>
                    {step > n ? <CheckCircle2 size={14} /> : <Settings size={14} />} <small style={{ marginLeft: 6 }}>{['Info', 'Split', 'Finish'][n - 1]}</small>
                  </div>
                ))}
              </div>

              {/* Step 1: Info */}
              {step === 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <Form.Group>
                    <Form.Label style={{ fontSize: 13 }}>Version Name</Form.Label>
                    <Form.Control value={name} onChange={e => setName(e.target.value)}
                      style={{ background: tc.inputBg, color: tc.text, borderColor: tc.border }} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label style={{ fontSize: 13 }}>Description <span style={{ color: tc.subtleText }}>(optional)</span></Form.Label>
                    <Form.Control as="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)}
                      style={{ background: tc.inputBg, color: tc.text, borderColor: tc.border }} />
                  </Form.Group>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button onClick={() => setStep(2)}>Next</Button>
                  </div>
                </div>
              )}

              {/* Step 2: Split */}
              {step === 2 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 13, color: tc.subtleText, marginBottom: 4 }}>
                    Values must sum to 100. Current: {Number(split.train) + Number(split.val) + Number(split.test)}%
                  </div>
                  {[["Train %", "train"], ["Val %", "val"], ["Test %", "test"]].map(([label, key]) => (
                    <Form.Group key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Form.Label style={{ width: 60, margin: 0, fontSize: 13 }}>{label}</Form.Label>
                      <Form.Control type="number" min={0} max={100} value={split[key]}
                        onChange={e => setSplit({ ...split, [key]: Number(e.target.value) })}
                        style={{ background: tc.inputBg, color: tc.text, borderColor: tc.border, width: 100 }} />
                    </Form.Group>
                  ))}
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between" }}>
                    <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                    <Button onClick={() => setStep(3)}>Next</Button>
                  </div>
                </div>
              )}

              {/* Step 3: Finish */}
              {step === 3 && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: 16, color: tc.subtleText, fontSize: 14 }}>
                    Ready to create version <strong>{name}</strong> with splits: Train {split.train}% / Val {split.val}% / Test {split.test}%.
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <Button variant="secondary" onClick={() => setStep(2)} disabled={exporting}>Back</Button>
                    <Button onClick={createVersion} disabled={exporting}>
                      {exporting ? "Creating Snapshot..." : "Create Version"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Right: versions list ---- */}
      <div style={styles.right}>
        <h5 style={{ marginTop: 0 }}>All Versions</h5>
        <ListGroup style={{ border: `1px solid ${tc.border}`, borderRadius: 8, overflow: "auto", maxHeight: "78vh" }}>
          {versions.length === 0 && (
            <div style={{ padding: 16, color: tc.subtleText, fontSize: 13 }}>No versions yet. Create one.</div>
          )}
          {versions.map(v => (
            <ListGroup.Item key={v.id} action
              style={{ background: selected === v.id ? tc.primary : tc.cardBg, color: selected === v.id ? "#fff" : tc.text, borderBottom: `1px solid ${tc.border}` }}
              onClick={() => { setSelected(v.id); setMode("view"); }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{v.name}</div>
                  <div style={{ fontSize: 11, color: selected === v.id ? "rgba(255,255,255,0.7)" : tc.subtleText }}>
                    {new Date(v.createdAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Button variant="link" size="sm"
                    onClick={e => { e.stopPropagation(); setSelected(v.id); setMode("view"); setEditName(true); }}
                    title="Rename">
                    <Pencil size={13} color={selected === v.id ? "#fff" : tc.text} />
                  </Button>
                  <Button variant="link" size="sm"
                    onClick={e => { e.stopPropagation(); handleDeleteClick(v.id); }}
                    title="Delete">
                    <Trash2 size={13} color={tc.danger} />
                  </Button>
                </div>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </div>

      {/* AppModal for Delete Confirmation */}
      <AppModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        title="Delete Version?"
        confirmText="Delete"
        confirmVariant="danger"
        onConfirm={confirmDelete}
      >
        <p>Are you sure you want to delete this version configuration? This action cannot be undone.</p>
      </AppModal>

      <AppModal
        show={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Dataset"
        confirmText={exporting ? "Exporting..." : "Export"}
        type="confirm"
        onConfirm={handleExportConfirm}
        loading={exporting}
        message={
          <Form.Group>
            <Form.Label>Select Format</Form.Label>
            <Form.Select value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
              {EXPORT_FORMATS.map(fmt => (
                <option key={fmt.value} value={fmt.value}>{fmt.label}</option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted" style={{ display: 'block', marginTop: 8 }}>
              {EXPORT_FORMATS.find(f => f.value === exportFormat)?.description}
            </Form.Text>
          </Form.Group>
        }
      />
    </div>
  );
}
