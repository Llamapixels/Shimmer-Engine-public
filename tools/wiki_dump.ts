// Dumps the editor's event list for tools/make_wiki.py.
import { EVENT_DEFS } from "../editor/src/script/eventCatalog";
import { writeFileSync } from "fs";
const out = EVENT_DEFS.map((d: any) => ({
  label: d.label,
  category: d.category,
  description: d.description,
  fields: (d.fields || []).map((f: any) => f.label),
  branches: (d.branches || []).map((b: any) => b.label),
}));
writeFileSync(process.argv[2], JSON.stringify(out));
