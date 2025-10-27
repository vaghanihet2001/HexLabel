import React, { useState, useCallback } from "react";
import { useTheme } from "../components/ThemeContext";
import { Card, Button } from "react-bootstrap";
import { UploadCloud, FolderOpen, ArrowLeft } from "lucide-react";
import { Stage, Layer, Rect, Image as KImage } from "react-konva";
import useImage from "use-image";

export default function Annotate() {
  const { themeColors } = useTheme();
  const [files, setFiles] = useState([]);
  const [view, setView] = useState("select"); // 'select' | 'annotate'
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rectangles, setRectangles] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState(null);

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) {
      setFiles(selected);
      setView("annotate");
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      setFiles(droppedFiles);
      setView("annotate");
    }
  }, []);

  const handleDragOver = (e) => e.preventDefault();

  const currentFile = files[selectedIndex];
  const [image] = useImage(currentFile ? URL.createObjectURL(currentFile) : null);

  const handleMouseDown = (e) => {
    if (!drawing) {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      setStartPos(pointer);
      setDrawing(true);
    }
  };

  const handleMouseUp = (e) => {
    if (drawing && startPos) {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      const newRect = {
        x: Math.min(startPos.x, pointer.x),
        y: Math.min(startPos.y, pointer.y),
        width: Math.abs(pointer.x - startPos.x),
        height: Math.abs(pointer.y - startPos.y),
        id: Date.now(),
      };
      setRectangles((prev) => [...prev, newRect]);
      setDrawing(false);
      setStartPos(null);
    }
  };

  const handleMouseMove = () => {};

  // ---------- VIEW 1: File Selection ----------
  if (view === "select") {
    return (
      <div
        className="d-flex flex-column align-items-center justify-content-center"
        style={{
          height: "100%",
          backgroundColor: themeColors.background,
          color: themeColors.text,
        }}
      >
        <Card
          className="text-center p-5"
          style={{
            border: `2px dashed ${themeColors.border}`,
            backgroundColor: themeColors.cardBg,
            width: "70%",
            maxWidth: "600px",
            cursor: "pointer",
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => document.getElementById("fileInput").click()}
        >
          <UploadCloud size={48} className="mb-3" />
          <h4>Select Images or Folders</h4>
          <p style={{ opacity: 0.8 }}>
            Drag and drop images here or click to select
          </p>
          <input
            id="fileInput"
            type="file"
            multiple
            webkitdirectory="true"
            mozdirectory="true"
            style={{ display: "none" }}
            accept="image/*"
            onChange={handleFileSelect}
          />
          <Button
            variant="outline-primary"
            className="mt-3 d-flex align-items-center mx-auto"
          >
            <FolderOpen size={18} className="me-2" />
            Browse
          </Button>
        </Card>
      </div>
    );
  }

  // ---------- VIEW 2: Annotation Ground ----------
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        backgroundColor: themeColors.background,
        color: themeColors.text,
        padding:"0px",
      }}
    >
      {/* Sidebar: thumbnails */}
      <div
        style={{
          width: "200px",
          borderRight: `1px solid ${themeColors.border}`,
          backgroundColor: themeColors.sidebarBg,
          overflowY: "auto",
        }}
      >
        <div className="p-3 border-bottom" style={{ borderColor: themeColors.border }}>
          <Button
            variant="outline-secondary"
            size="sm"
            className="d-flex align-items-center"
            onClick={() => {
              setFiles([]);
              setView("select");
            }}
          >
            <ArrowLeft size={16} className="me-1" /> Back
          </Button>
        </div>

        <div className="p-2">
          {files.map((file, idx) => (
            <div
              key={file.name + idx}
              className="mb-2"
              onClick={() => setSelectedIndex(idx)}
              style={{
                cursor: "pointer",
                border:
                  idx === selectedIndex
                    ? `2px solid ${themeColors.buttonBg}`
                    : `1px solid ${themeColors.border}`,
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                style={{
                  width: "100%",
                  height: "80px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Main canvas area */}
      <div style={{ flex: 1, position: "relative" }}>
        <div
          className="d-flex justify-content-between align-items-center p-2 border-bottom"
          style={{
            borderColor: themeColors.border,
            backgroundColor: themeColors.toolbarBg,
          }}
        >
          <h6 className="m-0">Annotating: {currentFile?.name}</h6>
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-primary">
              Save
            </Button>
            <Button size="sm" variant="outline-danger">
              Clear
            </Button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "calc(100% - 40px)",
          }}
        >
          {image ? (
            <Stage
              width={800}
              height={600}
              style={{
                backgroundColor: themeColors.cardBg,
                border: `1px solid ${themeColors.border}`,
              }}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseMove={handleMouseMove}
            >
              <Layer>
                <KImage image={image} />
                {rectangles.map((rect) => (
                  <Rect
                    key={rect.id}
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    stroke={themeColors.edgeColor}
                    strokeWidth={2}
                  />
                ))}
              </Layer>
            </Stage>
          ) : (
            <p>No image loaded.</p>
          )}
        </div>
      </div>
    </div>
  );
}
