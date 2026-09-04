import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./notify";
import { Wallets } from "./wallet";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Wallets>
      <ToastProvider>
        <App />
      </ToastProvider>
    </Wallets>
  </StrictMode>,
);
