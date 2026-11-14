//! The agent's Design tool: layers added to, changed in and taken from a design, in one call, without rewriting the
//! whole file. A design is `designs/<folder>/<design>.json` (see `apps/desktop/src/design-format.ts`); it is written
//! back as the Design app writes it, one layer to a line, so a change shows as the lines of the layers it touched and
//! the turn's checkpoint puts it back.
use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value, json};

use crate::notes::file_name_for;

type Res<T> = Result<T, String>;

const FOLDER: &str = "designs";
const MAX_FILE: u64 = 4 * 1024 * 1024;
const MAX_CHANGES: usize = 200;
const MAX_LAYERS: usize = 2000;

/// What a layer may say, beside its id and type; anything else is left out.
const LAYER_KEYS: [&str; 18] = ["name", "x", "y", "w", "h", "fill", "radius", "opacity", "text", "size", "weight", "color", "align", "stroke", "strokeWidth", "hidden", "locked", "overrides"];
const FRAME_KEYS: [&str; 9] = ["name", "x", "y", "w", "h", "fill", "radius", "stroke", "strokeWidth"];

pub fn tool_descriptions() -> Vec<Value> {
    let layer = json!({ "type": "object", "description": "A layer: type (rect, ellipse, text or instance), name, x, y, w, h (inside its frame), fill, radius, opacity (0 to 1), and for text: text, size, weight, color, align (left, center, right); stroke and strokeWidth draw a border inside the edge. An instance copies the component frame named by `of`, with overrides { <layer id>: { text, fill, color } }. Colours are #rrggbb or style:<name>." });
    vec![json!({ "name": "design.edit", "description": "Change a design in the Design app in one call: add layers to a frame, change layers by id (only the fields given), remove layers, and add frames. Read the design first (files.read) to know its frames and layer ids. Each change waits for the person to keep it.", "capability": "files.write",
        "input_schema": { "type": "object", "properties": {
            "design": { "type": "string", "description": "The design as Folder/Design (its path under designs/, without .json)." },
            "add": { "type": "array", "description": "New layers, drawn after (on top of) the frame's others.", "items": { "type": "object", "properties": { "frame": { "type": "string", "description": "The frame's id or name." }, "layer": layer }, "required": ["frame", "layer"] } },
            "update": { "type": "array", "description": "Layers to change, by id; only the fields given change.", "items": { "type": "object", "properties": { "id": { "type": "string" }, "set": { "type": "object" } }, "required": ["id", "set"] } },
            "remove": { "type": "array", "items": { "type": "string" }, "description": "Ids of layers to take away." },
            "frames": { "type": "array", "description": "New frames (screens): name, x, y, w, h, fill, and their layers in `children`.", "items": { "type": "object" } }
        }, "required": ["design"] } })]
}

pub fn is_design_tool(name: &str) -> bool {
    name == "design.edit"
}

fn is_color(v: &str) -> bool {
    let v = v.trim();
    if v == "transparent" {
        return true;
    }
    if let Some(name) = v.strip_prefix("style:") {
        return (1..=60).contains(&name.chars().count());
    }
    v.strip_prefix('#').is_some_and(|h| matches!(h.len(), 3 | 6 | 8) && h.chars().all(|c| c.is_ascii_hexdigit()))
}

/// A field as the Design app reads it, or why not.
fn field(key: &str, v: &Value) -> Res<Value> {
    let number = |lo: f64, hi: f64| v.as_f64().filter(|n| n.is_finite()).map(|n| json!(((n * 100.0).round() / 100.0).clamp(lo, hi))).ok_or_else(|| format!("{key} is a number"));
    match key {
        "x" | "y" => number(-100_000.0, 100_000.0),
        "w" | "h" => number(1.0, 100_000.0),
        "radius" => number(0.0, 10_000.0),
        "opacity" => number(0.0, 1.0),
        "size" => number(4.0, 400.0),
        "weight" => number(100.0, 900.0),
        "strokeWidth" => number(0.0, 1000.0),
        "fill" | "color" | "stroke" => v.as_str().filter(|c| is_color(c)).map(|c| json!(c.trim())).ok_or_else(|| format!("{key} is a colour: #rrggbb or style:<name>")),
        "name" => v.as_str().map(|s| json!(s.chars().take(80).collect::<String>())).ok_or_else(|| "name is text".to_owned()),
        "text" => v.as_str().map(|s| json!(s.chars().take(2000).collect::<String>())).ok_or_else(|| "text is text".to_owned()),
        "align" => v.as_str().filter(|a| matches!(*a, "left" | "center" | "right")).map(|a| json!(a)).ok_or_else(|| "align is left, center or right".to_owned()),
        "hidden" | "locked" => v.as_bool().map(Value::Bool).ok_or_else(|| format!("{key} is true or false")),
        "overrides" => v.is_object().then(|| v.clone()).ok_or_else(|| "overrides is an object".to_owned()),
        _ => Err(format!("a layer has no {key}")),
    }
}

