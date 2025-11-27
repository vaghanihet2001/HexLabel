import React from "react";
import { Modal, Button, Spinner } from "react-bootstrap";
import { useTheme } from "./ThemeContext";

export default function AppModal({
  show,
  onClose,
  title = "",
  message = "",
  type = "info",
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm,
  loading = false,
  autoClose = false,
}) {
  const { themeColors } = useTheme();

  const typeColors = {
    info: themeColors.primary,
    confirm: themeColors.primary,
    success: "#2ecc71",
    error: "#ff4d4d",
  };

  const headerColor = typeColors[type] || themeColors.primary;

  const handleConfirm = async () => {
    if (!onConfirm) return onClose();
    const result = await onConfirm();
    if (autoClose && result !== false) onClose();
  };

  return (
    <Modal
      show={show}
      onHide={onClose}
      centered
      backdrop="static"
      keyboard={true}
    >
      {/* HEADER */}
      <Modal.Header
        closeButton
        style={{
          backgroundColor: themeColors.cardBg,
          borderBottom: `2px solid ${headerColor}`,
          color: themeColors.text,
        }}
      >
        {/* THEME THE DEFAULT CLOSE BUTTON */}
        <style>
          {`
            .btn-close {
              filter: ${
                themeColors.text === "#ffffff"
                  ? "invert(100%) brightness(200%)"
                  : "invert(20%) brightness(40%)"
              };
            }
          `}
        </style>

        <Modal.Title style={{ color: headerColor }}>{title}</Modal.Title>
      </Modal.Header>

      {/* BODY */}
      <Modal.Body
        style={{
          backgroundColor: themeColors.cardBg,
          color: themeColors.text,
          whiteSpace: "pre-line",
        }}
      >
        {message}
      </Modal.Body>

      {/* FOOTER */}
      <Modal.Footer
        style={{
          backgroundColor: themeColors.cardBg,
          borderTop: `1px solid ${themeColors.border}`,
        }}
      >
        {type === "confirm" && (
          <Button
            variant="outline-secondary"
            onClick={onClose}
            style={{
              borderColor: themeColors.border,
              color: themeColors.text,
            }}
          >
            {cancelText}
          </Button>
        )}

        <Button
          onClick={handleConfirm}
          disabled={loading}
          style={{
            backgroundColor: headerColor,
            borderColor: headerColor,
            color: "#ffffff",
          }}
        >
          {loading ? <Spinner animation="border" size="sm" /> : confirmText}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
