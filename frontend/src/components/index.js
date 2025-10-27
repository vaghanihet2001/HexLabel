import Sidebar from "./SideBar";
import Header from "./Header";  

export const componentTypes = {
  sideBar: Sidebar,
  header: Header,
};

export const availablecomponents = [
  { type: "sideBar", label: "Side Bar" },
  { type: "header", label: "Header" },
];