/// The fields given, checked; unknown ones are refused, so a typo does not pass silently.
fn fields(given: &Value, allowed: &[&str]) -> Res<Map<String, Value>> {
    let mut out = Map::new();
    for (key, v) in given.as_object().ok_or("the changes are an object")? {
        if matches!(key.as_str(), "id" | "type" | "of" | "children" | "component") {
            continue;
        }
        if !allowed.contains(&key.as_str()) {
            return Err(format!("{key} is not something a layer has"));
        }
        out.insert(key.clone(), field(key, v)?);
    }
    Ok(out)
}

fn ids_in(doc: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    for f in doc["frames"].as_array().into_iter().flatten() {
        ids.extend(f["id"].as_str().map(str::to_owned));
        ids.extend(f["children"].as_array().into_iter().flatten().filter_map(|n| n["id"].as_str().map(str::to_owned)));
    }
    ids
}

fn fresh_id(taken: &mut Vec<String>, prefix: char) -> String {
    let id = (1..).map(|n| format!("{prefix}{n}")).find(|id| !taken.contains(id)).unwrap_or_default();
    taken.push(id.clone());
    id
}

fn new_layer(given: &Value, taken: &mut Vec<String>) -> Res<Value> {
    let kind = given.get("type").and_then(Value::as_str).unwrap_or("rect");
    if !matches!(kind, "rect" | "ellipse" | "text" | "instance") {
        return Err(format!("{kind} is not a kind of layer: rect, ellipse, text or instance"));
    }
    let mut out = Map::new();
    let id = given.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 40 && !taken.iter().any(|t| t == id)).map(str::to_owned);
    let id = match id {
        Some(id) => {
            taken.push(id.clone());
            id
        }
        None => fresh_id(taken, 'n'),
    };
    out.insert("id".into(), json!(id));
    out.insert("type".into(), json!(kind));
    if kind == "instance" {
        let of = given.get("of").and_then(Value::as_str).filter(|o| !o.is_empty()).ok_or("an instance names its component frame in `of`")?;
        out.insert("of".into(), json!(of));
    }
    out.extend(fields(given, &LAYER_KEYS)?);
    Ok(Value::Object(out))
}

/// An object on one line with its keys in the Design app's order (id, type, name, then the box), not by the alphabet.
fn line(v: &Value) -> String {
    const ORDER: [&str; 23] = ["id", "type", "name", "x", "y", "w", "h", "fill", "of", "overrides", "radius", "opacity", "text", "size", "weight", "color", "align", "stroke", "strokeWidth", "hidden", "locked", "component", "children"];
    let Some(map) = v.as_object() else { return v.to_string() };
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort_by_key(|k| ORDER.iter().position(|o| o == k).unwrap_or(ORDER.len()));
    let parts: Vec<String> = keys.iter().map(|k| format!("{}:{}", Value::String((*k).clone()), map[*k])).collect();
    format!("{{{}}}", parts.join(","))
}

/// Written as the Design app writes it: the styles, then each frame's head on a line and each layer on a line of its own.
fn write(doc: &Value) -> String {
    let styles: Vec<String> = doc["styles"].as_array().into_iter().flatten().map(|s| format!("    {}", line(s))).collect();
    let mut lines = vec!["{".to_owned(), "  \"version\": 1,".to_owned()];
    lines.push(format!("  \"styles\": [{}],", if styles.is_empty() { String::new() } else { format!("\n{}\n  ", styles.join(",\n")) }));
    lines.push("  \"frames\": [".to_owned());
    let frames = doc["frames"].as_array().cloned().unwrap_or_default();
    for (i, f) in frames.iter().enumerate() {
        let mut head = f.as_object().cloned().unwrap_or_default();
        let children = head.remove("children").and_then(|c| c.as_array().cloned()).unwrap_or_default();
        let head = line(&Value::Object(head));
        let head = &head[..head.len() - 1];
        let more = if i + 1 < frames.len() { "," } else { "" };
        if children.is_empty() {
            lines.push(format!("    {head}, \"children\": []}}{more}"));
        } else {
            lines.push(format!("    {head}, \"children\": ["));
            for (j, c) in children.iter().enumerate() {
                lines.push(format!("      {}{}", line(c), if j + 1 < children.len() { "," } else { "" }));
            }
            lines.push(format!("    ]}}{more}"));
        }
    }
    lines.push("  ]".to_owned());
    lines.push("}".to_owned());
    lines.join("\n") + "\n"
}

pub struct Designs {
    root: PathBuf,
}

