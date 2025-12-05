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

  // create images/raw and images/thumbs
  const imagesHandle = await datasetHandle.getDirectoryHandle("images", { create: true });
  const rawHandle = await imagesHandle.getDirectoryHandle("raw", { create: true });
  const thumbsHandle = await imagesHandle.getDirectoryHandle("thumbs", { create: true });

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
  const fh = await versionsFolder.getFileHandle(`${version.id}.json`, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(version, null, 2));
  await writable.close();
}

// Read version file
export async function readVersionFile(datasetHandle, versionId) {
  const versionsFolder = await datasetHandle.getDirectoryHandle("versions");
  const fh = await versionsFolder.getFileHandle(`${versionId}.json`);
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

// Delete version file
export async function deleteVersionFile(datasetHandle, versionId) {
  try {
    const versionsFolder = await datasetHandle.getDirectoryHandle("versions");
    await versionsFolder.removeEntry(`${versionId}.json`);
  } catch (e) {
    console.warn("Failed to delete version file", e);
  }
}
