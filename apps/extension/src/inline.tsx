import { createRoot } from "react-dom/client";
import { configureReviewTransport } from "../../desktop/src/lib/transport";
import { transport } from "./transport";
import { InlineReview } from "./InlineReview";
import "../../desktop/src/i18n";
import "../../desktop/src/styles.css";
import "./inline.css";
configureReviewTransport(transport);
createRoot(document.getElementById("root")!).render(<InlineReview />);
