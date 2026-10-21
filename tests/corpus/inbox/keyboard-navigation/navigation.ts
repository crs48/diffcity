export const nextStep = (index: number, count: number) => Math.min(index + 1, count - 1);
export const previousStep = (index: number) => Math.max(0, index - 1);
