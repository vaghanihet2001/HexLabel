import JSZip from "jszip";
import { saveAs } from "file-saver";
import { db } from "./db";

/**
 * exportVersionToYolo
 * 
 * 1. Fetch all images for the dataset
 * 2. Fetch all annotations
 * 3. Map classes to indices (0, 1, 2...)
 * 4. Generate data.yaml
 * 5. Iterate images, assign to split (train/val/test) based on version config
 * 6. Convert annotations to YOLO format (class xc yc w h)
 * 7. Add to Zip
 * 8. Download
 */
export async function exportVersionToYolo(version, dataset, project) {
    const zip = new JSZip();
    const dsId = dataset.id;

    // 1. Fetch all images
    // Images might be associated with jobs or just datasetId
    // We'll fetch all images for the dataset
    const images = await db.images.where("datasetId").equals(dsId).toArray();

    // 2. Fetch all annotations
    const allAnnotations = await db.annotations.where("datasetId").equals(dsId).toArray();
    // Map: imageName -> annotations
    const annMap = new Map();
    allAnnotations.forEach(rec => {
        if (rec.data && rec.data.length > 0) {
            annMap.set(rec.imageName, rec.data);
        }
    });

    // 3. Determine Classes
    // We can use the classes from the version if we stored them, or derive from all annotations
    // Ideally, we should have a consistent class list.
    // For now, let's derive from all annotations to ensure we cover everything.
    const classSet = new Set();
    allAnnotations.forEach(rec => {
        (rec.data || []).forEach(a => {
            if (a.className) classSet.add(a.className);
        });
    });
    const classes = Array.from(classSet).sort();
    const classToIndex = new Map(classes.map((c, i) => [c, i]));

    // 4. Generate data.yaml
    const yamlContent = `train: ../train/images
val: ../val/images
test: ../test/images

nc: ${classes.length}
names: [${classes.map(c => `"${c}"`).join(", ")}]
`;
    zip.file("data.yaml", yamlContent);

    // Folders
    const folders = {
        train: { images: zip.folder("train").folder("images"), labels: zip.folder("train").folder("labels") },
        val: { images: zip.folder("val").folder("images"), labels: zip.folder("val").folder("labels") },
        test: { images: zip.folder("test").folder("images"), labels: zip.folder("test").folder("labels") },
    };

    // 5. Process Images
    // We need to fetch the actual image data (Blob) from FS or DB
    // And assign to split

    // Split logic:
    // We'll use a deterministic hash or random assignment based on version.splits
    // To be reproducible, we should ideally store the split assignment.
    // But for now, we'll randomize based on the requested percentages.
    // Or simpler: shuffle images and slice.

    const shuffled = [...images].sort(() => Math.random() - 0.5);
    const total = shuffled.length;
    const nTrain = Math.floor(total * (version.splits.train / 100));
    const nVal = Math.floor(total * (version.splits.val / 100));
    // rest is test

    for (let i = 0; i < total; i++) {
        const img = shuffled[i];
        let split = "train";
        if (i >= nTrain && i < nTrain + nVal) split = "val";
        else if (i >= nTrain + nVal) split = "test";

        const target = folders[split];

        // Get Image Blob
        let blob = null;
        if (img.file instanceof Blob) {
            blob = img.file;
        } else if (dataset.folderHandle) {
            // Try FS
            try {
                const imagesDir = await dataset.folderHandle.getDirectoryHandle("images");
                const rawDir = await imagesDir.getDirectoryHandle("raw");
                const fh = await rawDir.getFileHandle(img.name);
                blob = await fh.getFile();
            } catch (e) {
                console.warn("Missing image file", img.name);
            }
        }

        if (blob) {
            target.images.file(img.name, blob);

            // Generate Label File
            const anns = annMap.get(img.name) || [];
            const lines = [];

            // We need image dimensions to normalize
            // We can get it from an Image object or if we stored it.
            // Loading every image to get dimensions is slow.
            // Ideally `img` record has width/height.
            // If not, we might have to skip normalization or load it.
            // Let's check if we have width/height in DB.
            // If not, we must load the image bitmap.

            let width = img.width;
            let height = img.height;

            if (!width || !height) {
                // Fallback: load bitmap (expensive but necessary for YOLO)
                try {
                    const bmp = await createImageBitmap(blob);
                    width = bmp.width;
                    height = bmp.height;
                    bmp.close();
                } catch (e) {
                    console.warn("Failed to get dims for", img.name);
                    continue;
                }
            }

            for (const a of anns) {
                if (a.type === "bbox") {
                    const clsIdx = classToIndex.get(a.className);
                    if (clsIdx === undefined) continue;

                    // a.points is normalized [x1, y1, x2, y2]
                    // YOLO: class xc yc w h (normalized)
                    const [x1, y1, x2, y2] = a.points;
                    const w = Math.abs(x2 - x1);
                    const h = Math.abs(y2 - y1);
                    const xc = (x1 + x2) / 2;
                    const yc = (y1 + y2) / 2;

                    lines.push(`${clsIdx} ${xc.toFixed(6)} ${yc.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
                }
            }

            if (lines.length > 0) {
                // change extension to .txt
                const txtName = img.name.replace(/\.[^/.]+$/, "") + ".txt";
                target.labels.file(txtName, lines.join("\n"));
            }
        }
    }

    // Generate Zip
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${dataset.name}-${version.name}-yolo.zip`);
}