impl Designs {
    pub fn new(workspace: impl Into<PathBuf>) -> Designs {
        Designs { root: workspace.into().join(FOLDER) }
    }

    fn file(&self, design: &str) -> Res<PathBuf> {
        let design = design.trim().trim_start_matches("designs/").trim_end_matches(".json");
        let (folder, name) = design.split_once('/').ok_or("name the design as Folder/Design")?;
        if folder != file_name_for(folder) || name != file_name_for(name) || folder.starts_with('.') || name.starts_with('.') {
            return Err(format!("{design} is not a design's name"));
        }
        let file = self.root.join(folder).join(format!("{name}.json"));
        if fs::symlink_metadata(&file).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("that design is a link, which Design does not follow".into());
        }
        if !file.is_file() {
            return Err(format!("there is no design {design}"));
        }
        Ok(file)
    }

    /// The agent's Design tool. Every change is checked before the file is written, so a wrong id changes nothing.
    pub fn run(&self, tool: &str, args: &Value) -> Res<String> {
        if tool != "design.edit" {
            return Err(format!("unknown tool {tool}"));
        }
        let design = args.get("design").and_then(Value::as_str).ok_or("name the design")?;
        let file = self.file(design)?;
        if fs::metadata(&file).map_err(|e| e.to_string())?.len() > MAX_FILE {
            return Err("that design is too big to change here".into());
        }
        let mut doc: Value = serde_json::from_str(&fs::read_to_string(&file).map_err(|e| e.to_string())?).map_err(|_| "that design is not valid JSON; open it in Design first")?;
        if !doc.is_object() {
            return Err("that design is not valid".into());
        }
        if !doc["frames"].is_array() {
            doc["frames"] = json!([]);
        }
        let list = |key: &str| args.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
        let (adds, updates, removes, frames) = (list("add"), list("update"), list("remove"), list("frames"));
        if adds.len() + updates.len() + removes.len() + frames.len() > MAX_CHANGES {
            return Err(format!("at most {MAX_CHANGES} changes at once"));
        }
        if adds.is_empty() && updates.is_empty() && removes.is_empty() && frames.is_empty() {
            return Err("say what to add, change or remove".into());
        }
        let mut taken = ids_in(&doc);
        // New frames first, so layers can be added to them in the same call.
        for f in &frames {
            let mut head = Map::new();
            head.insert("id".into(), json!(fresh_id(&mut taken, 'f')));
            head.extend(fields(f, &FRAME_KEYS)?);
            head.entry("name").or_insert(json!("Frame"));
            for (k, d) in [("x", 0.0), ("y", 0.0), ("w", 393.0), ("h", 852.0)] {
                head.entry(k).or_insert(json!(d));
            }
            head.entry("fill").or_insert(json!("#ffffff"));
            let mut children = Vec::new();
            for c in f.get("children").and_then(Value::as_array).into_iter().flatten() {
                children.push(new_layer(c, &mut taken)?);
            }
            head.insert("children".into(), Value::Array(children));
            doc["frames"].as_array_mut().ok_or("no frames")?.push(Value::Object(head));
        }
        for a in &adds {
            let which = a.get("frame").and_then(Value::as_str).ok_or("say which frame each layer goes in")?;
            let layer = new_layer(a.get("layer").ok_or("each addition has a layer")?, &mut taken)?;
            let frame = doc["frames"].as_array_mut().into_iter().flatten().find(|f| f["id"].as_str() == Some(which) || f["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(which))).ok_or_else(|| format!("there is no frame {which}"))?;
            if !frame["children"].is_array() {
                frame["children"] = json!([]);
            }
            let children = frame["children"].as_array_mut().ok_or("no layers")?;
            if children.len() >= MAX_LAYERS {
                return Err("that frame is full".into());
            }
            children.push(layer);
        }
        for u in &updates {
            let id = u.get("id").and_then(Value::as_str).ok_or("each change names a layer's id")?;
            let set = fields(u.get("set").ok_or("each change says what to set")?, &LAYER_KEYS)?;
            let layer = doc["frames"].as_array_mut().into_iter().flatten().flat_map(|f| f["children"].as_array_mut().into_iter().flatten()).find(|n| n["id"].as_str() == Some(id)).ok_or_else(|| format!("there is no layer {id}"))?;
            let layer = layer.as_object_mut().ok_or("that layer is not valid")?;
            layer.extend(set);
        }
        for r in &removes {
            let id = r.as_str().ok_or("remove lists layer ids")?;
            let mut found = false;
            for f in doc["frames"].as_array_mut().into_iter().flatten() {
                if let Some(children) = f["children"].as_array_mut() {
                    let before = children.len();
                    children.retain(|n| n["id"].as_str() != Some(id));
                    found |= children.len() != before;
                }
            }
            if !found {
                return Err(format!("there is no layer {id}"));
            }
        }
        let temp = PathBuf::from(format!("{}.mobius-tmp", file.display()));
        fs::write(&temp, write(&doc)).map_err(|e| e.to_string())?;
        fs::rename(&temp, &file).map_err(|e| {
            let _ = fs::remove_file(&temp);
            e.to_string()
        })?;
        let mut said = Vec::new();
        for (n, what) in [(frames.len(), "frame"), (adds.len(), "layer added"), (updates.len(), "layer changed"), (removes.len(), "layer removed")] {
            if n > 0 {
                let (one, rest) = what.split_once(' ').unwrap_or((what, ""));
                said.push(format!("{n} {one}{}{}{rest}", if n == 1 { "" } else { "s" }, if rest.is_empty() { "" } else { " " }));
            }
        }
        Ok(format!("Changed {}: {}.", design.trim().trim_end_matches(".json"), said.join(", ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: &str = r##"{"version":1,"styles":[{"name":"Primary","color":"#4f46e5"}],"frames":[{"id":"f1","name":"Charging","x":0,"y":0,"w":390,"h":844,"fill":"#ffffff","radius":0,"children":[{"id":"l1","type":"text","name":"Title","x":24,"y":64,"w":300,"h":40,"text":"Charging","size":32,"weight":700,"color":"#1f2937"},{"id":"l2","type":"rect","name":"Old","x":0,"y":0,"w":10,"h":10,"fill":"#000000"}]}]}"##;

    fn setup() -> (tempfile::TempDir, Designs, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("designs/Kestrel app");
        fs::create_dir_all(&folder).unwrap();
        let file = folder.join("Charging screen.json");
        fs::write(&file, START).unwrap();
        let designs = Designs::new(dir.path());
        (dir, designs, file)
    }

    #[test]
    fn layers_are_added_changed_and_removed_in_one_call_and_written_a_layer_to_a_line() {
        let (_dir, designs, file) = setup();
        let said = designs
            .run("design.edit", &json!({ "design": "Kestrel app/Charging screen",
                "add": [{ "frame": "charging", "layer": { "type": "text", "name": "Cost", "x": 24, "y": 520, "w": 340, "h": 24, "text": "£4.10 so far", "size": 18, "color": "style:Primary" } }],
                "update": [{ "id": "l1", "set": { "text": "Charging now", "size": 36 } }],
                "remove": ["l2"],
                "frames": [{ "name": "Done", "x": 460, "children": [{ "type": "text", "text": "Charged" }] }] }))
            .unwrap();
        assert_eq!(said, "Changed Kestrel app/Charging screen: 1 frame, 1 layer added, 1 layer changed, 1 layer removed.");
        let text = fs::read_to_string(&file).unwrap();
        let doc: Value = serde_json::from_str(&text).unwrap();
        let layers = doc["frames"][0]["children"].as_array().unwrap();
        assert_eq!(layers.len(), 2);
        assert_eq!(layers[0]["text"], "Charging now");
        assert_eq!(layers[0]["size"], 36.0);
        assert_eq!(layers[1]["name"], "Cost");
        // New frames are made first, so their layers take the first new ids.
        assert_eq!(doc["frames"][1]["id"], "f2");
        assert_eq!(doc["frames"][1]["children"][0]["id"], "n1");
        assert_eq!(layers[1]["id"], "n2");
        assert_eq!(doc["styles"][0]["name"], "Primary", "the styles stay");
        assert!(text.lines().any(|l| l.trim_start().starts_with(r#"{"id":"n2","#)), "one layer to a line:\n{text}");
    }

    #[test]
    fn a_wrong_id_frame_field_or_colour_changes_nothing() {
        let (_dir, designs, file) = setup();
        for bad in [
            json!({ "design": "Kestrel app/Charging screen", "update": [{ "id": "l1", "set": { "text": "x" } }, { "id": "nope", "set": { "text": "y" } }] }),
            json!({ "design": "Kestrel app/Charging screen", "add": [{ "frame": "Nowhere", "layer": { "type": "rect" } }] }),
            json!({ "design": "Kestrel app/Charging screen", "update": [{ "id": "l1", "set": { "colour": "#fff" } }] }),
            json!({ "design": "Kestrel app/Charging screen", "update": [{ "id": "l1", "set": { "color": "red" } }] }),
            json!({ "design": "Kestrel app/Charging screen", "add": [{ "frame": "f1", "layer": { "type": "star" } }] }),
            json!({ "design": "Kestrel app/Missing" }),
            json!({ "design": "../secrets", "remove": ["l1"] }),
            json!({ "design": "Kestrel app/Charging screen" }),
        ] {
            assert!(designs.run("design.edit", &bad).is_err(), "{bad}");
            assert_eq!(fs::read_to_string(&file).unwrap(), START, "{bad}");
        }
    }
}
