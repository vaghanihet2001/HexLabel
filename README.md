# 🚀 HexLabel

**HexLabel** is an intuitive, modern annotation web app designed to make image and dataset labeling seamless and efficient.  
It supports Images imports, annotation visualization, and integrates easily into AI/ML data pipelines.

---

## 🧠 Project Overview

HexLabel simplifies the process of preparing training data for computer vision models.  
Users can easily:
- Upload or drag & drop images or folders  
- Annotate and manage datasets visually  
- Export annotations in popular formats like YOLO, COCO, or KITTI *(future support planned)*

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-------------|
| **Frontend** | ⚛️ React.js |
| **Deployment** | 🐳 Docker |

---

## ⚙️ How to Run the Project

Clone the repository and build the Docker containers:
```bash
docker-compose up --build
```

## Once the build is complete:

🌐 Frontend (React): http://localhost:5173 

## 📦 Folder Structure
```
HexLabel/
│
├── frontend/        # React frontend app
├── docker-compose.yml
└── README.md
```

## 🧩 Features (In Progress)

✅ Drag & Drop or folder-based image upload

✅ Fast, responsive annotation workspace

✅ **Supported Import Formats:**
   - YOLO Bounding Box (HBB)
   - YOLO Segmentation
   - YOLO Classification
   - YOLO Oriented Bounding Box (OBB)

✅ **Supported Export Formats:**
   - YOLO Bounding Box (HBB)
   - YOLO Segmentation
   - YOLO Classification
   - *(YOLO OBB export is coming soon)*

🔜 project management dashboard

## 🧑‍💻 Author

### Vaghani Het

📫 <a href="https://github.com/vaghanihet2001">GitHub Profile</a>

## 📝 License

This project is open-source and available under the [GNU General Public License v3.0 (GPL-3.0)](LICENSE).