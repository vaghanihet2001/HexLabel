import Dashboard from "./Dashboard";
import Annotate from "./Annotate";
import Projects from "./Projects";
import Datasets from "./Datasets";
import ProjectPage from "./ProjectPage"; 
import DatasetPage from "./DatasetPage"; 

export const pageType = {
    dashboard: Dashboard,
    annotate: Annotate,
    projects: Projects,
    datasets: Datasets,
    projectPage: ProjectPage,
    datasetPage: DatasetPage,
};

export const availablepages = [
    { type: "dashboard", label: "Dashboard" },
    { type: "annotate", label: "Annotate" },
    { type: "projects", label: "Projects" },
    { type: "datasets", label: "Datasets" },
    { type: "projectPage", label: "Project Page" },
    { type: "datasetPage", label: "Dataset Page" },
];
