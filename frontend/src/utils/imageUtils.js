// frontend/src/utils/imageUtils.js

/**
 * Reads a File object and resizes it to a maximum width/height while maintaining aspect ratio.
 * Returns a Base64 data URL.
 * @param {File} file - The image file to resize.
 * @param {number} maxWidth - The maximum width allowed.
 * @param {number} maxHeight - The maximum height allowed.
 * @returns {Promise<string>} - A promise that resolves to the Base64 data URL.
 */
export async function resizeImageFile(file, maxWidth = 400, maxHeight = 400) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      return reject(new Error("Invalid file type. Must be an image."));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = width * ratio;
          height = height * ratio;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        
        // Use quality 0.8 to reduce file size
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("Failed to load image for resizing."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}
