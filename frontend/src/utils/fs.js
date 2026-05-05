// src/utils/fs.js
// Filesystem helpers for HexLabel (Project & Dataset metadata + folder operations)

import { db } from "./db";

/**
 * createDatasetFolderStructure
 * Creates dataset folder structure:
 *  /DatasetName/
 *     dataset.json
 *     images/
 *       raw/
 *       thumbs/
 *     annotations/
 *     jobs/
 *
 * Returns an object with handles (datasetHandle, imagesRawHandle, imagesThumbsHandle)
 */
export async function createDatasetFolderStructure(projectFolderHandle, datasetMeta) {
  if (!projectFolderHandle) throw new Error("projectFolderHandle missing");

  // create dataset root
  const datasetHandle = await projectFolderHandle.getDirectoryHandle(datasetMeta.name, { create: true });

  // create images/raw, images/thumbs, images/meta
  const imagesHandle = await datasetHandle.getDirectoryHandle("images", { create: true });
  const rawHandle = await imagesHandle.getDirectoryHandle("raw", { create: true });
  const thumbsHandle = await imagesHandle.getDirectoryHandle("thumbs", { create: true });
  await imagesHandle.getDirectoryHandle("meta", { create: true });

  // create annotations and jobs folders
  await datasetHandle.getDirectoryHandle("annotations", { create: true });
  await datasetHandle.getDirectoryHandle("jobs", { create: true });

  // write dataset.json
  await writeDatasetMetadata(datasetHandle, datasetMeta);

  return {
    datasetHandle,
    imagesHandle,
    rawHandle,
    thumbsHandle,
  };
}

/**
 * writeDatasetMetadata
 * datasetHandle is a DirectoryHandle pointing to dataset folder
 * datasetMeta is an object matching dataset.json schema
 */
