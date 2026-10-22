import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import go from "highlight.js/lib/languages/go";

Object.entries({
  javascript,
  typescript,
  python,
  rust,
  sql,
  json,
  bash,
  css,
  xml,
  yaml,
  go,
}).forEach(([name, language]) => hljs.registerLanguage(name, language));
const languages: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rs: "rust",
  sql: "sql",
  json: "json",
  sh: "bash",
  bash: "bash",
  css: "css",
  html: "xml",
  xml: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  go: "go",
};
const cache = new Map<string, string>();
/** Highlight only mounted lines; cache is bounded and long/generated lines stay plain. */
export function CodeText({ text, path }: { text: string; path: string }) {
  const language = languages[path.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!language || text.length > 2000 || !text.trim())
    return <>{text || " "}</>;
  const key = `${language}/${text}`;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      return <>{text}</>;
    }
    if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
    cache.set(key, html);
  }
  // highlight() escapes source characters before producing its own token spans.
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
