import { createRoot } from "react-dom/client";
import { configureReviewTransport } from "../../desktop/src/lib/transport";
import { transport } from "./transport";
import { BrowserReview } from "./BrowserReview";
import "../../desktop/src/i18n";
import "../../desktop/src/styles.css";
import "./styles.css";
configureReviewTransport(transport);
createRoot(document.getElementById("root")!).render(<BrowserReview />);
