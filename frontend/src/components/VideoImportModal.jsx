
import React, { useState, useEffect, useRef } from "react";
import { Modal, Button, Form, Spinner, Row, Col } from "react-bootstrap";
import { getVideoMetadata, extractFrames } from "../utils/videoUtils";
import { useTheme } from "./ThemeContext";

export default function VideoImportModal({ show, onHide, file, onExtractComplete }) {
    const { themeColors } = useTheme();
    const [loading, setLoading] = useState(false);
    const [metadata, setMetadata] = useState(null);
    const [extractRate, setExtractRate] = useState(1);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");

    useEffect(() => {
        if (file && show) {
            loadMetadata();
        } else {
            setMetadata(null);
            setExtractRate(1);
            setProgress(0);
            setError("");
            setLoading(false);
        }
    }, [file, show]);

    const loadMetadata = async () => {
        setLoading(true);
        setError("");
        try {
            const meta = await getVideoMetadata(file);
            setMetadata(meta);
            // Default to 1 fps, or if video is short, maybe higher.
            // But user requested "min 1 to max fps"
            if (meta.fps < 1) setExtractRate(1);
        } catch (err) {
            console.error(err);
            setError("Failed to load video metadata. " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleExtract = async () => {
        if (!metadata) return;
        setLoading(true);
        setProgress(0);

        try {
            const blobs = await extractFrames(file, extractRate, metadata.duration, (pct) => {
                setProgress(pct);
            });
            onExtractComplete(blobs, file.name);
            onHide();
        } catch (err) {
            console.error(err);
            setError("Failed to extract frames: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!show) return null;

    return (
        <Modal show={show} onHide={loading ? null : onHide} centered size="lg">
            <Modal.Header closeButton={!loading} style={{ background: themeColors.cardBg, color: themeColors.text, borderBottom: `1px solid ${themeColors.border}` }}>
                <Modal.Title>Import Video Frames</Modal.Title>
            </Modal.Header>
            <Modal.Body style={{ background: themeColors.background, color: themeColors.text }}>
                {error && <div className="alert alert-danger">{error}</div>}

                {!metadata && loading && (
                    <div className="text-center py-5">
                        <Spinner animation="border" />
                        <p className="mt-2">Analyzing video...</p>
                    </div>
                )}

                {metadata && (
                    <div>
                        <Row className="mb-4">
                            <Col md={6}>
                                <div style={{ fontWeight: 'bold' }}>Video Name</div>
                                <div className="text-truncate" title={file.name}>{file.name}</div>
                            </Col>
                            <Col md={3}>
                                <div style={{ fontWeight: 'bold' }}>Duration</div>
                                <div>{metadata.duration.toFixed(2)}s</div>
                            </Col>
                            <Col md={3}>
                                <div style={{ fontWeight: 'bold' }}>FPS</div>
                                <div>{metadata.fps.toFixed(2)}</div>
                            </Col>
                        </Row>

                        <Form.Group className="mb-4">
                            <Form.Label>Extraction Rate (Frames Per Second)</Form.Label>
                            <div className="d-flex align-items-center gap-3">
                                <Form.Range
                                    min={0.1}
                                    max={Math.min(60, metadata.fps)}
                                    step={0.1}
                                    value={extractRate}
                                    onChange={(e) => setExtractRate(parseFloat(e.target.value))}
                                    disabled={loading}
                                />
                                <Form.Control
                                    type="number"
                                    value={extractRate}
                                    onChange={(e) => setExtractRate(Math.min(parseFloat(e.target.value), metadata.fps))}
                                    style={{ width: '80px' }}
                                    min={0.1}
                                    max={metadata.fps}
                                    disabled={loading}
                                />
                            </div>
                            <Form.Text className="text-muted">
                                Estimated frames: {Math.floor(metadata.duration * extractRate)}
                            </Form.Text>
                        </Form.Group>

                        {loading && (
                            <div className="mb-3">
                                <p>Extracting frames... {progress}%</p>
                                <div className="progress" style={{ height: '10px' }}>
                                    <div className="progress-bar" role="progressbar" style={{ width: `${progress}%` }}></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal.Body>
            <Modal.Footer style={{ background: themeColors.cardBg, borderTop: `1px solid ${themeColors.border}` }}>
                <Button variant="secondary" onClick={onHide} disabled={loading}>
                    Cancel
                </Button>
                <Button variant="primary" onClick={handleExtract} disabled={loading || !metadata}>
                    {loading ? "Extracting..." : "Extract Frames"}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
