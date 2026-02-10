import Dexie from "dexie";

export const db = new Dexie("HexLabelDB");


db.version(11).stores({
  projects: "id, name, description, createdAt",

  datasets: "id, name, description, type, projectId, createdAt",

  datasetVersions: "id, datasetId, versionName, createdAt",

  annotations: "id, datasetId, imageId, versionId",

  jobs: "id, datasetId, name, status, createdAt",

  images: "id, datasetId, jobId, name, createdAt",

  tempImages: "id, datasetId, name, createdAt",
});



// Complex objects
db.projects.mapToClass(
  class {
    folderHandle;
  }
);

db.datasets.mapToClass(
  class {
    folderHandle;
  }
);

db.images.mapToClass(
  class {
    jobId;
    url;
  }
);

db.jobs.mapToClass(
  class {
    imageIds;
  }
);

db.annotations.mapToClass(
  class {
    data;
  }
);

db.tempImages.mapToClass(
  class {
    url;
  }
);

/*
###########################################################
#  DB Init
###########################################################
*/

db.on("populate", () => {
  console.log("✅ Database initialized and ready for HexLabel");
});

// Open DB
db.open().catch((err) => {
  console.error("❌ Failed to open Dexie DB:", err);
});

/*
###########################################################
#  ID generator
###########################################################
*/

export const generateId = () => {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).substring(2, 11);
};

export default db;
