import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  Button, Form, InputGroup, Badge, Modal, ProgressBar, Spinner, Tab, Tabs,
} from "react-bootstrap";
import {
  Tag, Layers, Pencil, Trash2, Merge, CheckCircle,
} from "lucide-react";
import { db } from "../../utils/db";
import { useTheme } from "../../components/ThemeContext";
import AppModal from "../../components/AppModal";
import {
  readDatasetClasses, writeDatasetClasses,
  readDatasetTags, writeDatasetTags,
  mergeClassInAnnotations, deleteClassFromAnnotations,
} from "../../utils/fs";

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 9);
const colorForName = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  return `hsl(${Math.abs(h) % 360} 65% 55%)`;
};

export default function ClassesTagsPage() {
  const { projectId, datasetId } = useParams();
  const { themeColors } = useTheme();

  const [dataset, setDataset] = useState(null);
  const [project, setProject] = useState(null);
  const [dsFolder, setDsFolder] = useState(null);

  const [classes, setClasses] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editColor, setEditColor] = useState("#888");

  // New item state
  const [newClassName, setNewClassName] = useState("");
  const [newClassColor, setNewClassColor] = useState("#4ecdc4");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#f7931e");

  // Merge state
  const [mergeSource, setMergeSource] = useState(null); // class being merged FROM
  const [mergeTarget, setMergeTarget] = useState("");

  // Progress state
  const [progress, setProgress] = useState(null); // { current, total, file, label }
  const [progressDone, setProgressDone] = useState(null);

  // AppModal
  const [modal, setModal] = useState({ show: false });
  const openModal = (d) => setModal({ ...modal, ...d, show: true });
  const closeModal = () => setModal((m) => ({ ...m, show: false }));

  // -----------------------------------------------------------------------
  // Load
  // -----------------------------------------------------------------------
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [proj, ds] = await Promise.all([
          db.projects.get(projectId),
          db.datasets.get(datasetId),
        ]);
        setProject(proj || null);
        setDataset(ds || null);

        const folder = ds?.folderHandle ||
          (proj?.folderHandle ? await proj.folderHandle.getDirectoryHandle(ds?.name).catch(() => null) : null);
        setDsFolder(folder);

        if (folder) {
          const [cls, tgs] = await Promise.all([
            readDatasetClasses(folder),
            readDatasetTags(folder),
          ]);
          setClasses(cls);
          setTags(tgs);
        }
      } catch (e) {
        console.error("ClassesTagsPage load error:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId, datasetId]);

  // -----------------------------------------------------------------------
  // Helpers: persist to disk
  // -----------------------------------------------------------------------
  const saveClasses = async (updated) => {
    setClasses(updated);
    if (dsFolder) await writeDatasetClasses(dsFolder, updated);
  };

  const saveTags = async (updated) => {
    setTags(updated);
    if (dsFolder) await writeDatasetTags(dsFolder, updated);
  };

  // -----------------------------------------------------------------------
  // CLASS ACTIONS
  // -----------------------------------------------------------------------
  const addNewClass = async () => {
    const name = newClassName.trim();
    if (!name || classes.some(c => c.name === name)) return;
    const cls = { id: uid(), name, color: newClassColor || colorForName(name) };
    await saveClasses([...classes, cls]);
    setNewClassName("");
    setNewClassColor("#4ecdc4");
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditValue(item.name);
    setEditColor(item.color);
  };

  const commitEditClass = async () => {
    const name = editValue.trim();
    if (!name) { cancelEdit(); return; }
    await saveClasses(classes.map(c => c.id === editingId ? { ...c, name, color: editColor } : c));
    cancelEdit();
  };

  const commitEditTag = async () => {
    const name = editValue.trim();
    if (!name) { cancelEdit(); return; }
    await saveTags(tags.map(t => t.id === editingId ? { ...t, name, color: editColor } : t));
    cancelEdit();
  };

  const cancelEdit = () => { setEditingId(null); setEditValue(""); setEditColor("#888"); };

  const deleteClass = (cls) => {
    openModal({
      type: "warning",
      title: `Delete class "${cls.name}"?`,
      message: `This will permanently delete ALL annotations with this class across the entire dataset. This cannot be undone.`,
      confirmText: "Delete & Remove Annotations",
      onConfirm: async () => {
        closeModal();
        setProgress({ label: `Deleting annotations for "${cls.name}"…`, current: 0, total: 0 });
        try {
          if (dsFolder) {
            await deleteClassFromAnnotations(dsFolder, cls.id, (p) =>
              setProgress({ label: `Removing annotations…`, current: p.current, total: p.total, file: p.file })
            );
          }
          
          // Modify Dexie DB to mirror FS changes instantly
          await db.annotations.filter(a => Array.isArray(a.data) && a.data.some(d => d.classId === cls.id))
            .modify(a => {
               a.data = a.data.filter(d => d.classId !== cls.id);
            });

          await saveClasses(classes.filter(c => c.id !== cls.id));
          setProgressDone(`Done — class "${cls.name}" deleted.`);
        } catch (e) {
          openModal({ type: "error", title: "Error", message: e.message });
        } finally {
          setProgress(null);
        }
      },
    });
  };

  const startMerge = (cls) => {
    setMergeSource(cls);
    setMergeTarget("");
  };

  const executeMerge = async () => {
    if (!mergeTarget || mergeTarget === mergeSource.id) return;
    const targetCls = classes.find(c => c.id === mergeTarget);
    openModal({
      type: "warning",
      title: "Merge classes?",
      message: `All annotations of "${mergeSource.name}" will become "${targetCls.name}". Class "${mergeSource.name}" will be removed.`,
      confirmText: "Merge",
      onConfirm: async () => {
        closeModal();
        setProgress({ label: `Merging "${mergeSource.name}" → "${targetCls.name}"…`, current: 0, total: 0 });
        try {
          if (dsFolder) {
            await mergeClassInAnnotations(dsFolder, mergeSource.id, mergeTarget, (p) =>
              setProgress({ label: `Rewriting annotations…`, current: p.current, total: p.total, file: p.file })
            );
          }

          // Modify Dexie DB to mirror FS changes instantly
          await db.annotations.filter(a => Array.isArray(a.data) && a.data.some(d => d.classId === mergeSource.id))
            .modify(a => {
               a.data = a.data.map(d => d.classId === mergeSource.id ? { ...d, classId: mergeTarget } : d);
            });

          await saveClasses(classes.filter(c => c.id !== mergeSource.id));
          setMergeSource(null);
          setProgressDone(`Done — "${mergeSource.name}" merged into "${targetCls.name}".`);
        } catch (e) {
          openModal({ type: "error", title: "Error", message: e.message });
        } finally {
          setProgress(null);
        }
      },
    });
  };

  // -----------------------------------------------------------------------
  // TAG ACTIONS
  // -----------------------------------------------------------------------
  const addNewTag = async () => {
    const name = newTagName.trim();
    if (!name || tags.some(t => t.name === name)) return;
    const tag = { id: uid(), name, color: newTagColor || colorForName(name) };
    await saveTags([...tags, tag]);
    setNewTagName("");
    setNewTagColor("#f7931e");
  };

  const deleteTag = (tag) => {
    openModal({
      type: "warning",
      title: `Delete tag "${tag.name}"?`,
      message: "This removes the tag from the dictionary. Image meta files that reference this tag ID will retain it but it will show as unknown.",
      confirmText: "Delete Tag",
      onConfirm: async () => {
        closeModal();
        await saveTags(tags.filter(t => t.id !== tag.id));
      },
    });
  };

  // -----------------------------------------------------------------------
  // MIGRATION
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  const card = {
    background: themeColors?.cardBg || "#1e1e2e",
    border: `1px solid ${themeColors?.border || "#333"}`,
    borderRadius: 10,
    padding: "16px 20px",
  };

  const rowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 8,
    marginBottom: 6,
    border: `1px solid ${themeColors?.border || "#333"}`,
    background: themeColors?.inputBg || "#252535",
  };

  if (loading) return (
    <div className="d-flex justify-content-center align-items-center" style={{ height: 200 }}>
      <Spinner animation="border" />
    </div>
  );

  // -----------------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------------
  return (
    <div style={{ padding: "24px", maxWidth: 800, margin: "0 auto" }}>
      <h4 style={{ color: themeColors?.text, marginBottom: 4 }}>
        <Layers size={20} style={{ marginRight: 8 }} />
        Classes &amp; Tags
      </h4>
      <p style={{ color: themeColors?.subtleText, fontSize: 13, marginBottom: 24 }}>
        Manage class and tag dictionaries for <strong>{dataset?.name}</strong>.
        Changes to class names and colors apply instantly — no per-annotation rewriting needed.
      </p>

      {/* Progress bar (shown during bulk operations) */}
      {progress && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ color: themeColors?.text, fontSize: 13, marginBottom: 8 }}>{progress.label}</div>
          {progress.total > 0
            ? <ProgressBar now={Math.round((progress.current / progress.total) * 100)} label={`${progress.current}/${progress.total}`} animated />
            : <ProgressBar animated now={100} label="Working…" />}
          {progress.file && <div style={{ color: themeColors?.subtleText, fontSize: 11, marginTop: 4 }}>{progress.file}</div>}
        </div>
      )}
      {progressDone && !progress && (
        <div style={{ ...card, marginBottom: 16, borderColor: "#22c55e", display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle size={18} color="#22c55e" />
          <span style={{ color: "#22c55e", fontSize: 13 }}>{progressDone}</span>
        </div>
      )}

      <Tabs 
        defaultActiveKey="classes" 
        className="custom-hex-tabs mb-3"
        style={{ borderBottom: `1px solid ${themeColors?.border}` }}
      >

        {/* ================================================================
            TAB: CLASSES
        ================================================================ */}
        <Tab eventKey="classes" title={<span><Layers size={14} style={{ marginRight: 5 }} />Classes ({classes.length})</span>}>

          {/* Add new class */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ color: themeColors?.text, fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Add New Class</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={newClassColor}
                onChange={e => setNewClassColor(e.target.value)}
                style={{ width: 36, height: 34, padding: 2, borderRadius: 6, border: "1px solid #555", cursor: "pointer" }}
              />
              <Form.Control
                size="sm"
                placeholder="Class name (e.g. ball)"
                value={newClassName}
                onChange={e => setNewClassName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addNewClass()}
                style={{ background: themeColors?.inputBg, color: themeColors?.text, border: `1px solid ${themeColors?.border}` }}
              />
              <Button size="sm" variant="primary" onClick={addNewClass} disabled={!newClassName.trim()}>
                Add
              </Button>
            </div>
          </div>

          {/* Class list */}
          <div style={card}>
            {classes.length === 0 ? (
              <div style={{ color: themeColors?.subtleText, textAlign: "center", padding: 24, fontSize: 13 }}>
                No classes yet. Add one above or run the Annotation Migration tool.
              </div>
            ) : (
              classes.map(cls => (
                <div key={cls.id} style={rowStyle}>
                  {editingId === cls.id ? (
                    /* EDIT ROW */
                    <>
                      <input
                        type="color"
                        value={editColor}
                        onChange={e => setEditColor(e.target.value)}
                        style={{ width: 32, height: 30, padding: 2, borderRadius: 5, border: "1px solid #555", cursor: "pointer", flexShrink: 0 }}
                      />
                      <Form.Control
                        size="sm"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") commitEditClass(); if (e.key === "Escape") cancelEdit(); }}
                        autoFocus
                        style={{ background: themeColors?.inputBg, color: themeColors?.text, border: `1px solid ${themeColors?.border}` }}
                      />
                      <Button size="sm" variant="success" onClick={commitEditClass}>Save</Button>
                      <Button size="sm" variant="outline-secondary" onClick={cancelEdit}>Cancel</Button>
                    </>
                  ) : mergeSource?.id === cls.id ? (
                    /* MERGE ROW */
                    <>
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: cls.color, flexShrink: 0 }} />
                      <span style={{ color: themeColors?.text, fontSize: 13, flex: 1 }}>{cls.name}</span>
                      <span style={{ color: themeColors?.subtleText, fontSize: 12 }}>→ Merge into:</span>
                      <Form.Select
                        size="sm"
                        value={mergeTarget}
                        onChange={e => setMergeTarget(e.target.value)}
                        style={{ background: themeColors?.inputBg, color: themeColors?.text, border: `1px solid ${themeColors?.border}`, maxWidth: 160 }}
                      >
                        <option value="">— pick class —</option>
                        {classes.filter(c => c.id !== cls.id).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </Form.Select>
                      <Button size="sm" variant="warning" onClick={executeMerge} disabled={!mergeTarget}>Merge</Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => setMergeSource(null)}>Cancel</Button>
                    </>
                  ) : (
                    /* NORMAL ROW */
                    <>
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: cls.color, flexShrink: 0 }} />
                      <span style={{ color: themeColors?.text, fontSize: 13, flex: 1 }}>{cls.name}</span>
                      <Button size="sm" variant="outline-secondary" title="Edit name/color" onClick={() => startEdit(cls)}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="sm" variant="outline-primary" title="Merge into another class" onClick={() => startMerge(cls)}>
                        <Merge size={13} />
                      </Button>
                      <Button size="sm" variant="outline-danger" title="Delete class & all its annotations" onClick={() => deleteClass(cls)}>
                        <Trash2 size={13} />
                      </Button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </Tab>

        {/* ================================================================
            TAB: TAGS
        ================================================================ */}
        <Tab eventKey="tags" title={<span><Tag size={14} style={{ marginRight: 5 }} />Tags ({tags.length})</span>}>

          {/* Add new tag */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ color: themeColors?.text, fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Add New Tag</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={newTagColor}
                onChange={e => setNewTagColor(e.target.value)}
                style={{ width: 36, height: 34, padding: 2, borderRadius: 6, border: "1px solid #555", cursor: "pointer" }}
              />
              <Form.Control
                size="sm"
                placeholder="Tag name (e.g. blurry)"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addNewTag()}
                style={{ background: themeColors?.inputBg, color: themeColors?.text, border: `1px solid ${themeColors?.border}` }}
              />
              <Button size="sm" variant="primary" onClick={addNewTag} disabled={!newTagName.trim()}>
                Add
              </Button>
            </div>
          </div>

          {/* Tag list */}
          <div style={card}>
            {tags.length === 0 ? (
              <div style={{ color: themeColors?.subtleText, textAlign: "center", padding: 24, fontSize: 13 }}>
                No tags yet. Add one above.
              </div>
            ) : (
              tags.map(tag => (
                <div key={tag.id} style={rowStyle}>
                  {editingId === tag.id ? (
                    <>
                      <input
                        type="color"
                        value={editColor}
                        onChange={e => setEditColor(e.target.value)}
                        style={{ width: 32, height: 30, padding: 2, borderRadius: 5, border: "1px solid #555", cursor: "pointer", flexShrink: 0 }}
                      />
                      <Form.Control
                        size="sm"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") commitEditTag(); if (e.key === "Escape") cancelEdit(); }}
                        autoFocus
                        style={{ background: themeColors?.inputBg, color: themeColors?.text, border: `1px solid ${themeColors?.border}` }}
                      />
                      <Button size="sm" variant="success" onClick={commitEditTag}>Save</Button>
                      <Button size="sm" variant="outline-secondary" onClick={cancelEdit}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: tag.color, flexShrink: 0 }} />
                      <span style={{ color: themeColors?.text, fontSize: 13, flex: 1 }}>{tag.name}</span>
                      <Button size="sm" variant="outline-secondary" title="Edit name/color" onClick={() => startEdit(tag)}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="sm" variant="outline-danger" title="Delete tag" onClick={() => deleteTag(tag)}>
                        <Trash2 size={13} />
                      </Button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </Tab>

      </Tabs>

      <AppModal {...modal} onClose={closeModal} />
    </div>
  );
}
