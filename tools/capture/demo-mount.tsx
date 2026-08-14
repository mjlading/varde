/* Throwaway: same mount as main.tsx, without StrictMode.
 * StrictMode's double-mount leaves the first status poll in flight, and the
 * retry lands 45s later (calm interval), which a capture never waits for.
 * Delete after capture. */
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/jetbrains-mono";
import "../../src/index.css";
import App from "../../src/App";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