export async function writeDatasetMetadata(datasetHandle, datasetMeta) {
  if (!datasetHandle) throw new Error("datasetHandle missing");

  const fh = await datasetHandle.getFileHandle("dataset.json", { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(datasetMeta, null, 2));
  await writable.close();
}

/**
 * readDatasetMetadata
 */
export async function readDatasetMetadata(datasetHandle) {
  if (!datasetHandle) throw new Error("datasetHandle missing");
  try {
    const fh = await datasetHandle.getFileHandle("dataset.json");
    const file = await fh.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    // no dataset.json or read error
    return null;
  }
}

/**
 * writeProjectMetadata
 * Writes a hexlabel.project.json at project root
 * projectMeta should include datasets: [{ id, name, type, createdAt, ...}, ...]
 */
export async function writeProjectMetadata(projectFolderHandle, projectMeta) {
  if (!projectFolderHandle) throw new Error("projectFolderHandle missing");
  const fh = await projectFolderHandle.getFileHandle("hexlabel.project.json", { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(projectMeta, null, 2));
  await writable.close();
}

/**
 * readProjectMetadata
 */
export async function readProjectMetadata(projectFolderHandle) {
  if (!projectFolderHandle) throw new Error("projectFolderHandle missing");
  try {
    const fh = await projectFolderHandle.getFileHandle("hexlabel.project.json");
    const file = await fh.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

/**
 * addDatasetToProjectMeta
 * Reads project meta, pushes dataset entry (if not exists) and writes back.
 * datasetSummary should be { id, name, type, createdAt, description, imageCount }
 */
export async function addDatasetToProjectMeta(projectFolderHandle, datasetSummary) {
  const meta = (await readProjectMetadata(projectFolderHandle)) || {
    id: null,
    name: projectFolderHandle.name || "",
    description: "",
    datasets: [],
  };

  // ensure no duplicate by id or name
  const exists = meta.datasets?.find((d) => d.id === datasetSummary.id || d.name === datasetSummary.name);
  if (!exists) {
    meta.datasets = meta.datasets || [];
    meta.datasets.push(datasetSummary);
    await writeProjectMetadata(projectFolderHandle, meta);
  } else {
    // update existing summary (e.g. imageCount changed)
    meta.datasets = meta.datasets.map((d) => (d.id === datasetSummary.id || d.name === datasetSummary.name ? { ...d, ...datasetSummary } : d));
    await writeProjectMetadata(projectFolderHandle, meta);
  }
  return meta;
}

/**
 * removeDatasetFromProjectMeta
 */
export async function removeDatasetFromProjectMeta(projectFolderHandle, datasetNameOrId) {
  const meta = (await readProjectMetadata(projectFolderHandle)) || null;
  if (!meta) return null;
  meta.datasets = (meta.datasets || []).filter((d) => d.id !== datasetNameOrId && d.name !== datasetNameOrId);
  await writeProjectMetadata(projectFolderHandle, meta);
  return meta;
}

/**
 * scanDatasetsFromProjectFolder
 * Reads each directory inside project folder, finds dataset.json in each and returns array of dataset summaries.
 */
export async function scanDatasetsFromProjectFolder(projectFolderHandle) {
  const datasets = [];
  for await (const entry of projectFolderHandle.values()) {
    if (entry.kind === "directory") {
      try {
        const dirHandle = await projectFolderHandle.getDirectoryHandle(entry.name);
        const dsMeta = await readDatasetMetadata(dirHandle);
        if (dsMeta) {
          datasets.push({ ...dsMeta, folderName: entry.name });
        } else {
          // fallback: if no dataset.json, create a minimal summary
          // check if images folder exists or annotations exists to infer dataset
          try {
            await dirHandle.getDirectoryHandle("images");
            datasets.push({
              id: dirHandle.name,
              name: dirHandle.name,
              type: "detect",
              description: "",
              projectId: null,
              createdAt: null,
              imageCount: 0,
              annotationVersions: [],
              folderName: dirHandle.name,
            });
          } catch {
            // not a dataset folder
          }
        }
      } catch (err) {
        // ignore
      }
    }
  }
  return datasets;
}

/**
 * syncProjectToIndexedDB
 * Reads project metadata from disk and writes to IndexedDB (projects & datasets).
 * This allows Projects.jsx to load project with its datasets even if DB was empty.
 */
export async function syncProjectToIndexedDB(projectFolderHandle, upsertProject = true) {
  // read project meta
  const projectMeta = await readProjectMetadata(projectFolderHandle);
  if (!projectMeta) throw new Error("Project metadata (hexlabel.project.json) missing");

  // upsert project record
  const toStoreProject = {
    id: projectMeta.id || projectFolderHandle.name,
    name: projectMeta.name || projectFolderHandle.name,
    description: projectMeta.description || "",
    datasets: projectMeta.datasets?.length || 0,
    models: projectMeta.models || 0,
    folderHandle: projectFolderHandle,
    coverImage: projectMeta.coverImage || null,
    createdAt: projectMeta.createdAt || new Date().toISOString(),
  };

  if (upsertProject) await db.projects.put(toStoreProject);

  // datasets may be either in projectMeta.datasets or scanned from folders
  const diskDatasets = projectMeta.datasets && projectMeta.datasets.length > 0 ? projectMeta.datasets : await scanDatasetsFromProjectFolder(projectFolderHandle);

  for (const ds of diskDatasets) {
    const dsId = ds.id || ds.name;
    const datasetRecord = {
      id: dsId,
      name: ds.name,
      description: ds.description || "",
      type: ds.type || "detect",
      projectId: toStoreProject.id,
      folderHandle: projectFolderHandle ? await projectFolderHandle.getDirectoryHandle(ds.name).catch(() => null) : null,
      coverImage: ds.coverImage || null,
      createdAt: ds.createdAt || new Date().toISOString(),
      imageCount: ds.imageCount || 0,
      annotationVersions: ds.annotationVersions || [],
    };
    await db.datasets.put(datasetRecord);
  }

  return { project: toStoreProject, datasets: diskDatasets };
}


// Write job metadata inside /jobs/
export async function writeJobFile(datasetHandle, job) {
  const jobsFolder = await datasetHandle.getDirectoryHandle("jobs", { create: true });

  const fh = await jobsFolder.getFileHandle(`${job.id}.json`, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(job, null, 2));
  await writable.close();
}

// Read job file
export async function readJobFile(datasetHandle, jobId) {
  const jobsFolder = await datasetHandle.getDirectoryHandle("jobs");
  const fh = await jobsFolder.getFileHandle(`${jobId}.json`);
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

// Delete job file
export async function deleteJobFile(datasetHandle, jobId) {
  const jobsFolder = await datasetHandle.getDirectoryHandle("jobs");

  await jobsFolder.removeEntry(`${jobId}.json`);
}

// Write version metadata inside /versions/
export async function writeVersionFile(datasetHandle, version) {
  const versionsFolder = await datasetHandle.getDirectoryHandle("versions", { create: true });
  const vDir = await versionsFolder.getDirectoryHandle(version.id, { create: true });
  const fh = await vDir.getFileHandle(`version.json`, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(version, null, 2));
  await writable.close();
}

/**
 * createVersionSnapshot
 * Copies raw images and active annotations into a versioned subfolder.
 * Also snapshots current classes and tags into version.json.
 */
export async function createVersionSnapshot(datasetHandle, version, imageIds) {
  if (!datasetHandle) return;
  const versionsFolder = await datasetHandle.getDirectoryHandle("versions", { create: true });
  const vDir = await versionsFolder.getDirectoryHandle(version.id, { create: true });

  // 1. Snapshot metadata with classes & tags
  const meta = (await readDatasetMetadata(datasetHandle)) || {};
  const versionWithMetadata = {
    ...version,
    classes: meta.classes || [],
    tags: meta.tags || [],
  };
  const mfh = await vDir.getFileHandle("version.json", { create: true });
  const mw = await mfh.createWritable();
  await mw.write(JSON.stringify(versionWithMetadata, null, 2));
  await mw.close();

  // 2. Copy Images
  const srcImagesDir = await datasetHandle.getDirectoryHandle("images").catch(() => null);
  const srcRawDir = srcImagesDir ? await srcImagesDir.getDirectoryHandle("raw").catch(() => null) : null;
  if (srcRawDir) {
    const destImagesDir = await vDir.getDirectoryHandle("images", { create: true });
    const destRawDir = await destImagesDir.getDirectoryHandle("raw", { create: true });

    for (const imageId of imageIds) {
      // Find image record to get filename
      const img = await db.images.get(imageId);
      if (!img) continue;
      try {
        const srcFh = await srcRawDir.getFileHandle(img.name);
        const destFh = await destRawDir.getFileHandle(img.name, { create: true });
        const file = await srcFh.getFile();
        const w = await destFh.createWritable();
        await w.write(file);
        await w.close();
      } catch (e) { console.warn("Could not copy image for version:", img.name, e); }
    }
  }

  // 3. Copy Annotations
  const srcAnnsDir = await datasetHandle.getDirectoryHandle("annotations").catch(() => null);
  const srcActiveDir = srcAnnsDir ? await srcAnnsDir.getDirectoryHandle("active").catch(() => null) : null;
  if (srcActiveDir) {
    const destAnnsDir = await vDir.getDirectoryHandle("annotations", { create: true });
    // We put them in a flat folder inside the version directory for simplicity
    for (const imageId of imageIds) {
      try {
        const srcFh = await srcActiveDir.getFileHandle(`${imageId}.json`);
        const destFh = await destAnnsDir.getFileHandle(`${imageId}.json`, { create: true });
        const file = await srcFh.getFile();
        const w = await destFh.createWritable();
        await w.write(file);
        await w.close();
      } catch (e) { /* skip if no annotation exists */ }
    }
  }
}

// Read version file
export async function readVersionFile(datasetHandle, versionId) {
  const versionsFolder = await datasetHandle.getDirectoryHandle("versions");
  const vDir = await versionsFolder.getDirectoryHandle(versionId);
  const fh = await vDir.getFileHandle(`version.json`);
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

// Delete version folder
export async function deleteVersionFile(datasetHandle, versionId) {
  try {
    const versionsFolder = await datasetHandle.getDirectoryHandle("versions");
    await versionsFolder.removeEntry(versionId, { recursive: true });
    // Also try to delete legacy single-file version if it exists
    await versionsFolder.removeEntry(`${versionId}.json`).catch(() => {});
  } catch (e) {
    console.warn("Failed to delete version folder", e);
  }
}

/**
 * scanVersionsFromDatasetFolder
 * Scans /versions/ folder for JSON files and returns them
 */
export async function scanVersionsFromDatasetFolder(datasetHandle) {
  const versions = [];
  try {
    const versionsFolder = await datasetHandle.getDirectoryHandle("versions");
    for await (const entry of versionsFolder.values()) {
      if (entry.kind === "directory") {
        try {
          const vDir = await versionsFolder.getDirectoryHandle(entry.name);
          const fh = await vDir.getFileHandle("version.json");
          const file = await fh.getFile();
          const text = await file.text();
          const ver = JSON.parse(text);
          if (ver && ver.id) {
            versions.push(ver);
          }
        } catch (err) { /* skip directory without version.json */ }
      }
      // Backward compatibility for old single-file versions
      if (entry.kind === "file" && entry.name.endsWith(".json")) {
        try {
          const file = await entry.getFile();
          const text = await file.text();
          const ver = JSON.parse(text);
          if (ver && ver.id) versions.push(ver);
        } catch (err) { /* skip */ }
      }
    }
  } catch (err) {
    // versions folder might not exist
  }
  return versions;
}
// Write per-image metadata to images/meta/<imageId>.json
export async function writeImageMeta(datasetHandle, imageMeta) {
  if (!datasetHandle) return;
  try {
    const imagesFolder = await datasetHandle.getDirectoryHandle("images", { create: true });
    const metaFolder = await imagesFolder.getDirectoryHandle("meta", { create: true });
    const fh = await metaFolder.getFileHandle(`${imageMeta.id}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(imageMeta, null, 2));
    await w.close();
  } catch (err) {
    console.warn("writeImageMeta failed:", err);
  }
}

// Read per-image metadata from images/meta/<imageId>.json
export async function readImageMeta(datasetHandle, imageId) {
  if (!datasetHandle) return null;
  try {
    const imagesFolder = await datasetHandle.getDirectoryHandle("images");
    const metaFolder = await imagesFolder.getDirectoryHandle("meta");
    const fh = await metaFolder.getFileHandle(`${imageId}.json`);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

/**
 * scanImageMetaFromDataset
 * Scans images/meta/ and returns all image metadata objects.
 * Used to rebuild IndexedDB if it was cleared.
 */
export async function scanImageMetaFromDataset(datasetHandle) {
  const results = [];
  try {
    const imagesFolder = await datasetHandle.getDirectoryHandle("images");
    const metaFolder = await imagesFolder.getDirectoryHandle("meta");
    for await (const entry of metaFolder.values()) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      try {
        const file = await entry.getFile();
        const meta = JSON.parse(await file.text());
        if (meta?.id) results.push(meta);
      } catch { /* skip corrupt files */ }
    }
  } catch { /* meta folder doesn't exist yet */ }
  return results;
}

// ---------------------------------------------------------------------------
// CLASS DICTIONARY
// ---------------------------------------------------------------------------

/** Read classes array from dataset.json */
export async function readDatasetClasses(datasetHandle) {
  const meta = await readDatasetMetadata(datasetHandle);
  return meta?.classes ?? [];
}

/** Write (replace) classes array in dataset.json */
export async function writeDatasetClasses(datasetHandle, classes) {
  const meta = (await readDatasetMetadata(datasetHandle)) || {};
  meta.classes = classes;
  await writeDatasetMetadata(datasetHandle, meta);
}

/** Add a single class to dataset.json if it doesn't exist already */
export async function addDatasetClass(datasetHandle, cls) {
  const classes = await readDatasetClasses(datasetHandle);
  const exists = classes.find(c => c.id === cls.id || c.name === cls.name);
  if (exists) return exists;
  classes.push(cls);
  await writeDatasetClasses(datasetHandle, classes);
  return cls;
}

/**
 * Rewrite all active annotation files: replace every occurrence of fromClassId
 * with toClassId. Used for Merge.
 * Returns count of files updated.
 */
export async function mergeClassInAnnotations(datasetHandle, fromClassId, toClassId, onProgress) {
  let updated = 0;
  try {
    const annotationsDir = await datasetHandle.getDirectoryHandle("annotations");
    const activeDir = await annotationsDir.getDirectoryHandle("active");
    const files = [];
    for await (const entry of activeDir.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".json")) files.push(entry.name);
    }
    for (let i = 0; i < files.length; i++) {
      const fname = files[i];
      onProgress?.({ current: i + 1, total: files.length, file: fname });
      try {
        const fh = await activeDir.getFileHandle(fname);
        const file = await fh.getFile();
        const data = JSON.parse(await file.text());
        let changed = false;
        if (Array.isArray(data.annotations)) {
          data.annotations = data.annotations.map(a => {
            if (a.classId === fromClassId) { changed = true; return { ...a, classId: toClassId }; }
            return a;
          });
        }
        if (changed) {
          const wfh = await activeDir.getFileHandle(fname, { create: true });
          const w = await wfh.createWritable();
          await w.write(JSON.stringify(data, null, 2));
          await w.close();
          updated++;
        }
      } catch { /* skip corrupt file */ }
    }
  } catch { /* no annotations/active folder */ }
  return updated;
}

/**
 * Delete all annotations with a given classId from all active annotation files.
 * Used when a class is deleted.
 * Returns count of files updated.
 */
export async function deleteClassFromAnnotations(datasetHandle, classId, onProgress) {
  let updated = 0;
  try {
    const annotationsDir = await datasetHandle.getDirectoryHandle("annotations");
    const activeDir = await annotationsDir.getDirectoryHandle("active");
    const files = [];
    for await (const entry of activeDir.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".json")) files.push(entry.name);
    }
    for (let i = 0; i < files.length; i++) {
      const fname = files[i];
      onProgress?.({ current: i + 1, total: files.length, file: fname });
      try {
        const fh = await activeDir.getFileHandle(fname);
        const file = await fh.getFile();
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.annotations)) continue;
        const before = data.annotations.length;
        data.annotations = data.annotations.filter(a => a.classId !== classId);
        if (data.annotations.length !== before) {
          const wfh = await activeDir.getFileHandle(fname, { create: true });
          const w = await wfh.createWritable();
          await w.write(JSON.stringify(data, null, 2));
          await w.close();
          updated++;
        }
      } catch { /* skip */ }
    }
  } catch { /* no annotations/active */ }
  return updated;
}

// ---------------------------------------------------------------------------
// TAG DICTIONARY
// ---------------------------------------------------------------------------

/** Read tags array from dataset.json */
export async function readDatasetTags(datasetHandle) {
  const meta = await readDatasetMetadata(datasetHandle);
  return meta?.tags ?? [];
}

/** Write (replace) tags array in dataset.json */
export async function writeDatasetTags(datasetHandle, tags) {
  const meta = (await readDatasetMetadata(datasetHandle)) || {};
  meta.tags = tags;
  await writeDatasetMetadata(datasetHandle, meta);
}

/** Update tagIds on a single image's meta file */
export async function updateImageMetaTags(datasetHandle, imageId, tagIds) {
  const meta = await readImageMeta(datasetHandle, imageId);
  if (!meta) return;
  meta.tagIds = tagIds;
  await writeImageMeta(datasetHandle, meta);
}

// ---------------------------------------------------------------------------
// MIGRATION HELPERS
// ---------------------------------------------------------------------------

/**
 * migrateAnnotationClasses
 *
 * Scans all annotations/active/<imageId>.json files.
 * For each annotation with `className` but no `classId`:
 *   - Finds or creates a class entry in dataset.json
 *   - Rewrites the annotation with `classId`
 * Removes `className` and `color` fields from annotations after migration.
 *
 * @param {FileSystemDirectoryHandle} datasetHandle
 * @param {function} onProgress - callback({ current, total, file })
 * @returns {{ classesCreated: string[], filesUpdated: number }}
 */
export async function migrateAnnotationClasses(datasetHandle, onProgress) {
  const classes = await readDatasetClasses(datasetHandle);
  const classMap = new Map(classes.map(c => [c.name.toLowerCase(), c]));
  let filesUpdated = 0;
  const createId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const colorForLabel = (label) => {
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h << 5) - h + label.charCodeAt(i);
    return `hsl(${Math.abs(h) % 360} 70% 50%)`;
  };

  try {
    const annotationsDir = await datasetHandle.getDirectoryHandle("annotations");
    const activeDir = await annotationsDir.getDirectoryHandle("active");
    const files = [];
    for await (const entry of activeDir.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".json")) files.push(entry.name);
    }

    for (let i = 0; i < files.length; i++) {
      const fname = files[i];
      onProgress?.({ current: i + 1, total: files.length, file: fname });
      try {
        const fh = await activeDir.getFileHandle(fname);
        const file = await fh.getFile();
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.annotations)) continue;

        let changed = false;
        data.annotations = data.annotations.map(a => {
          // Already migrated
          if (a.classId) return a;
          // Has old className
          if (a.className) {
            const key = a.className.toLowerCase();
            if (!classMap.has(key)) {
              // Create new class entry
              const newCls = { id: createId(), name: a.className, color: a.color || colorForLabel(a.className) };
              classMap.set(key, newCls);
              classes.push(newCls);
            }
            const cls = classMap.get(key);
            changed = true;
            // Remove old fields, add classId
            const { className: _cn, color: _c, ...rest } = a;
            return { ...rest, classId: cls.id };
          }
          return a;
        });

        if (changed) {
          // Write updated annotation file
          const wfh = await activeDir.getFileHandle(fname, { create: true });
          const w = await wfh.createWritable();
          await w.write(JSON.stringify(data, null, 2));
          await w.close();
          filesUpdated++;
        }
      } catch { /* skip corrupt */ }
    }
  } catch { /* no annotations/active */ }

  // Write updated classes back to dataset.json
  await writeDatasetClasses(datasetHandle, classes);
  return { classesCreated: classes.map(c => c.name), filesUpdated };
}

/**
 * migrateImageMeta
 *
 * Scans images/raw/ and creates images/meta/<id>.json for any image
 * that doesn't already have a meta file.
 * - If the filename is a UUID (new-style), uses it as the id.
 * - If the filename is a readable name (old-style), uses the filename (without ext) as the id.
 * - Tries to read existing data from `dbImages` array (IndexedDB records passed in).
 *
 * @param {FileSystemDirectoryHandle} datasetHandle
 * @param {Array} dbImages - current db.images records for this dataset
 * @param {string} datasetId
 * @param {function} onProgress
 * @returns {{ created: number }}
 */
export async function migrateImageMeta(datasetHandle, dbImages, datasetId, onProgress) {
  const dbMap = new Map(dbImages.map(img => [img.name, img]));
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let created = 0;

  try {
    const imagesDir = await datasetHandle.getDirectoryHandle("images");
    const rawDir = await imagesDir.getDirectoryHandle("raw");
    const metaDir = await imagesDir.getDirectoryHandle("meta", { create: true });

    const files = [];
    for await (const entry of rawDir.values()) {
      if (entry.kind === "file") files.push(entry.name);
    }

    for (let i = 0; i < files.length; i++) {
      const fname = files[i];
      onProgress?.({ current: i + 1, total: files.length, file: fname });

      // Check if meta file already exists
      const ext = fname.includes(".") ? fname.slice(fname.lastIndexOf(".")) : "";
      const nameWithoutExt = fname.slice(0, fname.length - ext.length);

      try {
        // Already has meta file — skip
        await metaDir.getFileHandle(`${nameWithoutExt}.json`);
        continue;
      } catch { /* no meta file — create it */ }

      // Determine id: if filename is UUID, use it; otherwise use filename without ext
      const id = uuidRe.test(nameWithoutExt) ? nameWithoutExt : nameWithoutExt;

      // Try to get data from DB
      const dbRecord = dbMap.get(fname) || dbImages.find(img => img.id === id);

      const imageMeta = {
        id,
        name: fname,
        originalName: dbRecord?.originalName || fname,
        datasetId,
        jobId: dbRecord?.jobId ?? null,
        tagIds: [],
        createdAt: dbRecord?.createdAt || new Date().toISOString(),
      };

      const fh = await metaDir.getFileHandle(`${id}.json`, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(imageMeta, null, 2));
      await w.close();
      created++;
    }
  } catch (err) {
    console.warn("migrateImageMeta error:", err);
  }

  return { created };
}

/**
 * deleteImageFiles — deletes raw image and its meta file
 */
export async function deleteImageFiles(datasetHandle, imageId, imageName) {
  if (!datasetHandle) return;
  try {
    const imagesFolder = await datasetHandle.getDirectoryHandle("images");
    
    // 1. raw
    try {
      const rawFolder = await imagesFolder.getDirectoryHandle("raw");
      await rawFolder.removeEntry(imageName);
    } catch (e) { console.warn("raw delete failed", imageName, e); }

    // 2. meta
    try {
      const metaFolder = await imagesFolder.getDirectoryHandle("meta");
      await metaFolder.removeEntry(`${imageId}.json`);
    } catch (e) { console.warn("meta delete failed", imageId, e); }
  } catch (err) {
    console.warn("deleteImageFiles error:", err);
  }
}

/**
 * deleteAnnotationFile — deletes annotation file from active/ and all versions/
 * Falls back to various paths and name formats to ensure cleanup.
 */
export async function deleteAnnotationFile(datasetHandle, imageId, imageName = null) {
  if (!datasetHandle) return;
  try {
    const annotationsHandle = await datasetHandle.getDirectoryHandle("annotations").catch(() => null);
    if (!annotationsHandle) return;

    const namesToTry = new Set();
    if (imageId) namesToTry.add(`${imageId}.json`);
    if (imageName) {
      const base = imageName.includes(".") ? imageName.substring(0, imageName.lastIndexOf(".")) : imageName;
      namesToTry.add(`${base}.json`);
      if (imageName.endsWith(".json")) namesToTry.add(imageName);
      else namesToTry.add(`${imageName}.json`);
    }

    const foldersToTry = ["active", "."]; // . means root of annotations/

    for (const folderName of foldersToTry) {
      try {
        const targetFolder = folderName === "." ? annotationsHandle : await annotationsHandle.getDirectoryHandle(folderName).catch(() => null);
        if (!targetFolder) continue;

        for (const fname of namesToTry) {
          try {
            await targetFolder.removeEntry(fname);
            console.log(`Successfully deleted annotation file: ${folderName}/${fname}`);
          } catch (e) {
            // entry not found, ignore
          }
        }
      } catch (e) {
        console.warn(`Error accessing folder ${folderName} during annotation delete:`, e);
      }
    }

    // 2. versions
    try {
      const versionsHandle = await annotationsHandle.getDirectoryHandle("versions").catch(() => null);
      if (versionsHandle) {
        for await (const entry of versionsHandle.values()) {
          if (entry.kind !== "directory") continue;
          try {
            const vHandle = await versionsHandle.getDirectoryHandle(entry.name);
            for (const fname of namesToTry) {
              await vHandle.removeEntry(fname).catch(() => {});
            }
          } catch (e) { /* skip */ }
        }
      }
    } catch (e) { /* skip */ }
  } catch (err) {
    console.error("deleteAnnotationFile error:", err, "for imageId:", imageId);
  }
}
