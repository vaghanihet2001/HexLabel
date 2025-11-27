// src/utils/cleanup.js
import { db } from "./db";
import * as fsUtils from "./fs";

/* Helper: delete annotations by imageName */
export async function deleteAnnotationsByImage(imageName) {
  if (!imageName) return;
  await db.annotations.where("imageName").equals(imageName).delete();
}

/* Delete image and its annotations */
export async function deleteImage(imageId) {
  const image = await db.images.get(imageId);
  if (!image) return;
  await deleteAnnotationsByImage(image.name);
  await db.images.delete(imageId);
}

/* Delete images by job */
export async function deleteImagesByJob(jobId) {
  const images = await db.images.where("jobId").equals(jobId).toArray();
  for (const img of images) await deleteAnnotationsByImage(img.name);
  await db.images.where("jobId").equals(jobId).delete();
}

/* Delete a job and its images */
export async function deleteJob(jobId) {
  await deleteImagesByJob(jobId);
  await db.jobs.delete(jobId);
}

/* Delete dataset and all associated records + filesystem folder + project.json update */
export async function deleteDataset(datasetId) {
  const dataset = await db.datasets.get(datasetId);
  if (!dataset) return;

  // delete related jobs
  const jobs = await db.jobs.where("datasetId").equals(datasetId).toArray();
  for (const job of jobs) await deleteJob(job.id);

  // delete related entries
  await db.images.where("datasetId").equals(datasetId).delete();
  await db.tempImages.where("datasetId").equals(datasetId).delete();
  await db.annotations.where("datasetId").equals(datasetId).delete();
  await db.datasetVersions.where("datasetId").equals(datasetId).delete();

  // delete from disk (dataset folder) if folderHandle present
  try {
    if (dataset.folderHandle) {
      const parent = await dataset.folderHandle.getParent?.();
      // If getParent not available, we expect we saved project.folderHandle elsewhere — so we skip
      if (parent) {
        await parent.removeEntry(dataset.folderHandle.name, { recursive: true });
        console.log("Deleted dataset folder:", dataset.folderHandle.name);
      } else {
        // attempt to remove by finding project that contains this dataset
        // iterate projects to find matching folder
        const projects = await db.projects.toArray();
        for (const p of projects) {
          if (p.folderHandle) {
            try {
              await p.folderHandle.removeEntry(dataset.folderHandle.name, { recursive: true });
              console.log("Deleted dataset folder via project handle:", dataset.folderHandle.name);
              break;
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    console.warn("Could not delete dataset folder:", err);
  }

  // Remove dataset record
  await db.datasets.delete(datasetId);

  // Update parent project's hexlabel.project.json
  try {
    // find project
    const projects = await db.projects.toArray();
    for (const p of projects) {
      if (p.id === dataset.projectId && p.folderHandle) {
        await fsUtils.removeDatasetFromProjectMeta(p.folderHandle, dataset.id || dataset.name);
        break;
      }
    }
  } catch (err) {
    console.warn("Failed to update project metadata after dataset delete:", err);
  }
}

/* Delete project and all nested datasets */
export async function deleteProject(projectId) {
  const project = await db.projects.get(projectId);
  if (!project) return;

  const datasets = await db.datasets.where("projectId").equals(projectId).toArray();
  for (const ds of datasets) await deleteDataset(ds.id);

  // remove project folder from disk
  try {
    if (project.folderHandle) {
      // removeEntry name from its parent — many browsers don't provide getParent(), so we try direct remove
      // If project.folderHandle is the handle, we cannot remove itself; user must delete folder manually.
      // Attempt to remove "project" folder via parent if available
      const parent = await project.folderHandle.getParent?.();
      if (parent) {
        await parent.removeEntry(project.folderHandle.name, { recursive: true });
        console.log(`Deleted project folder: ${project.name}`);
      } else {
        // fallback: attempt to remove known child entries (datasets)
        for (const ds of datasets) {
          try {
            await project.folderHandle.removeEntry(ds.name, { recursive: true });
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("Could not delete project folder:", err);
  }

  await db.projects.delete(projectId);
}

/* Cleanup orphans */
export async function cleanupOrphans() {
  console.log("Running orphan cleanup...");
  const projects = await db.projects.toArray();
  const datasets = await db.datasets.toArray();

  const validProjectIds = new Set(projects.map((p) => p.id));
  const validDatasetIds = new Set(datasets.map((d) => d.id));

  // orphan datasets (no project)
  const orphanDatasets = await db.datasets.filter((d) => !validProjectIds.has(d.projectId)).toArray();
  for (const d of orphanDatasets) await deleteDataset(d.id);

  // records missing dataset
  const tables = ["images", "annotations", "tempImages", "jobs", "datasetVersions"];
  for (const table of tables) {
    const orphans = await db[table].filter((x) => !validDatasetIds.has(x.datasetId)).toArray();
    for (const item of orphans) await db[table].delete(item.id);
  }
  console.log("Orphan cleanup complete.");
}
