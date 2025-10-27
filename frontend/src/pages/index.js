import Dashboard from "./Dashboard";
import Annotate from "./Annotate";
import Projects from "./Projects";
import Datasets from "./Datasets";

export const pageType = {
    dashboard: Dashboard,
    annotate: Annotate,
    projects: Projects,
    datasets: Datasets,
};

export const availablepages = [
    { type: "dashboard", label: "Dashboard" },
    { type: "annotate", label: "Annotate" },
    { type: "projects", label: "Projects" },
    { type: "datasets", label: "Datasets" },
];
