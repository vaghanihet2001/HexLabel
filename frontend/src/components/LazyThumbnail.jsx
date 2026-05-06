import React, { useState, useEffect, useRef } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useTheme } from "./ThemeContext";

const generateThumbnail = async (file, maxSize = 200) => {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
};

export default function LazyThumbnail({ img, rawDirHandle, thumbsDirHandle, style, alt, onError, objectFit = "cover" }) {
  const { themeColors } = useTheme();
  // Support either preloaded img.url (e.g. recent upload via Blob URL) or img.file
  const [url, setUrl] = useState(() => {
    // Reject stale blob URLs from previous sessions
    if (img.url && !img.url.startsWith("blob:")) return img.url;
    if (img.file && img.file instanceof Blob) {
      return URL.createObjectURL(img.file);
    }
    return null;
  });
  
  const [urlFailed, setUrlFailed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [retriedThumb, setRetriedThumb] = useState(false);
  const containerRef = useRef(null);
  const createdUrlRef = useRef(null);

  // Clean up created object URL on unmount
  useEffect(() => {
    return () => {
      if (createdUrlRef.current) {
        URL.revokeObjectURL(createdUrlRef.current);
      }
    };
  }, []);

  // 1. Observe visibility
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // 2. Fetch FileSystem data when visible
  useEffect(() => {
    let mounted = true;

    if (isVisible && (!url || urlFailed) && rawDirHandle && img.name && !retriedThumb) {
      (async () => {
        try {
          let thumbBlob = null;
          
          // 1. Try to load from thumbsDirHandle first
          if (thumbsDirHandle) {
            try {
              const thumbFh = await thumbsDirHandle.getFileHandle(img.name);
              thumbBlob = await thumbFh.getFile();
            } catch { /* thumb not generated yet */ }
          }
          
          // 2. If no thumb, fetch raw, generate one, and save it
          if (!thumbBlob) {
            const rawFh = await rawDirHandle.getFileHandle(img.name);
            const rawFile = await rawFh.getFile();
            
            if (thumbsDirHandle) {
              const generatedBlob = await generateThumbnail(rawFile);
              if (generatedBlob) {
                thumbBlob = generatedBlob;
                try {
                  const thumbFh = await thumbsDirHandle.getFileHandle(img.name, { create: true });
                  const writable = await thumbFh.createWritable();
                  await writable.write(thumbBlob);
                  await writable.close();
                } catch (e) {
                  console.warn("Failed to save thumbnail:", e);
                }
              }
            }
            
            // Fallback to raw file if generation failed
            if (!thumbBlob) {
              thumbBlob = rawFile;
            }
          }

          if (mounted) {
            if (createdUrlRef.current) {
              URL.revokeObjectURL(createdUrlRef.current);
            }
            const newUrl = URL.createObjectURL(thumbBlob);
            createdUrlRef.current = newUrl;
            setUrl(newUrl);
            setUrlFailed(false);
          }
        } catch (e) {
          console.warn("Failed to load lazy thumbnail for:", img.name);
          if (mounted) {
            setRetriedThumb(true);
            setIsLoaded(false);
          }
          if (onError) onError(e);
        }
      })();
    }

    return () => {
      mounted = false;
    };
  }, [isVisible, url, urlFailed, rawDirHandle, thumbsDirHandle, img.name, retriedThumb, onError]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", ...style }}>
      {/* Show Skeleton Loader while image is not yet fully loaded */}
      {(!url || urlFailed || !isLoaded) && (
        <div 
          className="skeleton-loader" 
          style={{ 
            width: "100%", 
            height: "100%", 
            position: "absolute",
            top: 0,
            left: 0,
            backgroundColor: themeColors.border,
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            color: themeColors.subtleText
          }}
        >
          <ImageIcon size={24} style={{ opacity: 0.3 }} />
        </div>
      )}

      {/* Actual Image */}
      {url && !urlFailed && (
        <img
          src={url}
          alt={alt || img.name}
          style={{ 
            width: "100%", 
            height: "100%", 
            objectFit, 
            display: isLoaded ? "block" : "none" 
          }}
          onLoad={() => setIsLoaded(true)}
          onError={(e) => {
            // If the url fails, try loading from FS (only retry once)
            if (rawDirHandle && !retriedThumb) {
              setRetriedThumb(true);
              setUrlFailed(true);
              setIsLoaded(false);
            } else if (onError) {
              onError(e);
            }
          }}
        />
      )}
    </div>
  );
}
