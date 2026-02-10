import JSZip from "jszip";
import { saveAs } from "file-saver";
import { db } from "./db";

/**
 * Export Formats Definition
 */
export const EXPORT_FORMATS = [
    {
        value: "yolo-hbb",
        label: "YOLO Bounding Box (HBB)",
        description: "Standard YOLO format for object detection (class xc yc w h)."
    },
    {
        value: "yolo-segment",
        label: "YOLO Segmentation (Polygon)",
        description: "YOLO format for instance segmentation (class x1 y1 x2 y2 ...)."
    }
];

/**
 * Export Registry
 */
const exporters = {
    "yolo-hbb": exportYoloHbb,
    "yolo-segment": exportYoloSegment,
};

/**
 * Main Export Function
 */
export async function exportDatasetVersion(version, dataset, project, format = "yolo-hbb") {
    const exporter = exporters[format];
    if (!exporter) throw new Error(`Unsupported export format: ${format}`);

    const zip = new JSZip();
    const dsId = dataset.id;
    const vId = version.id;

    // 1. Fetch Images
    const images = await db.images.where("datasetId").equals(dsId).toArray();

    // 2. Fetch Annotations (Snapshot)
    // We fetch annotations specifically for this versionId
    const allAnnotations = await db.annotations.where("datasetId").equals(dsId)
        .filter(a => a.versionId === vId)
        .toArray();

    // Map: imageId -> annotations
    const annMap = new Map();
    allAnnotations.forEach(rec => {
        if (rec.data && rec.data.length > 0) {
            annMap.set(rec.imageId, rec.data);
        }
    });

    // 3. Determine Classes
    const classSet = new Set();
    allAnnotations.forEach(rec => {
        (rec.data || []).forEach(a => {
            if (a.className) classSet.add(a.className);
        });
    });
    const classes = Array.from(classSet).sort();
    const classToIndex = new Map(classes.map((c, i) => [c, i]));

    // 4. Prepare Data for Exporter
    const context = {
        zip,
        version,
        dataset,
        classes,
        classToIndex,
        images,
        annMap,
    };

    // 5. Run Exporter
    await exporter(context);

    // 6. Generate Zip
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${dataset.name}-${version.name}-${format}.zip`);
}

/**
 * YOLO HBB Exporter
 */
async function exportYoloHbb(ctx) {
    const { zip, classes } = ctx;

    // data.yaml
    const yamlContent = `train: ../train/images
val: ../val/images
test: ../test/images

nc: ${classes.length}
names: [${classes.map(c => `"${c}"`).join(", ")}]
`;
    zip.file("data.yaml", yamlContent);

    await processImages(ctx, (img, anns, width, height) => {
        const lines = [];
        for (const a of anns) {
            if (a.type === "bbox") {
                const clsIdx = ctx.classToIndex.get(a.className);
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
        return lines;
    });
}

/**
 * YOLO Segment Exporter
 */
async function exportYoloSegment(ctx) {
    const { zip, classes } = ctx;

    // data.yaml
    const yamlContent = `train: ../train/images
val: ../val/images
test: ../test/images

nc: ${classes.length}
names: [${classes.map(c => `"${c}"`).join(", ")}]
`;
    zip.file("data.yaml", yamlContent);

    await processImages(ctx, (img, anns, width, height) => {
        const lines = [];
        for (const a of anns) {
            if (a.type === "polygon") {
                const clsIdx = ctx.classToIndex.get(a.className);
                if (clsIdx === undefined) continue;

                // a.points is flattened [x1, y1, x2, y2, ...] normalized
                const points = a.points.map(p => p.toFixed(6)).join(" ");
                lines.push(`${clsIdx} ${points}`);
            }
        }
        return lines;
    });
}

/**
 * Helper: Process Images & Splits
 */
async function processImages(ctx, formatAnnotationFn) {
    const { zip, images, version, annMap, dataset } = ctx;

    const folders = {
        train: { images: zip.folder("train").folder("images"), labels: zip.folder("train").folder("labels") },
        val: { images: zip.folder("val").folder("images"), labels: zip.folder("val").folder("labels") },
        test: { images: zip.folder("test").folder("images"), labels: zip.folder("test").folder("labels") },
    };

    const shuffled = [...images].sort(() => Math.random() - 0.5);
    const total = shuffled.length;
    const nTrain = Math.floor(total * (version.splits.train / 100));
    const nVal = Math.floor(total * (version.splits.val / 100));

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
            // ALWAYS generate a label file, even if empty (for YOLO)
            const anns = annMap.get(img.id) || [];
            let lines = [];

            // We only need dimensions if we are doing some pixel-based calc, 
            // but here points are already normalized.
            // However, if we needed to normalize, we'd need dims.
            // Assuming points are normalized as per app standard.

            lines = formatAnnotationFn(img, anns, 0, 0); // width/height ignored if normalized

            // Create .txt file
            const txtName = img.name.replace(/\.[^/.]+$/, "") + ".txt";
            target.labels.file(txtName, lines.join("\n"));
        }
    }
}

// Backward compatibility wrapper if needed, or just replace usage
export const exportVersionToYolo = (v, d, p) => exportDatasetVersion(v, d, p, "yolo-hbb");
