import type { Model, ModelPreference } from "./api";

export const defaultModelPreference: ModelPreference = {
  provider: "claude",
  model: "claude-fable-5",
  reasoningEffort: "high",
};

export const effortLabel = (effort: string) =>
  ({
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum",
    ultra: "Ultra",
  })[effort] ?? effort;

export function chooseModel(
  preference: ModelPreference,
  model: Model,
): ModelPreference {
  return {
    ...preference,
    model: model.id,
    reasoningEffort:
      preference.reasoningEffort === null ||
      model.reasoningEfforts.some(
        (option) => option.effort === preference.reasoningEffort,
      )
        ? preference.reasoningEffort
        : model.defaultReasoningEffort,
  };
}
