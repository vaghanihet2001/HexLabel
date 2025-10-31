import Dexie from "dexie";

// Create a new database
export const db = new Dexie("HexLabelDB");

// Define the schema
db.version(1).stores({
  projects: "++id, name, description, datasets, models, folderHandle",
  datasets: "++id, name, description, projectId, createdAt",
});
