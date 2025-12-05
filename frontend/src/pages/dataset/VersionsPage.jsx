import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, ListGroup, Form } from "react-bootstrap";
import { Pencil, Trash2, CheckCircle2, Settings, Download } from "lucide-react";
import { useTheme } from "../../components/ThemeContext";
import { db, generateId } from "../../utils/db";
import { writeVersionFile, deleteVersionFile } from "../../utils/fs";
import { exportVersionToYolo } from "../../utils/exportUtils";
import AppModal from "../../components/AppModal";

export default function VersionsPage({ datasetId: propDatasetId }) {
  const params = useParams();
  const datasetId = propDatasetId || params.datasetId;
  const { themeColors } = useTheme();

  const [dataset, setDataset] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editName, setEditName] = useState(false);

  // Modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState(null);
  const [exporting, setExporting] = useState(false);

  // creation form states
  const [mode, setMode] = useState("view"); // view | create
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [split, setSplit] = useState({ train: 80, val: 10, test: 10 });
  const [preproc, setPreproc] = useState({ grayscale: false, crop: false, resize: "" });
  const [aug, setAug] = useState({ flipH: false, flipV: false, rotate: "", blur: false, noise: false });

  useEffect(() => {
    (async () => {
      const ds = await db.datasets.get(datasetId);
      setDataset(ds || null);
      const dt = new Date().toISOString().replace(/[:.]/g, "-");
      setName(`${ds?.name || "dataset"}-${dt}`);
      const vs = await db.datasetVersions.where("datasetId").equals(datasetId).toArray();
      setVersions(vs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    })();
  }, [datasetId]);

  const createVersion = async () => {
    const total = Number(split.train) + Number(split.val) + Number(split.test);
    if (total !== 100) return window.alert("Splits must sum to 100");

    const id = generateId?.() || (crypto.randomUUID && crypto.randomUUID());

    // 1. Get current annotations snapshot (optional: if you want to freeze annotations)
    // For now, we just store the split config. 
    // If we wanted to snapshot data, we'd query db.annotations and save them.
    // The user request implies "writing data in database to file folder", which usually means the version config.

    const ver = {
      id, datasetId, name, description,
      splits: { ...split }, preprocessing: preproc, augmentation: aug,
      createdAt: new Date().toISOString(),
    };

    try {
      // DB
      await db.datasetVersions.put(ver);

      // FS
      if (dataset?.folderHandle) {
        await writeVersionFile(dataset.folderHandle, ver);
      } else if (dataset?.name) {
        // Try to get handle from project if missing on dataset object
        const proj = await db.projects.get(dataset.projectId);
        if (proj?.folderHandle) {
          const dsHandle = await proj.folderHandle.getDirectoryHandle(dataset.name).catch(() => null);
          if (dsHandle) await writeVersionFile(dsHandle, ver);
        }
      }

      const vs = await db.datasetVersions.where("datasetId").equals(datasetId).toArray();
      setVersions(vs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
      setSelected(id);
      setMode("view");
      setStep(1);
    } catch (err) {
      console.error("Failed to create version", err);
      alert("Failed to create version");
    }
  };

  const handleDeleteClick = (vid) => {
    setVersionToDelete(vid);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!versionToDelete) return;
    try {
      await db.datasetVersions.delete(versionToDelete);

      // FS Delete
      if (dataset?.folderHandle) {
        await deleteVersionFile(dataset.folderHandle, versionToDelete);
      } else if (dataset?.name) {
        const proj = await db.projects.get(dataset.projectId);
        if (proj?.folderHandle) {
          const dsHandle = await proj.folderHandle.getDirectoryHandle(dataset.name).catch(() => null);
          if (dsHandle) await deleteVersionFile(dsHandle, versionToDelete);
        }
      }

      setVersions(v => v.filter(x => x.id !== versionToDelete));
      if (selected === versionToDelete) setSelected(null);
    } catch (err) {
      console.error("Delete failed", err);
    } finally {
      setShowDeleteModal(false);
      setVersionToDelete(null);
    }
  };

  const exportVersion = (vid) => {
    const v = versions.find(x => x.id === vid);
    if (!v) return;
    const blob = new Blob([JSON.stringify(v, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${v.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportDataset = async (vid) => {
    const v = versions.find(x => x.id === vid);
    if (!v) return;
    if (!window.confirm(`Export dataset version "${v.name}" to YOLO format? This may take a while.`)) return;

    setExporting(true);
    try {
      // We need project object too
      const proj = await db.projects.get(dataset.projectId);
      await exportVersionToYolo(v, dataset, proj);
    } catch (err) {
      console.error("Export failed", err);
      alert("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  };

  // small helper for consistent theme styling
  const styles = {
    container: { display: "flex", color: themeColors.text },
    left: { flex: 1, hight: "70vh", padding: 18, background: themeColors.background, borderRight: `1px solid ${themeColors.border}` },
    right: { width: 360, height: "70vh", padding: 14, background: themeColors.sidebarBg, borderLeft: `1px solid ${themeColors.border}` },
    card: { background: themeColors.cardBg, padding: 14, borderRadius: 10, border: `1px solid ${themeColors.border}` },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }
  };

  return (
    <div style={styles.container}>
      {/* Left: main area */}
      <div style={styles.left}>
        <div style={styles.header}>
          <div>
            <h4 style={{ margin: 0 }}>{dataset?.name || "Dataset"}</h4>
            <small style={{ color: themeColors.subtleText }}>{dataset?.description}</small>
          </div>
          <div>
            <Button size="sm" variant="outline-secondary" onClick={() => { setMode("create"); setSelected(null); }}>+ Create Version</Button>{' '}
            <Button size="sm" variant="primary" onClick={() => { if (selected) exportVersion(selected); }} disabled={!selected}>Export Config</Button>{' '}
            <Button size="sm" variant="success" onClick={() => { if (selected) handleExportDataset(selected); }} disabled={!selected || exporting}>
              {exporting ? "Exporting..." : "Export Dataset (YOLO)"}
            </Button>
          </div>
        </div>

        {/* Creation / Selected Preview area */}
        <div style={{ ...styles.card }}>
          {mode === "view" && !selected && (
            <div style={{ textAlign: "center", padding: 40, color: themeColors.subtleText }}>Select a version from the right to view details, or create a new version.</div>
          )}

          {mode === "view" && selected && (
            (() => {
              const ver = versions.find(v => v.id === selected);
              if (!ver) return <div>Version not found</div>;
              return (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {editName ? (
                        <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)} onBlur={async () => { setEditName(false); await db.datasetVersions.update(selected, { name }); const vs = await db.datasetVersions.where('datasetId').equals(datasetId).toArray(); setVersions(vs); }} />
                      ) : (
                        <h5 style={{ margin: 0 }}>{ver.name}</h5>
                      )}
                      <Button variant="link" size="sm" onClick={() => setEditName(true)} style={{ color: themeColors.text }}><Pencil size={14} /></Button>
                    </div>
                    <Button variant="link" size="sm" onClick={() => handleDeleteClick(selected)} style={{ color: themeColors.danger }} title="Delete"><Trash2 size={16} /></Button>
                  </div>

                  <p style={{ color: themeColors.subtleText }}>{ver.description}</p>

                  <div style={{ display: "flex", gap: 18 }}>
                    <div>
                      <strong>Splits</strong>
                      <div style={{ color: themeColors.subtleText }}>Train: {ver.splits.train}%</div>
                      <div style={{ color: themeColors.subtleText }}>Val: {ver.splits.val}%</div>
                      <div style={{ color: themeColors.subtleText }}>Test: {ver.splits.test}%</div>
                    </div>
                    <div>
                      <strong>Preprocessing</strong>
                      <div style={{ color: themeColors.subtleText }}>{Object.keys(ver.preprocessing || {}).length ? JSON.stringify(ver.preprocessing) : '—'}</div>
                    </div>
                  </div>
                </div>
              );
            })()
          )}

          {mode === "create" && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <div key={n} onClick={() => setStep(n)} style={{ padding: 8, borderRadius: 8, cursor: 'pointer', background: step === n ? themeColors.primary : themeColors.cardBg, color: step === n ? '#fff' : themeColors.text, border: `1px solid ${themeColors.border}` }}>
                    {step > n ? <CheckCircle2 size={14} /> : <Settings size={14} />} <small style={{ marginLeft: 6 }}>{['Info', 'Split', 'Preprocess', 'Augment', 'Finish'][n - 1]}</small>
                  </div>
                ))}
              </div>

              {step === 1 && (
                <div>
                  <Form.Group>
                    <Form.Label>Version Name</Form.Label>
                    <Form.Control value={name} onChange={e => setName(e.target.value)} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Description</Form.Label>
                    <Form.Control as="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
                  </Form.Group>
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button onClick={() => setStep(2)}>Next</Button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <Form.Group>
                    <Form.Label>Train %</Form.Label>
                    <Form.Control type="number" value={split.train} onChange={e => setSplit({ ...split, train: Number(e.target.value) })} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Val %</Form.Label>
                    <Form.Control type="number" value={split.val} onChange={e => setSplit({ ...split, val: Number(e.target.value) })} />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Test %</Form.Label>
                    <Form.Control type="number" value={split.test} onChange={e => setSplit({ ...split, test: Number(e.target.value) })} />
                  </Form.Group>
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                    <Button onClick={() => setStep(3)}>Next</Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <Form.Group>
                    <Form.Check type="checkbox" label="Grayscale" checked={preproc.grayscale} onChange={e => setPreproc({ ...preproc, grayscale: e.target.checked })} />
                    <Form.Check type="checkbox" label="Crop annotated object" checked={preproc.crop} onChange={e => setPreproc({ ...preproc, crop: e.target.checked })} />
                    <Form.Group style={{ marginTop: 8 }}>
                      <Form.Label>Resize (WxH)</Form.Label>
                      <Form.Control value={preproc.resize} onChange={e => setPreproc({ ...preproc, resize: e.target.value })} />
                    </Form.Group>
                  </Form.Group>
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
                    <Button onClick={() => setStep(4)}>Next</Button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div>
                  <Form.Check type="checkbox" label="Flip Horizontal" checked={aug.flipH} onChange={e => setAug({ ...aug, flipH: e.target.checked })} />
                  <Form.Check type="checkbox" label="Flip Vertical" checked={aug.flipV} onChange={e => setAug({ ...aug, flipV: e.target.checked })} />
                  <Form.Group style={{ marginTop: 8 }}>
                    <Form.Label>Rotation range</Form.Label>
                    <Form.Control value={aug.rotate} onChange={e => setAug({ ...aug, rotate: e.target.value })} />
                  </Form.Group>
                  <Form.Check type="checkbox" label="Blur" checked={aug.blur} onChange={e => setAug({ ...aug, blur: e.target.checked })} />
                  <Form.Check type="checkbox" label="Add Noise" checked={aug.noise} onChange={e => setAug({ ...aug, noise: e.target.checked })} />

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
                    <Button onClick={() => setStep(5)}>Next</Button>
                  </div>
                </div>
              )}

              {step === 5 && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: 12 }}>Ready to create version with these settings.</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <Button variant="secondary" onClick={() => setStep(4)}>Back</Button>
                    <Button onClick={createVersion}>Create Version</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* delete confirmation modal-like inline panel */}
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
      </div>

      {/* Right: versions list (fixed right sidebar) */}
      <div style={styles.right}>
        <h5 style={{ marginTop: 0 }}>All Versions</h5>
        <ListGroup style={{ border: `1px solid ${themeColors.border}`, borderRadius: 8, overflow: 'auto', maxHeight: '78vh' }}>
          {versions.length === 0 && <div style={{ padding: 16, color: themeColors.subtleText }}>No versions yet. Create one.</div>}
          {versions.map(v => (
            <ListGroup.Item key={v.id} action style={{ background: selected === v.id ? themeColors.primary : themeColors.cardBg, color: selected === v.id ? '#fff' : themeColors.text, borderBottom: `1px solid ${themeColors.border}` }} onClick={() => { setSelected(v.id); setMode('view'); }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{v.name}</div>
                  <div style={{ fontSize: 12, color: themeColors.subtleText }}>{new Date(v.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button variant="link" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(v.id); setMode('view'); setEditName(true); }} title="Edit name"><Pencil size={14} /></Button>
                  <Button variant="link" size="sm" onClick={(e) => { e.stopPropagation(); handleDeleteClick(v.id); }} title="Delete"><Trash2 size={14} color={themeColors.danger} /></Button>
                </div>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </div>
    </div>
  );
}
