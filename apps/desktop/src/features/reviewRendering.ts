import { createContext, useContext } from "react";

export const VIRTUAL_REVIEW_THRESHOLD = 3000;
export const ReviewRenderingContext = createContext(false);
export const useVirtualReview = () => useContext(ReviewRenderingContext);
