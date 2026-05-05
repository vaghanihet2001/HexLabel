// src/utils/cleanup.js
import { db } from "./db";
import * as fsUtils from "./fs";

/* Helper: delete annotations by imageName */
export async function deleteAnnotationsByImage(imageName) {
  try {
    if (!imageName) return;
    await db.annotations.where("imageName").equals(imageName).delete();
  } catch (err) {
    console.warn("Failed to delete annotations by image:", err);
  }
}

/* Delete image and its annotations */
export async function deleteImage(imageId) {
  try {
    const image = await db.images.get(imageId);
    if (!image) return;
    await deleteAnnotationsByImage(image.name);
    await db.images.delete(imageId);
  } catch (err) {
    console.warn("Failed to delete image:", err);
  }
}

/* Delete images by job */
export async function deleteImagesByJob(jobId) {
  try {
    const images = await db.images.where("jobId").equals(jobId).toArray();
    for (const img of images) await deleteAnnotationsByImage(img.name);
    await db.images.where("jobId").equals(jobId).delete();
  } catch (err) {
    console.warn("Failed to delete images by job:", err);
  }
}

/* Delete a job and its images */
export async function deleteJob(jobId) {
  try {
    await deleteImagesByJob(jobId);
    await db.jobs.delete(jobId);
  } catch (err) {
    console.warn("Failed to delete job:", err);
  }
}

/* Delete dataset and all associated records + filesystem folder + project.json update */
export async function deleteDataset(datasetId) {
  try {
    const dataset = await db.datasets.get(datasetId);
    if (!dataset) return;

    // Delete related jobs safely
    try {
      const jobs = await db.jobs.where("datasetId").equals(datasetId).toArray();
      for (const job of jobs) await deleteJob(job.id);
    } catch (e) {
      console.warn("Error deleting jobs for dataset:", e);
    }

    // Delete related entries safely
    try {
      await db.images.where("datasetId").equals(datasetId).delete();
      await db.tempImages.where("datasetId").equals(datasetId).delete();
      await db.annotations.where("datasetId").equals(datasetId).delete();
      await db.datasetVersions.where("datasetId").equals(datasetId).delete();
    } catch (e) {
      console.warn("Error deleting related records for dataset:", e);
    }

    // Try deleting from file system if possible
    try {
      if (dataset.folderHandle) {
        // getParent is not standard, so we fallback gracefully
        const parent = await dataset.folderHandle.getParent?.();
        if (parent) {
          await parent.removeEntry(dataset.folderHandle.name, { recursive: true });
          console.log(`🗂 Folder deleted: ${dataset.folderHandle.name}`);
        } else {
          // If we can't find the parent, we can't delete the folder easily without the project handle
        }
      }
    } catch (err) {
      console.warn("⚠️ Could not delete dataset folder:", err);
    }

    await db.datasets.delete(datasetId);

    // Update parent project's hexlabel.project.json
    try {
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
  } catch (globalErr) {
    console.error("Critical error in deleteDataset:", globalErr);
    throw globalErr;
  }
}

/* Delete project and all nested datasets */
export async function deleteProject(projectId) {
  try {
    const project = await db.projects.get(projectId);
    if (!project) return;

    const datasets = await db.datasets.where("projectId").equals(projectId).toArray();
    for (const ds of datasets) {
      try {
        await deleteDataset(ds.id);
      } catch (e) {
        console.warn(`Failed to delete dataset ${ds.id} during project deletion:`, e);
      }
    }

    // remove project folder from disk
    try {
      if (project.folderHandle) {
        const parent = await project.folderHandle.getParent?.();
        if (parent) {
          await parent.removeEntry(project.folderHandle.name, { recursive: true });
          console.log(`Deleted project folder: ${project.name}`);
        } else {
          // Attempt to remove known child entries (datasets) from the project folder
          for (const ds of datasets) {
            try {
              await project.folderHandle.removeEntry(ds.name, { recursive: true });
            } catch {}
          }
          // Note: we can't delete the project folder itself without its parent
        }
      }
    } catch (err) {
      console.warn("Could not delete project folder:", err);
    }

    await db.projects.delete(projectId);
  } catch (err) {
    console.error("Failed to delete project:", err);
    throw err;
  }
}

/* Cleanup orphans */
export async function cleanupOrphans() {
  console.log("Running orphan cleanup...");
  try {
    const projects = await db.projects.toArray();
    const datasets = await db.datasets.toArray();

    const validProjectIds = new Set(projects.map((p) => p.id));
    const validDatasetIds = new Set(datasets.map((d) => d.id));

    // orphan datasets (no project)
    const orphanDatasets = await db.datasets.filter((d) => !validProjectIds.has(d.projectId)).toArray();
    for (const d of orphanDatasets) {
      try {
        await deleteDataset(d.id);
      } catch (e) {
        console.warn("Failed to delete orphan dataset", d.id, e);
      }
    }

    // records missing dataset
    const tables = ["images", "annotations", "tempImages", "jobs", "datasetVersions"];
    for (const table of tables) {
      try {
        const orphans = await db[table].filter((x) => !validDatasetIds.has(x.datasetId)).toArray();
        for (const item of orphans) {
          try {
            await db[table].delete(item.id);
          } catch (e) {
            console.warn(`Failed to delete orphan ${table} ${item.id}`, e);
          }
        }
      } catch (e) {
        console.warn(`Error querying orphans in ${table}:`, e);
      }
    }
    console.log("Orphan cleanup complete.");
  } catch (err) {
    console.error("Orphan cleanup failed:", err);
  }
}
