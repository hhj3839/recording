import React from "react";
import { createRoot } from "react-dom/client";
import LoginPage from "../../app/login/page";
import Home from "../../app/page";
import { ActionDialogProvider } from "../../app/action-dialog";
import "../../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <ActionDialogProvider>{window.location.pathname === "/login" ? <LoginPage /> : <Home />}</ActionDialogProvider>,
);
