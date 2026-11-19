// The page's entry: Bun bundles it from index.html (src/dashboard.ts). The modules beside it hold
// the logic (serverApi, tasks, board, taskFiles, hooks); components/ holds what is drawn.
import { createRoot } from "react-dom/client"
import { App } from "./components/App.tsx"

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
